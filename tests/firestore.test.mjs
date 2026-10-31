import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { decodeShop, encodeShop, readShop, writeShop, watchShopDocument, stopShopSharing } from '../src/shop-document.ts';
import { edit, emptyState, mergeRemote } from '../src/model.ts';

const shopId = 'ABCDEFGHJKLMNPQRSTUV';
const group = { name: 'Fruits', createdAt: 1, icon: 'fruit' };
const item = (name, groupId = 'fruits') => ({ name, groupId, done: false, deleted: false, createdAt: 1, updatedAt: 1 });
const shop = () => ({ id: shopId, name: 'Market', createdAt: 1, shared: true, groupOrder: ['fruits', 'bakery'],
  groups: { fruits: group, bakery: { ...group, name: 'Bakery', icon: 'bread' } }, items: { apples: item('Apples') } });
const write = (target, entityId, data, id = shopId) => ({ id: crypto.randomUUID(), shopId: id, target, entityId, data });
let env, alice, bob, outsider;

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-shoppendo', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
  alice = env.authenticatedContext('alice').firestore();
  bob = env.authenticatedContext('bob').firestore();
  outsider = env.authenticatedContext('outsider').firestore();
});
after(async () => { await env?.cleanup(); });

test('a complete shop is stored in one document with items nested in categories', async () => {
  const source = shop();
  await assertSucceeds(writeShop(alice, 'alice', [write('shop', '', { name: source.name, createdAt: 1, groupOrder: source.groupOrder }),
    ...Object.entries(source.groups).map(([id, data]) => write('groups', id, data)), write('items', 'apples', source.items.apples)]));
  const data = (await getDoc(doc(alice, 'shops', shopId))).data();
  assert.equal(data.categories.fruits.items.apples.name, 'Apples');
  assert.equal(data.categories.fruits.items.apples.groupId, undefined);
  assert.equal(Object.hasOwn(data, 'items'), false);
  assert.equal((await readShop(bob, 'bob', shopId)).items.apples.name, 'Apples');
  await env.withSecurityRulesDisabled(async context => {
    for (const path of ['groups', 'items', 'members']) assert.equal((await getDocs(collection(context.firestore(), 'shops', shopId, path))).size, 0);
  });
});

test('authentication and an unguessable invitation are required; listing, deleting and unrelated collections are denied', async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'shops', shopId)));
  await assertFails(getDocs(collection(outsider, 'shops')));
  await assertFails(deleteDoc(doc(outsider, 'shops', shopId)));
  await assertFails(getDoc(doc(outsider, 'shops', '1234')));
  await assertFails(setDoc(doc(outsider, 'shops', '1234'), encodeShop(shop())));
  await assertFails(setDoc(doc(outsider, 'otherData', 'public'), { open: true }));
  await assertFails(setDoc(doc(outsider, 'shops', shopId, 'items', 'bad'), item('Bad')));
});

test('concurrent devices add items and patch separate fields without replacing each other', async () => {
  await Promise.all([
    writeShop(alice, 'alice', [write('items', 'bananas', item('Bananas'))]),
    writeShop(bob, 'bob', [write('items', 'oranges', item('Oranges'))]),
  ]);
  await Promise.all([
    writeShop(alice, 'alice', [write('items', 'apples', { name: 'Green apples' })]),
    writeShop(bob, 'bob', [write('items', 'apples', { done: true, updatedAt: 2 })]),
  ]);
  const result = await readShop(alice, 'alice', shopId);
  assert.deepEqual(Object.keys(result.items).sort(), ['apples', 'bananas', 'oranges']);
  assert.equal(result.items.apples.name, 'Green apples');
  assert.equal(result.items.apples.done, true);
});

test('one document listener receives another device checking an item', async () => {
  let stop;
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop?.(); reject(new Error('Realtime update did not arrive')); }, 10000);
    stop = watchShopDocument(bob, 'bob', shopId, snapshot => {
      if (snapshot.items.bananas?.done) { clearTimeout(timer); stop(); resolve(); }
    }, error => { clearTimeout(timer); stop?.(); reject(error); });
  });
  await writeShop(alice, 'alice', [write('items', 'bananas', { done: true, updatedAt: 3 })]);
  await received;
});

