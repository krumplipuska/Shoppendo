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
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
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
  t.mock.timers.tick(1999); await settle();
  assert.equal(state.sends.length, 0, 'a new edit restarts the quiet window; snapshots and preferences do not');
  t.mock.timers.tick(1); await settle();
  assert.equal(state.sends.length, 1, 'edits made close together are sent once the user pauses');
  assert.equal(state.sends[0].length, 2);
  assert.equal(JSON.parse(state.raw).outbox.length, 0);

  // Edits every 1.5 s never leave a 2 s pause, so only the 6 s deadline sends them.
  for (let i = 0; i < 3; i++) { actions.toggleItem(shop.id, 'apple'); await settle(); t.mock.timers.tick(1500); await settle(); }
  actions.toggleItem(shop.id, 'apple'); await settle();
  t.mock.timers.tick(1499); await settle();
  assert.equal(state.sends.length, 1, 'continuous edits keep batching');
  t.mock.timers.tick(1); await settle();
  assert.equal(state.sends.length, 2, 'continuous edits are sent by the deadline after the first one');
  assert.equal(state.sends[1].length, 4);

  actions.renameItem(shop.id, 'apple', ' Green apple ');
  actions.renameShop(shop.id, shop.name);
  await settle(); t.mock.timers.tick(6000); await settle();
  assert.equal(state.sends.length, 2, 'unchanged names are not queued');

  actions.toggleItem(shop.id, 'apple');
  await flush(); await settle();
  assert.equal(state.sends.length, 3, 'explicit flush bypasses the timer');
  actions.toggleItem(shop.id, 'apple'); await settle();
  state.onAppState('background'); await settle();
  assert.equal(state.sends.length, 4, 'background transition flushes pending edits');

  state.failSave = true;
  actions.toggleItem(shop.id, 'apple'); await settle();
  await flush();
  assert.equal(state.sends.length, 4, 'failed local save must not reach Firebase');
  state.failSave = false;
  await actions.retry(); await settle();
  assert.equal(state.sends.length, 5);
  assert.equal(JSON.parse(state.raw).outbox.length, 0);

  assert.equal(actions.toggleItem(shop.id, 'apple'), true);
  assert.equal(actions.toggleItem(shop.id, 'apple'), false, 'a second tap uses the latest store state before a render');
  await settle(); t.mock.timers.tick(1000); await settle();
  assert.equal(JSON.parse(state.raw).shops[0].items.apple.done, false, 'rapid unchecking stays active after the move delay');

  actions.toggleItem(shop.id, 'apple'); await settle();
  actions.clearItems(shop.id); await settle();
  let saved = JSON.parse(state.raw).shops[0];
  assert.equal(saved.items.apple.deleted, true, 'remove all hides items');
  assert.equal(saved.items.apple.name, 'Green apple', 'the item data is kept');
  assert.ok(saved.groups.fruit, 'categories are kept');
  actions.undo(); await settle();
  saved = JSON.parse(state.raw).shops[0];
  assert.equal(saved.items.apple.deleted, false, 'undo brings the items back');
  assert.equal(saved.items.apple.done, true, 'undo keeps each item\'s done state');

  actions.clearItems(shop.id, 'missing'); await settle();
  assert.equal(JSON.parse(state.raw).shops[0].items.apple.deleted, false, 'Remove missing leaves done items');
  actions.clearItems(shop.id, 'done'); await settle();
  assert.equal(JSON.parse(state.raw).shops[0].items.apple.deleted, true, 'Remove done hides done items');

  // Quick add (All items and the Add item sheet): removed → new item, on the list → left alone, done → back on the list.
  const added = actions.quickAdd(shop.id, 'Green apple', 'fruit');
  assert.equal(added.result, 'added'); await settle();
  assert.equal(JSON.parse(state.raw).shops[0].items[added.id].done, false, 'a removed item is added to the list again');
  assert.deepEqual(actions.quickAdd(shop.id, ' green APPLE ', 'fruit'), { result: 'duplicate', id: added.id, name: 'Green apple', groupId: 'fruit' },
    'an item already on the list is not added twice');
  actions.toggleItem(shop.id, added.id); await settle();
  assert.equal(actions.quickAdd(shop.id, 'Green apple', 'fruit').result, 'restored'); await settle();
  saved = JSON.parse(state.raw).shops[0];
  assert.equal(saved.items[added.id].done, false, 'a done item moves back to the list');
  assert.equal(Object.values(saved.items).filter(entry => !entry.deleted).length, 1, 'no copies are made');

  // All items → delete erases every copy of the name (on the list and removed ones); undo brings them back.
  const copies = Object.entries(saved.items).filter(([, entry]) => entry.name === 'Green apple').map(([itemId]) => itemId);
  assert.ok(copies.length >= 2);
  actions.eraseItem(shop.id, 'green apple'); await settle();
  saved = JSON.parse(state.raw).shops[0];
  assert.equal(Object.values(saved.items).some(entry => entry.name === 'Green apple'), false, 'every copy is erased');
  actions.undo(); await settle();
  saved = JSON.parse(state.raw).shops[0];
  assert.deepEqual(copies.filter(itemId => saved.items[itemId]?.name === 'Green apple'), copies, 'undo restores every copy');
});
