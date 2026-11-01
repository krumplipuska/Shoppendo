import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOLD_MS, edgeVelocity, moveTo, previewOrder, rowTop, sameOrder } from '../src/reorder.ts';
import { activeItems, listItems, planItemMove, reorderShops, unobservedWrites } from '../src/model.ts';

test('300ms activation constant; empty, single and two-row lists clamp safely', () => {
  assert.equal(HOLD_MS, 300);
  assert.deepEqual(previewOrder([], {}, 'a', 999), []);
  assert.deepEqual(previewOrder(['a'], { a: 80 }, 'a', -999), ['a']);
  assert.deepEqual(previewOrder(['a'], { a: 80 }, 'a', 999), ['a']);
  assert.deepEqual(previewOrder(['a', 'b'], { a: 80, b: 60 }, 'a', 999), ['b', 'a']);
  assert.deepEqual(previewOrder(['a', 'b'], { a: 80, b: 60 }, 'b', -999), ['b', 'a']);
});

test('every source reaches every slot, preserving total height and a single exact gap', () => {
  for (const sizes of [[64, 64], [40, 180, 52, 92], Array.from({ length: 100 }, (_, i) => 40 + i % 7 * 13)]) {
    const ids = sizes.map((_, i) => `row-${i}`);
    const heights = Object.fromEntries(ids.map((id, i) => [id, sizes[i]]));
    for (const source of ids) for (let to = 0; to < ids.length; to++) {
      const expected = moveTo(ids, source, to);
      const top = rowTop(expected, heights, source);
      const preview = previewOrder(ids, heights, source, top);
      assert.deepEqual(preview, expected);
      assert.deepEqual(previewOrder(preview, heights, source, top), expected, 'stable when finger stops');
      let nextTop = 0;
      for (const id of preview) { assert.equal(rowTop(preview, heights, id), nextTop); nextTop += heights[id]; }
      assert.equal(nextTop, sizes.reduce((a, b) => a + b));
      assert.equal(new Set(preview).size, ids.length);
    }
  }
});

test('threshold hysteresis prevents oscillation and allows reversing direction', () => {
  const heights = { a: 60, b: 100, c: 40 };
  const original = ['a', 'b', 'c'];
  assert.equal(previewOrder(original, heights, 'a', 52), original);
  const moved = previewOrder(original, heights, 'a', 54);
  assert.deepEqual(moved, ['b', 'a', 'c']);
  for (const top of [53, 51, 49, 48]) assert.equal(previewOrder(moved, heights, 'a', top), moved);
  assert.deepEqual(previewOrder(moved, heights, 'a', 46), original);
});

test('edge scroll is bounded, continuous, symmetric and faster near the edge', () => {
  assert.equal(edgeVelocity(300, 100, 400), 0);
  assert.equal(edgeVelocity(100, 100, 400), -720);
  assert.equal(edgeVelocity(500, 100, 400), 720);
  assert.equal(edgeVelocity(-1000, 100, 400), -720);
  assert.equal(edgeVelocity(1000, 100, 400), 720);
  assert.equal(edgeVelocity(50, 0, 0), 0);
  for (let distance = 1; distance < 80; distance++) {
    const up = edgeVelocity(100 + distance, 100, 400);
    assert.equal(up, -edgeVelocity(500 - distance, 100, 400));
    assert.ok(up > edgeVelocity(99 + distance, 100, 400));
  }
});

test('every item drop persists exactly its preview, including category boundaries', () => {
  const makeItem = (groupId, position) => ({ name: 'Item', groupId, position, createdAt: 1, updatedAt: 1, done: false, deleted: false });
  const shop = { id: 'shop', name: 'Shop', createdAt: 1, shared: true, groupOrder: ['fruit', 'bread'],
    groups: { fruit: { name: 'Fruit', createdAt: 1 }, bread: { name: 'Bread', createdAt: 1 } },
    items: { apple: makeItem('fruit', 1), pear: makeItem('fruit', 2), loaf: makeItem('bread', 1), roll: makeItem('bread', 2) } };
  const ids = listItems(shop).map(([id]) => id);
  for (const id of ids) for (let to = 0; to < ids.length; to++) {
    const from = ids.indexOf(id);
    if (from === to) continue;
    const order = moveTo(ids, id, to);
    const neighbor = order[to > from ? to - 1 : to + 1];
    const groupId = shop.items[neighbor].groupId;
    const group = activeItems(shop, groupId).map(([key]) => key).filter(key => key !== id);
    const before = to > from ? group[group.indexOf(neighbor) + 1] ?? null : neighbor;
    const next = structuredClone(shop);
    for (const [key, patch] of Object.entries(planItemMove(shop, id, groupId, before))) Object.assign(next.items[key], patch);
    assert.deepEqual(listItems(next).map(([key]) => key), order);
  }
  assert.deepEqual(planItemMove(shop, 'apple', 'fruit', 'pear'), {});
  assert.deepEqual(planItemMove(shop, 'roll', 'bread'), {});
  const shops = [shop]; assert.equal(reorderShops(shops, ['shop']), shops);
  assert.equal(sameOrder(ids, [...ids]), true);
});

test('acknowledged writes protect only fields not yet observed and coalesce repeated moves', () => {
  const write = (id, data) => ({ id, shopId: 'shop', target: 'items', entityId: 'a', data });
  const writes = [write('1', { position: 10, groupId: 'fruit' }), write('2', { position: 20 })];
  const remote = { items: { a: { position: 10, groupId: 'fruit' } } };
  assert.deepEqual(unobservedWrites(writes, remote).map(w => w.data), [{ position: 20 }]);
  remote.items.a.position = 20;
  assert.deepEqual(unobservedWrites(writes, remote), []);
});