test('already-applied retries and batches with no final change do not write the document', async () => {
  const source = { ...shop(), id: 'GHJKLMNPQRSTUVWXYZAB' };
  await writeShop(alice, 'alice', [], source);
  const url = `http://127.0.0.1:8080/v1/projects/demo-shoppendo/databases/(default)/documents/shops/${source.id}`;
  const readVersion = async () => {
    const response = await fetch(url, { headers: { Authorization: 'Bearer owner' } });
    assert.equal(response.ok, true);
    return (await response.json()).updateTime;
  };
  const before = await readVersion();
  await writeShop(alice, 'alice', [write('items', 'apples', { done: false }, source.id)]);
  await writeShop(alice, 'alice', [write('shop', '', { name: 'Temporary' }, source.id),
    write('shop', '', { name: source.name }, source.id)]);
  assert.equal(await readVersion(), before);
  const patch = write('items', 'apples', { done: true, updatedAt: 2 }, source.id);
  await writeShop(alice, 'alice', [patch]);
  const changed = await readVersion();
  assert.notEqual(changed, before);
  await writeShop(alice, 'alice', [patch]);
  assert.equal(await readVersion(), changed);
});

test('category changes move an item atomically, preserving checks and edits', async () => {
  await writeShop(alice, 'alice', [write('items', 'bananas', { groupId: 'bakery', position: 0.5 })]);
  const data = (await getDoc(doc(bob, 'shops', shopId))).data();
  assert.equal(data.categories.fruits.items.bananas, undefined);
  assert.equal(data.categories.bakery.items.bananas.done, true);
  assert.equal(data.categories.bakery.items.bananas.position, 0.5);
  await assert.rejects(writeShop(alice, 'alice', [write('items', 'apples', { groupId: 'missing' })]));
  assert.equal((await readShop(alice, 'alice', shopId)).items.apples.groupId, 'fruits');
});

test('rules protect the document envelope and immutable creation time', async () => {
  const ref = doc(bob, 'shops', shopId);
  for (const fields of [{ createdAt: 99 }, { name: '' }, { name: 123 }, { schemaVersion: 3 }, { categories: [] }, { unrelated: true }]) {
    await assertFails(updateDoc(ref, fields));
  }
});

test('nested records are validated on read and write; tombstones survive round trips', () => {
  const original = shop();
  original.groups.fruits.deleted = true;
  original.items.apples.deleted = true;
  const restored = decodeShop(shopId, encodeShop(original));
  assert.equal(restored.groups.fruits.deleted, true);
  assert.equal(restored.items.apples.deleted, true);
  for (const mutate of [
    d => { d.categories.fruits.items.apples.done = 'yes'; },
    d => { d.categories.fruits.icon = 'invalid'; },
    d => { d.categories.fruits.items = null; },
    d => { d.categories.bakery.items.apples = d.categories.fruits.items.apples; },
  ]) {
    const data = encodeShop(shop()); mutate(data);
    assert.throws(() => decodeShop(shopId, data));
  }
});

test('one remote snapshot preserves all pending offline item and category edits', () => {
  let state = { ...emptyState(), shops: [shop()] };
  state = edit(state, write('items', 'offline', item('Offline bananas')));
  state = edit(state, write('groups', 'fruits', { name: 'Fresh fruit' }));
  const remote = shop(); remote.items.oranges = item('Remote oranges');
  state = mergeRemote(state, shopId, 'shop', { ...decodeShop(shopId, encodeShop(remote)) });
  assert.equal(state.shops[0].groups.fruits.name, 'Fresh fruit');
  assert.equal(state.shops[0].items.offline.name, 'Offline bananas');
  assert.equal(state.shops[0].items.oranges.name, 'Remote oranges');
  assert.equal(state.outbox.length, 2);
});

