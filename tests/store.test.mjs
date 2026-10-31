import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { emptyState } from '../src/model.ts';

test('sync batches durable edits, ignores snapshot/preferences, and supports immediate flush and retry', async t => {
  const shop = { id: 'ABCDEFGHJKLMNPQRSTUV', name: 'Market', createdAt: 1, shared: true,
    groupOrder: ['fruit'], groups: { fruit: { name: 'Fruit', createdAt: 1 } },
    items: { apple: { name: 'Apple', groupId: 'fruit', done: false, deleted: false, createdAt: 1, updatedAt: 1 } } };
  const state = globalThis.storeTest = {
    raw: JSON.stringify({ ...emptyState(), shops: [shop] }), sends: [], failSave: false,
    async save(raw) { if (this.failSave) throw new Error('Disk full'); this.raw = raw; },
  };
  const modules = {
    '@react-native-async-storage/async-storage': `export default {
      getItem: async () => globalThis.storeTest.raw,
      setItem: async (_, raw) => globalThis.storeTest.save(raw)
    };`,
    'expo-crypto': 'export const randomUUID = () => globalThis.crypto.randomUUID();',
    'react-native': `export const AppState = { currentState: 'active', addEventListener: (_, fn) => { globalThis.storeTest.onAppState = fn; } };`,
    './firebase': `export const firebaseConfigured = true;
      export const sendWrites = async writes => { globalThis.storeTest.sends.push(writes); };
      export const watchShop = async (_, receive) => { globalThis.storeTest.receive = receive; return () => {}; };
      export const publishShop = async () => {};
      export const joinRemote = async () => {};
      export const stopSharing = async () => {};`,
  };
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/src/store.ts')) {
      if (modules[specifier]) return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
      if (specifier === './model') return nextResolve('./model.ts', context);
    }
    return nextResolve(specifier, context);
  } });
  t.after(() => { hook.deregister(); delete globalThis.storeTest; });
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const { actions, load, flush } = await import('../src/store.ts');
  await load(); await settle();

  actions.toggleItem(shop.id, 'apple');
  await settle();
  assert.equal(JSON.parse(state.raw).outbox.length, 1, 'saved locally before network');
  t.mock.timers.tick(500);
  actions.renameItem(shop.id, 'apple', 'Green apple');
  actions.collapse('fruit');
  state.receive('shop', shop);
  await settle();
  assert.equal(state.sends.length, 0);
  t.mock.timers.tick(249); await settle();
  assert.equal(state.sends.length, 0);
  t.mock.timers.tick(1); await settle();
  assert.equal(state.sends.length, 1, 'later edits do not reset the window');
  assert.equal(state.sends[0].length, 2);
  assert.equal(JSON.parse(state.raw).outbox.length, 0);

  actions.renameItem(shop.id, 'apple', ' Green apple ');
  actions.renameShop(shop.id, shop.name);
  await settle(); t.mock.timers.tick(750); await settle();
  assert.equal(state.sends.length, 1, 'unchanged names are not queued');

  actions.toggleItem(shop.id, 'apple');
  await flush(); await settle();
  assert.equal(state.sends.length, 2, 'explicit flush bypasses the timer');
  actions.toggleItem(shop.id, 'apple'); await settle();
  state.onAppState('background'); await settle();
  assert.equal(state.sends.length, 3, 'background transition flushes pending edits');

  state.failSave = true;
  actions.toggleItem(shop.id, 'apple'); await settle();
  await flush();
  assert.equal(state.sends.length, 3, 'failed local save must not reach Firebase');
  state.failSave = false;
  await actions.retry(); await settle();
  assert.equal(state.sends.length, 4);
  assert.equal(JSON.parse(state.raw).outbox.length, 0);

  assert.equal(actions.toggleItem(shop.id, 'apple'), true);
  assert.equal(actions.toggleItem(shop.id, 'apple'), false, 'a second tap uses the latest store state before a render');
  await settle(); t.mock.timers.tick(1000); await settle();
  assert.equal(JSON.parse(state.raw).shops[0].items.apple.done, false, 'rapid unchecking stays active after the move delay');
});
