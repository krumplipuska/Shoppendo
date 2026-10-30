import { GROUP_ICONS } from '../src/model.ts';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, onSnapshot } from 'firebase/firestore';

const shopId = 'ABCDEFGHJKLMNPQRSTUV';
const group = { name: 'Fruits', createdAt: 1 };
const item = name => ({ name, groupId: 'fruits', done: false, deleted: false, createdAt: 1, updatedAt: 1 });
let env, alice, bob, outsider;

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-shoppendo', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
  alice = env.authenticatedContext('alice').firestore();
  bob = env.authenticatedContext('bob').firestore();
  outsider = env.authenticatedContext('outsider').firestore();
});
after(async () => { await env?.cleanup(); });

test('a shop, membership, groups and items can be published in one atomic batch', async () => {
  const batch = writeBatch(alice);
  batch.set(doc(alice, 'shops', shopId), { name: 'Market', groupOrder: ['fruits'], createdAt: 1 });
  batch.set(doc(alice, 'shops', shopId, 'members', 'alice'), { uid: 'alice' });
  batch.set(doc(alice, 'shops', shopId, 'groups', 'fruits'), group);
  batch.set(doc(alice, 'shops', shopId, 'items', 'apples'), item('Apples'));
  await assertSucceeds(batch.commit());
});

test('unauthenticated clients and users who have not joined cannot read items', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, 'shops', shopId)));
  await assertFails(getDoc(doc(outsider, 'shops', shopId, 'items', 'apples')));
  await assertFails(setDoc(doc(outsider, 'shops', shopId, 'items', 'bad'), item('Bad')));
  await assertFails(setDoc(doc(outsider, 'shops', shopId, 'members', 'alice'), { uid: 'alice' }));
});

test('shop IDs cannot be discovered by listing shops, and short IDs cannot be published', async () => {
  await assertFails(getDocs(collection(outsider, 'shops')));
  await assertFails(setDoc(doc(outsider, 'shops', '1234'), { name: 'Guessable', groupOrder: [], createdAt: 1 }));
});

test('a second person can join by ID and both people can add without losing each other’s items', async () => {
  await assertSucceeds(getDoc(doc(bob, 'shops', shopId)));
  await assertSucceeds(setDoc(doc(bob, 'shops', shopId, 'members', 'bob'), { uid: 'bob' }));
  await Promise.all([
    assertSucceeds(setDoc(doc(alice, 'shops', shopId, 'items', 'bananas'), item('Bananas'))),
    assertSucceeds(setDoc(doc(bob, 'shops', shopId, 'items', 'oranges'), item('Oranges'))),
  ]);
  const snap = await getDocs(collection(bob, 'shops', shopId, 'items'));
  assert.deepEqual(snap.docs.map(d => d.data().name).sort(), ['Apples', 'Bananas', 'Oranges']);
});

test('realtime listeners receive another person checking an item', async () => {
  let stop;
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop?.(); reject(new Error('Realtime update did not arrive')); }, 10000);
    stop = onSnapshot(doc(bob, 'shops', shopId, 'items', 'apples'), snap => {
      if (snap.data()?.done) { clearTimeout(timer); stop(); resolve(); }
    }, reject);
  });
  await assertSucceeds(updateDoc(doc(alice, 'shops', shopId, 'items', 'apples'), { done: true, updatedAt: 2 }));
  await received;
});

test('rules reject malformed data, changes to immutable item fields and unknown collections', async () => {
  await assertFails(updateDoc(doc(bob, 'shops', shopId, 'items', 'apples'), { done: 'yes' }));
  await assertFails(updateDoc(doc(bob, 'shops', shopId, 'items', 'apples'), { createdAt: 99 }));
  await assertFails(updateDoc(doc(bob, 'shops', shopId, 'items', 'apples'), { groupId: 'unrelated' }));
  await assertFails(setDoc(doc(bob, 'shops', shopId, 'items', 'blank'), item('')));
  await assertFails(setDoc(doc(bob, 'shops', shopId, 'items', 'orphan'), { ...item('Orphan'), groupId: 'missing' }));
  await assertFails(setDoc(doc(bob, 'otherData', 'public'), { open: true }));
});

test('members can choose group icons and move items, but cannot reference missing groups or invalid icons/positions', async () => {
  await assertSucceeds(updateDoc(doc(alice, 'shops', shopId, 'groups', 'fruits'), { icon: 'fruit' }));
  await assertSucceeds(setDoc(doc(alice, 'shops', shopId, 'groups', 'bakery'), { ...group, name: 'Bakery', icon: 'bread' }));
  await assertSucceeds(updateDoc(doc(bob, 'shops', shopId, 'items', 'bananas'), { groupId: 'bakery', position: 0.5 }));
  const moved = await getDoc(doc(alice, 'shops', shopId, 'items', 'bananas'));
  assert.equal(moved.data().groupId, 'bakery'); assert.equal(moved.data().position, 0.5);
  await assertFails(updateDoc(doc(bob, 'shops', shopId, 'groups', 'fruits'), { icon: 'invalid' }));
  await assertFails(updateDoc(doc(bob, 'shops', shopId, 'items', 'bananas'), { position: 'first' }));
  await assertFails(updateDoc(doc(bob, 'shops', shopId, 'items', 'bananas'), { position: Number.NaN }));
  await assertFails(updateDoc(doc(bob, 'shops', shopId, 'items', 'bananas'), { groupId: 'missing' }));
});

test('members can delete and restore a group without destroying its items; tombstones must be boolean', async () => {
  const ref = doc(alice, 'shops', shopId, 'groups', 'fruits');
  await assertSucceeds(updateDoc(ref, { deleted: true }));
  assert.equal((await getDoc(ref)).data().deleted, true);
  assert.equal((await getDoc(doc(bob, 'shops', shopId, 'items', 'apples'))).data().name, 'Apples');
  await assertFails(updateDoc(ref, { deleted: 'yes' }));
  await assertFails(updateDoc(doc(outsider, 'shops', shopId, 'groups', 'fruits'), { deleted: false }));
  await assertSucceeds(updateDoc(ref, { deleted: false }));
});


test('all 32 category icons can be saved by members', async () => {
  for (const icon of GROUP_ICONS) await assertSucceeds(updateDoc(doc(alice, 'shops', shopId, 'groups', 'fruits'), { icon }));
  assert.equal(GROUP_ICONS.length, 32);
});