test('existing shops migrate once, preserve all data and leave legacy documents as a backup', async () => {
  const legacyId = 'BCDEFGHJKLMNPQRSTUVW';
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'shops', legacyId), { name: 'Old shop', createdAt: 1, groupOrder: ['fruits'] });
    await setDoc(doc(db, 'shops', legacyId, 'groups', 'fruits'), group);
    await setDoc(doc(db, 'shops', legacyId, 'items', 'apples'), item('Legacy apples'));
  });
  await writeShop(alice, 'alice', [write('items', 'apples', { done: true }, legacyId)]);
  const result = await readShop(bob, 'bob', legacyId);
  assert.equal(result.name, 'Old shop');
  assert.equal(result.items.apples.name, 'Legacy apples');
  assert.equal(result.items.apples.done, true);
  assert.equal((await getDoc(doc(alice, 'shops', legacyId, 'items', 'apples'))).data().done, false);
  await assertFails(updateDoc(doc(alice, 'shops', legacyId, 'items', 'apples'), { done: true }));
});

test('an offline item patch restores a missing shared document from the complete local shop', async () => {
  const source = { ...shop(), id: 'CDEFGHJKLMNPQRSTUVWX' };
  source.items.apples.done = true;
  await writeShop(alice, 'alice', [write('items', 'apples', { name: 'Restored apples' }, source.id)], source);
  const result = await readShop(bob, 'bob', source.id);
  assert.equal(result.name, source.name);
  assert.equal(result.createdAt, source.createdAt);
  assert.deepEqual(result.groupOrder, source.groupOrder);
  assert.equal(result.groups.bakery.name, 'Bakery');
  assert.equal(result.items.apples.name, 'Restored apples');
  assert.equal(result.items.apples.done, true);
});

test('sharing verifies or recreates a document and never replaces newer remote edits with a stale local copy', async () => {
  const source = { ...shop(), id: 'DEFGHJKLMNPQRSTUVWXY' };
  await writeShop(alice, 'alice', [], source);
  await writeShop(bob, 'bob', [write('items', 'remote', item('Added on another device'), source.id)]);
  await writeShop(alice, 'alice', [], source);
  const result = await readShop(alice, 'alice', source.id);
  assert.equal(result.items.remote.name, 'Added on another device');
  assert.equal(result.items.apples.name, 'Apples');
});

test('private local shops cannot be uploaded by recovery', async () => {
  const source = { ...shop(), id: 'FGHJKLMNPQRSTUVWXYZA', shared: false };
  await assert.rejects(writeShop(alice, 'alice', [], source), /Use Share shop ID/);
  assert.equal((await getDoc(doc(alice, 'shops', source.id))).exists(), false);
});

test('a shared-shop listener restores a missing server document even with an empty SDK cache', async () => {
  const source = { ...shop(), id: 'EFGHJKLMNPQRSTUVWXYZ' };
  let stop;
  const restored = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop?.(); reject(new Error('Shared shop was not restored')); }, 10000);
    stop = watchShopDocument(alice, 'alice', source.id, result => {
      clearTimeout(timer); stop(); resolve(result);
    }, error => { clearTimeout(timer); stop?.(); reject(error); }, source);
  });
  const result = await restored;
  assert.equal(result.items.apples.name, 'Apples');
  assert.equal((await readShop(bob, 'bob', source.id)).groups.fruits.name, 'Fruits');
});

test('stopping sharing removes remote contents and permanently disables the invitation', async () => {
  const id = 'ZZZZZZZZZZZZZZZZZZZZ';
  const local = { ...shop(), id };
  await writeShop(alice, 'alice', [], local);
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'shops', id, 'members', 'bob'), { uid: 'bob' });
    await setDoc(doc(context.firestore(), 'shops', id, 'groups', 'legacy'), group);
  });
  await stopShopSharing(alice, id);
  const tombstone = (await getDoc(doc(bob, 'shops', id))).data();
  assert.deepEqual(tombstone.categories, {});
  assert.equal(tombstone.stopped, true);
  await assertFails(getDoc(doc(bob, 'shops', id, 'groups', 'legacy')));
  await assertFails(setDoc(doc(bob, 'shops', id, 'members', 'outsider'), { uid: 'outsider' }));
  await assert.rejects(readShop(bob, 'bob', id), /Sharing has stopped/);
  await assert.rejects(writeShop(bob, 'bob', [], local), /Sharing has stopped/);
  await assertFails(setDoc(doc(bob, 'shops', id), encodeShop(local)));
});
