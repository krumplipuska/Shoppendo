import { entityTone } from '../src/theme.ts';
import { deleteSwipeProgress, backSwipeDirection, swipeAxis, keyboardOverlap } from '../src/interaction.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acknowledge, activeItems, applyWrite, applyWritesMerged, duplicateItems, forgetItem, decodeSaved, doneItems, findListItem, missingItems, doneOverflow, MAX_DONE_ITEMS, edit, emptyState, formatCode, GROUP_ICONS, isGroup, itemSuggestions, listItems, mergeRemote, mergeCategoryOrder, normalizeCode, orderedGroups, planItemMove, reorderShops, STARTER_GROUPS, storeInitials, validName } from '../src/model.ts';

const code = 'ABCDEFGHJKLMNPQRSTUV';
const item = (name, groupId = 'fruit') => ({ name, groupId, done: false, deleted: false, createdAt: 1, updatedAt: 1 });
const shop = () => ({ id: code, name: 'Market', createdAt: 1, shared: true, groupOrder: ['fruit', 'bread'], groups: { fruit: { name: 'Fruits', createdAt: 1 }, bread: { name: 'Bakery', createdAt: 2 } }, items: { apple: item('Apples'), loaf: item('Bread', 'bread') } });
const state = () => ({ ...emptyState(), shops: [shop()] });
const write = (id, target, entityId, data) => ({ id, shopId: code, target, entityId, data });

test('unchanged patches keep the same state and do not grow the outbox', () => {
  const original = state();
  for (const patch of [write('name', 'shop', '', { name: original.shops[0].name }),
    write('order', 'shop', '', { groupOrder: [...original.shops[0].groupOrder] }),
    write('group', 'groups', 'fruit', { name: 'Fruits' }),
    write('item', 'items', 'apple', { done: false })]) {
    assert.equal(edit(original, patch), original);
  }
  assert.equal(edit(original, write('changed', 'shop', '', { name: 'New name' })).outbox.length, 1);
});

test('shop IDs normalize case and separators, rejecting malformed or guessable short codes', () => {
  assert.equal(normalizeCode(`  ${formatCode(code).toLowerCase()}  `), code);
  for (const value of ['1234', 'ABCDEFGH1KLMNPQRSTUV', '../shops/anything', '']) assert.equal(normalizeCode(value), null);
  assert.throws(() => validName('   '));
  assert.equal(validName(' Bananas '), 'Bananas');
});

test('checking an item moves it to Done; unchecking restores its original group', () => {
  let data = edit(state(), write('toggle', 'items', 'apple', { done: true, updatedAt: 10 }));
  assert.deepEqual(activeItems(data.shops[0], 'fruit'), []);
  assert.equal(doneItems(data.shops[0])[0][1].name, 'Apples');
  data = edit(data, write('undo', 'items', 'apple', { done: false, updatedAt: 11 }));
  assert.equal(activeItems(data.shops[0], 'fruit')[0][0], 'apple');
  assert.deepEqual(doneItems(data.shops[0]), []);
});

test('an older remote snapshot cannot overwrite pending local additions, checks, or deletions', () => {
  let data = edit(state(), write('add', 'items', 'banana', item('Bananas')));
  data = edit(data, write('check', 'items', 'apple', { done: true, updatedAt: 2 }));
  data = edit(data, write('delete', 'items', 'loaf', { deleted: true, updatedAt: 3 }));
  data = mergeRemote(data, code, 'items', { apple: item('Apples'), loaf: item('Bread', 'bread'), remote: item('Oranges') });
  assert.equal(data.shops[0].items.banana.name, 'Bananas');
  assert.equal(data.shops[0].items.apple.done, true);
  assert.equal(data.shops[0].items.loaf.deleted, true);
  assert.equal(data.shops[0].items.remote.name, 'Oranges');
});

test('acknowledging a network batch retains edits made while it was in flight', () => {
  let data = edit(state(), write('first', 'items', 'apple', { done: true }));
  data = edit(data, write('second', 'items', 'apple', { done: false }));
  data = acknowledge(data, ['first']);
  assert.deepEqual(data.outbox.map(w => w.id), ['second']);
  assert.equal(data.shops[0].items.apple.done, false);
});

test('group reordering retains groups another person just added', () => {
  let data = edit(state(), write('order', 'shop', '', { groupOrder: ['bread', 'fruit'] }));
  data = mergeRemote(data, code, 'groups', { ...data.shops[0].groups, clean: { name: 'Cleaning', createdAt: 4 } });
  assert.deepEqual(orderedGroups(data.shops[0]), ['bread', 'fruit', 'clean']);
  assert.equal(data.shops[0].items.apple.groupId, 'fruit');
});

test('local-only edits stay off the network and survive serialization', () => {
  const local = state(); local.shops[0].shared = false;
  const data = edit(local, write('check', 'items', 'apple', { done: true }));
  assert.deepEqual(data.outbox, []);
  assert.deepEqual(decodeSaved(JSON.stringify(data)), data);
  assert.throws(() => decodeSaved('{broken'));
  assert.throws(() => decodeSaved(JSON.stringify({ ...data, version: 99 })));
});

test('item moves reorder within a group and transfer to another group without changing unrelated fields', () => {
  let data = state();
  data.shops[0].items.pear = { ...item('Pears'), position: 2048 };
  data.shops[0].items.apple.position = 1024;
  const move = (id, group, before = null) => {
    for (const [key, patch] of Object.entries(planItemMove(data.shops[0], id, group, before))) data = edit(data, write(key, 'items', key, patch));
  };
  move('pear', 'fruit', 'apple');
  assert.deepEqual(activeItems(data.shops[0], 'fruit').map(([id]) => id), ['pear', 'apple']);
  move('pear', 'bread');
  assert.deepEqual(activeItems(data.shops[0], 'bread').map(([id]) => id), ['loaf', 'pear']);
  assert.equal(data.shops[0].items.pear.name, 'Pears');
  data = edit(data, write('check', 'items', 'pear', { done: true }));
  data = edit(data, write('undo', 'items', 'pear', { done: false }));
  assert.deepEqual(activeItems(data.shops[0], 'bread').map(([id]) => id), ['loaf', 'pear']);
  assert.deepEqual(planItemMove(data.shops[0], 'apple', 'missing'), {});
  assert.deepEqual(planItemMove(data.shops[0], 'apple', 'fruit', 'missing'), {});
});

test('tied legacy timestamps and exhausted numeric gaps are re-spaced without losing items', () => {
  const data = shop();
  data.items.pear = item('Pears'); data.items.orange = item('Oranges');
  for (const [key, patch] of Object.entries(planItemMove(data, 'orange', 'fruit', 'pear'))) Object.assign(data.items[key], patch);
  assert.deepEqual(activeItems(data, 'fruit').map(([id]) => id), ['apple', 'orange', 'pear']);
  data.items.apple.position = 1e16; data.items.orange.position = 1e16 + 2;
  data.items.pear.position = 1e16 + 4;
  for (const [key, patch] of Object.entries(planItemMove(data, 'pear', 'fruit', 'orange'))) Object.assign(data.items[key], patch);
  assert.deepEqual(activeItems(data, 'fruit').map(([id]) => id), ['apple', 'pear', 'orange']);
});

test('icons and positions persist while old saved lists still load unchanged', () => {
  const data = state();
  assert.deepEqual(decodeSaved(JSON.stringify(data)), data);
  data.shops[0].groups.fruit.icon = 'fruit'; data.shops[0].items.apple.position = 0.5;
  assert.deepEqual(decodeSaved(JSON.stringify(data)), data);
  data.shops[0].groups.fruit.icon = 'unknown';
  assert.throws(() => decodeSaved(JSON.stringify(data)));
  assert.equal(storeInitials(' Green Market '), 'GM'); assert.equal(storeInitials('aldi'), 'A');
  assert.equal(STARTER_GROUPS.length, 6); assert.equal(new Set(STARTER_GROUPS.map(g => g.name)).size, 6);
});

test('deleting a group hides its active and completed items, survives stale snapshots, and can be undone', () => {
  let data = state();
  data.shops[0].items.pear = { ...item('Pears'), done: true };
  data = edit(data, write('delete-group', 'groups', 'fruit', { deleted: true }));
  data = mergeRemote(data, code, 'groups', shop().groups);
  assert.deepEqual(orderedGroups(data.shops[0]), ['bread']);
  assert.deepEqual(activeItems(data.shops[0], 'fruit'), []);
  assert.deepEqual(doneItems(data.shops[0]), []);
  assert.deepEqual(planItemMove(data.shops[0], 'loaf', 'fruit'), {});
  assert.deepEqual(decodeSaved(JSON.stringify(data)), data);
  data = edit(data, write('restore-group', 'groups', 'fruit', { deleted: false }));
  assert.deepEqual(orderedGroups(data.shops[0]), ['fruit', 'bread']);
  assert.equal(activeItems(data.shops[0], 'fruit')[0][0], 'apple');
  assert.equal(doneItems(data.shops[0])[0][0], 'pear');
});

test('store reordering preserves the lists and rejects missing or duplicate IDs', () => {
  const stores = [shop(), { ...shop(), id: 'second', name: 'Second store' }];
  const reordered = reorderShops(stores, ['second', code]);
  assert.equal(reordered[0], stores[1]); assert.equal(reordered[1], stores[0]);
  for (const invalid of [[code], [code, code], [code, 'missing']]) assert.equal(reorderShops(stores, invalid), stores);
});


test('flat lists follow category order and item positions, excluding done, deleted, and orphan items', () => {
  const data = shop();
  data.groupOrder = ['bread', 'fruit'];
  data.groups.clean = { name: 'Cleaning', createdAt: 3 };
  data.groups.hidden = { name: 'Hidden', createdAt: 4, deleted: true };
  data.items = {
    apple: { ...item('Apples'), position: 20 },
    banana: { ...item('Bananas'), position: 10 },
    loaf: item('Bread', 'bread'),
    towel: item('Towels', 'clean'),
    checked: { ...item('Checked'), done: true },
    deleted: { ...item('Deleted'), deleted: true },
    hidden: item('Hidden', 'hidden'),
    orphan: item('Unknown', 'missing'),
  };
  assert.deepEqual(listItems(data).map(([id]) => id), ['loaf', 'banana', 'apple', 'towel']);
  data.groupOrder = ['fruit', 'bread', 'clean'];
  assert.deepEqual(listItems(data).map(([id]) => id), ['banana', 'apple', 'loaf', 'towel']);
});

test('view preferences persist locally while old lists and unknown preferences remain readable', () => {
  const original = state();
  assert.deepEqual(decodeSaved(JSON.stringify(original)), original);
  for (const viewMode of ['list', 'groups']) {
    assert.equal(decodeSaved(JSON.stringify({ ...original, viewMode })).viewMode, viewMode);
  }
  const recovered = decodeSaved(JSON.stringify({ ...original, viewMode: 'future-view' }));
  assert.equal(recovered.viewMode, undefined);
  assert.deepEqual(recovered.shops, original.shops);
});


test('item suggestions reuse previous names and categories, deduplicate, and prefer current-store history', () => {
  const current = shop();
  current.items = {
    apple: { ...item('Apples'), done: true, updatedAt: 12 },
    old: { ...item('apples', 'bread'), deleted: true, updatedAt: 5 },
    soap: { ...item('Hand soap', 'bread'), deleted: true, updatedAt: 9 },
  };
  const other = { ...shop(), id: 'ZZZZZZZZZZZZZZZZZZZZ', groups: { produce: { name: 'Fruits', createdAt: 1 } },
    items: { apple: { ...item('APPLES', 'produce'), updatedAt: 100 }, apricot: item('Apricots', 'produce') } };
  assert.deepEqual(itemSuggestions([other, current], current, '  AP  '), [
    { name: 'Apples', groupId: 'fruit' }, { name: 'Apricots', groupId: 'fruit' }, { name: 'Hand soap', groupId: 'bread' },
  ]);
  assert.deepEqual(itemSuggestions([current], current, 'soap'), [{ name: 'Hand soap', groupId: 'bread' }]);
  assert.deepEqual(itemSuggestions([current], current, '  '), []);
  current.groups.fruit.deleted = true;
  assert.deepEqual(itemSuggestions([other, current], current, 'ap'), [{ name: 'apples', groupId: 'bread' }, { name: 'Hand soap', groupId: 'bread' }]);
});

test('category changes can move completed items without unchecking them while normal drags still reject them', () => {
  const data = shop();
  data.items.apple.done = true;
  assert.deepEqual(planItemMove(data, 'apple', 'bread'), {});
  const changes = planItemMove(data, 'apple', 'bread', null, true);
  assert.equal(changes.apple.groupId, 'bread');
  assert.ok(changes.apple.position > (data.items.loaf.position ?? data.items.loaf.createdAt));
  assert.equal('done' in changes.apple, false);
  const moved = { ...data.items.apple, ...changes.apple };
  assert.equal(moved.done, true);
  data.groups.bread.deleted = true;
  assert.deepEqual(planItemMove(data, 'apple', 'bread', null, true), {});
});


test('entity colors differ within a list and remain stable when its order changes', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `entity-${i}`);
  const colors = ids.map(id => entityTone(id, ids).color);
  assert.equal(new Set(colors).size, ids.length);
  for (const id of ids) assert.deepEqual(entityTone(id, ids), entityTone(id, [...ids].reverse()));
});

test('Delete reveal follows finger distance in both directions and clamps at the endpoints', () => {
  assert.equal(deleteSwipeProgress(0, 0), 0);
  assert.equal(deleteSwipeProgress(-42, 0), 0.5);
  assert.equal(deleteSwipeProgress(-84, 0), 1);
  assert.equal(deleteSwipeProgress(-200, 0), 1);
  assert.equal(deleteSwipeProgress(42, 1), 0.5);
  assert.equal(deleteSwipeProgress(100, 1), 0);
});

test('back gestures require deliberate distance or a directional flick and never dismiss upward', () => {
  assert.equal(backSwipeDirection(-80, 2), 'left');
  assert.equal(backSwipeDirection(80, 2), 'right');
  assert.equal(backSwipeDirection(0, 110), 'down');
  assert.equal(backSwipeDirection(-30, 0, -700, 0), 'left');
  assert.equal(backSwipeDirection(0, 30, 0, 800), 'down');
  assert.equal(backSwipeDirection(10, 5, 900, 0), null);
  assert.equal(backSwipeDirection(40, 0, -900, 0), null);
  assert.equal(backSwipeDirection(0, -150, 0, -900), null);
});


test('zero-distance activation does not prematurely lock the back gesture axis', () => {
  assert.equal(swipeAxis(0, 0), 0);
  assert.equal(swipeAxis(1, -1), 0);
  assert.equal(swipeAxis(-30, 4), 1);
  assert.equal(swipeAxis(2, 30), 2);
});

// The drag preview is transient: persistence still happens only on drop.
test('drag preview opens the correct gap in either direction and across categories', async () => {
  const { itemDragLayout, shouldStartListPull } = await import('../src/interaction.ts');
  assert.deepEqual(itemDragLayout(['a','b','c','d'], { source:'a', target:'c', after:true, height:52 }), { shifts:{b:-52,c:-52,d:0}, delta:0 });
  assert.deepEqual(itemDragLayout(['a','b','c'], { source:'c', target:'a', after:false, height:52 }), { shifts:{a:52,b:52}, delta:0 });
  assert.deepEqual(itemDragLayout(['a','b'], { source:'a', target:'c', after:false, height:52 }), { shifts:{b:-52}, delta:-52 });
  assert.deepEqual(itemDragLayout(['c','d'], { source:'a', target:'c', after:false, height:52 }), { shifts:{c:52,d:52}, delta:52 });
  assert.deepEqual(itemDragLayout(['a','b'], { source:'a', target:'a', after:true, height:52 }), { shifts:{}, delta:0 });
  assert.equal(shouldStartListPull(2,40,0), true);
  assert.equal(shouldStartListPull(2,40,30), false);
  assert.equal(shouldStartListPull(40,20,0), false);
  assert.equal(shouldStartListPull(0,-40,0), false);
});

test('Done and Missing follow the store order: category order, then position within a category', () => {
  const data = shop();
  data.groupOrder = ['bread', 'fruit'];
  data.items.apple = { ...data.items.apple, done:true, updatedAt:40, position: 2048 };
  data.items.pear = { ...item('Pears'), done:true, updatedAt:50, position: 1024 };
  data.items.loaf = { ...data.items.loaf, done:true, updatedAt:20 };
  assert.deepEqual(doneItems(data).map(([id])=>id), ['loaf','pear','apple'], 'not by completion time');
  for (const id of ['apple', 'pear', 'loaf']) data.items[id] = { ...data.items[id], done: false, missing: true };
  assert.deepEqual(missingItems(data).map(([id])=>id), ['loaf','pear','apple']);
});

test('active list sorting supports group order, case-insensitive names, and time added', () => {
  const data = shop();
  data.items.apple = { ...data.items.apple, name:'Zucchini', createdAt:30, position:1 };
  data.items.loaf = { ...data.items.loaf, name:'apricots', createdAt:10, position:2 };
  data.items.pear = { ...item('Bananas'), createdAt:20, position:3 };
  assert.deepEqual(listItems(data).map(([id])=>id), ['apple','pear','loaf']);
  assert.deepEqual(listItems(data,'name').map(([id])=>id), ['loaf','pear','apple']);
  assert.deepEqual(listItems(data,'added').map(([id])=>id), ['loaf','pear','apple']);
  assert.deepEqual(activeItems(data,'fruit','name').map(([id])=>id), ['pear','apple']);
  const saved = { ...state(), itemSort:'name' };
  assert.equal(decodeSaved(JSON.stringify(saved)).itemSort,'name');
  assert.equal(decodeSaved(JSON.stringify({...saved,itemSort:'unknown'})).itemSort,undefined);
});


test('each store keeps its own category order, used by group sorting and all category pickers', () => {
  const first = shop(); const second = { ...shop(), id:'second', groupOrder:['fruit','bread'] };
  first.groupOrder = ['bread','fruit'];
  assert.deepEqual(orderedGroups(first), ['bread','fruit']);
  assert.deepEqual(listItems(first).map(([id])=>id), ['loaf','apple']);
  assert.deepEqual(orderedGroups(second), ['fruit','bread']);
  assert.deepEqual(listItems(second).map(([id])=>id), ['apple','loaf']);
  assert.equal(GROUP_ICONS.length,32);
  assert.equal(new Set(GROUP_ICONS).size,32);
  for (const icon of GROUP_ICONS) assert.equal(isGroup({ name:'Category', createdAt:1, icon }), true);
});


test('category order drafts leave the store untouched until applied and preserve concurrent changes', () => {
  const data = shop(); const draft = ['bread','fruit'];
  const merged = mergeCategoryOrder(orderedGroups(data), draft);
  assert.deepEqual(data.groupOrder, ['fruit','bread']);
  assert.deepEqual(merged, ['bread','fruit']);
  assert.deepEqual(mergeCategoryOrder(['fruit','new'], ['bread','fruit','fruit']), ['fruit','new']);
});


test('Done retains the newest 100 and pruning never removes active items or other stores', () => {
  const data = shop();
  for (let n=0;n<103;n++) data.items['done'+n] = { ...item('Done '+n), done:true, updatedAt:n+10 };
  data.items.deleted = { ...item('Already deleted'), done:true, deleted:true, updatedAt:0 };
  assert.equal(MAX_DONE_ITEMS,100);
  assert.deepEqual(doneOverflow(data), ['done2','done1','done0']);
  assert.equal(doneItems(data).length,100);
  assert.ok(!doneItems(data).some(([id]) => ['done0','done1','done2'].includes(id)), 'Done keeps the newest 100 completions');
  let saved = { ...emptyState(), shops:[data,{...shop(),id:'other-shop'}] };
  for (const entityId of doneOverflow(data)) saved = edit(saved, write('trim'+entityId,'items',entityId,{deleted:true,updatedAt:1000}));
  assert.deepEqual(doneOverflow(saved.shops[0]),[]);
  assert.equal(saved.shops[0].items.apple.deleted,false);
  assert.equal(saved.shops[1].items.apple.deleted,false);
  const replay = mergeRemote(saved,code,'items',data.items);
  assert.equal(replay.shops[0].items.done0.deleted,true);
});


test('drag gaps support dropping at the bottom, including moving the first row past every neighbor', async () => {
  const { itemDragLayout } = await import('../src/interaction.ts');
  assert.deepEqual(itemDragLayout(['a','b','c'],{source:'a',target:'c',after:true,height:70}),{shifts:{b:-70,c:-70},delta:0});
  assert.deepEqual(itemDragLayout(['a','b','c'],{source:'c',target:'c',after:true,height:70}),{shifts:{},delta:0});
});

test('modal keyboard inset lifts iPhone panels and avoids double lifting resized windows', () => {
  const keyboard = { screenY: 524, height: 320 };
  assert.equal(keyboardOverlap(844, keyboard), 320);
  assert.equal(keyboardOverlap(600, keyboard), 76);
  assert.equal(keyboardOverlap(524, keyboard), 0);
  assert.equal(keyboardOverlap(844, { screenY: 844, height: 0 }), 0);
  assert.equal(keyboardOverlap(844), 0);
});

test('all drag directions use the displayed insertion slot, including variable row heights', async () => {
  const { dragOrder, dragSlotTop, itemDragLayout } = await import('../src/interaction.ts');
  const ids = ['a', 'b', 'c', 'd'];
  for (const sizes of [[64, 64, 64, 64], [64, 110, 52, 92]]) {
    const tops = sizes.map((_, index) => sizes.slice(0, index).reduce((sum, size) => sum + size, 0));
    for (const source of ids) for (const target of ids) for (const after of [false, true]) {
      const drag = { source, target, after, height: sizes[ids.indexOf(source)] };
      const order = dragOrder(ids, drag);
      const layout = itemDragLayout(ids, drag);
      let top = 0;
      for (const id of order) {
        const index = ids.indexOf(id);
        if (id !== source) assert.equal(tops[index] + (layout.shifts[id] ?? 0), top, `${source} -> ${target}, after=${after}, ${id}`);
        else if (source !== target) assert.equal(dragSlotTop(ids, drag, tops[ids.indexOf(target)], sizes[ids.indexOf(target)]), top);
        top += sizes[index];
      }
      assert.equal(layout.delta, 0);
    }
  }
  assert.equal(dragOrder(ids, { source: 'missing', target: 'a', after: false }), ids);
});

test('item persistence matches the preview when moving down, up, or across category boundaries', async () => {
  const { dragOrder } = await import('../src/interaction.ts');
  const base = shop();
  base.items = { apple: { ...item('Apple'), position: 1 }, pear: { ...item('Pear'), position: 2 },
    loaf: { ...item('Bread', 'bread'), position: 1 }, roll: { ...item('Roll', 'bread'), position: 2 } };
  const ids = listItems(base).map(([id]) => id);
  for (const source of ids) for (const target of ids) for (const after of [false, true]) {
    if (source === target) continue;
    const data = structuredClone(base);
    const groupId = data.items[target].groupId;
    const group = activeItems(data, groupId).map(([id]) => id).filter(id => id !== source);
    const before = after ? group[group.indexOf(target) + 1] ?? null : target;
    for (const [id, patch] of Object.entries(planItemMove(data, source, groupId, before))) Object.assign(data.items[id], patch);
    assert.deepEqual(listItems(data).map(([id]) => id), dragOrder(ids, { source, target, after }), `${source} -> ${target}, after=${after}`);
  }
});

test('release resolves current receiver and respects source-removed insertion slots', async () => {
  const { itemDropSlot } = await import('../src/model.ts');
  const data = shop();
  data.items = Object.fromEntries(['A','B','C','D'].map(id => [id, item(id)]));
  for (const [source, target, after, expected] of [
    ['A','C',true,'BCAD'], ['D','B',false,'ADBC'], ['B','C',true,'ACBD'],
    ['C','A',false,'CABD'], ['B','D',true,'ACDB'],
  ]) {
    const copy = structuredClone(data);
    const slot = itemDropSlot(copy, source, target, after);
    for (const [id, patch] of Object.entries(planItemMove(copy, source, slot.groupId, slot.beforeId))) Object.assign(copy.items[id], patch);
    assert.equal(listItems(copy).map(([id]) => id).join(''), expected);
  }
  for (const [source, target, after] of [['B','C',false], ['B','A',true], ['A','A',true], ['missing','A',true], ['A','missing',false]]) {
    assert.equal(itemDropSlot(data, source, target, after), null);
  }
  data.items.B.groupId = 'bread';
  assert.deepEqual(itemDropSlot(data, 'A', 'B', true), { groupId: 'bread', beforeId: null });
  for (const key of ['done', 'deleted']) {
    data.items.B[key] = true;
    assert.equal(itemDropSlot(data, 'A', 'B', false), null);
    assert.equal(itemDropSlot(data, 'B', 'A', true), null);
    data.items.B[key] = false;
  }
});

test('movement centre and release top-left resolve the same slot with different row heights', async () => {
  const { insertionSide } = await import('../src/interaction.ts');
  const receiver = { width: 200, height: 80 }, source = { width: 200, height: 64 };
  for (const y of [-1, 0, 39, 40, 80, 81]) {
    const expected = y < 0 || y > 80 ? null : y >= 40;
    assert.equal(insertionSide({ x: 100, y }, receiver, source, false), expected);
    assert.equal(insertionSide({ x: 0, y: y - 32 }, receiver, source, true), expected);
  }
  assert.equal(insertionSide({ x: 0, y: 1 }, receiver, { width: 0, height: 64 }, true), null);
});

test('only the current session can finish, independently of animation completion', async () => {
  const { dragSession } = await import('../src/interaction.ts');
  const session = dragSession();
  const old = session.start(), current = session.start();
  const order = [];
  const commit = () => order.push('accepted');
  assert.equal(session.finish(old, commit), false);
  assert.equal(session.finish(current, commit), true);
  assert.equal(session.finish(current, commit), false);
  for (const reason of ['cancelled', 'outside receiver']) {
    const ended = session.start();
    assert.equal(session.finish(ended), true, reason);
    assert.equal(session.finish(ended, commit), false);
  }
  assert.deepEqual(order, ['accepted']);
});

test('installed Drax native and built adapters deliver one terminal event per active RNGH v3 pan', async () => {
  const { createRequire } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { runInNewContext } = await import('node:vm');
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const root = dirname(require.resolve('react-native-drax/package.json'));
  for (const path of ['src/compat/useDraxPanGesture.ts', 'lib/module/compat/useDraxPanGesture.js']) {
    const code = ts.transpile(readFileSync(join(root, path), 'utf8'), { module: ts.ModuleKind.CommonJS });
    const exports = {};
    runInNewContext(code, { exports, require: name => name.includes('detectVersion')
      ? { isGestureHandlerV3: () => true } : { usePanGesture: config => config } });
    const calls = [];
    const gesture = exports.useDraxPanGesture({
      onDeactivate: () => calls.push('drop'),
      onFinalize: (_, success) => { if (!success) calls.push('cancel'); },
    });
    // RNGH sends finalize even for a non-activated pan on a different row.
    gesture.onFinalize?.({ canceled: true });
    for (const canceled of [false, true]) {
      gesture.onDeactivate({ canceled });
      gesture.onFinalize?.({ canceled });
    }
    assert.deepEqual(calls, ['drop', 'cancel'], path);
  }
});

test('missing items persist separately and return to their picking order when restored', () => {
  const marked = edit(state(), write('mark', 'items', 'apple', { missing: true, done: false }));
  const saved = decodeSaved(JSON.stringify(marked));
  const store = saved.shops[0];
  assert.deepEqual(listItems(store).map(([id]) => id), ['loaf']);
  assert.deepEqual(missingItems(store).map(([id]) => id), ['apple']);
  assert.deepEqual(doneItems(store), []);
  const restored = edit(saved, write('restore', 'items', 'apple', { missing: false }));
  assert.deepEqual(listItems(restored.shops[0]).map(([id]) => id), ['apple', 'loaf']);
  assert.deepEqual(missingItems(restored.shops[0]), []);
});

test('remote snapshots that echo local data keep the same state; changes reuse untouched records', () => {
  const data = state();
  const local = data.shops[0];
  const echo = { name: local.name, groupOrder: [...local.groupOrder], groups: structuredClone(local.groups), items: structuredClone(local.items) };
  assert.equal(mergeRemote(data, code, 'shop', echo), data, 'an identical snapshot is a no-op');
  const changed = mergeRemote(data, code, 'shop', { ...echo, items: { ...echo.items, apple: { ...echo.items.apple, done: true } } });
  assert.notEqual(changed, data);
  assert.equal(changed.shops[0].items.apple.done, true);
  assert.equal(changed.shops[0].items.loaf, local.items.loaf, 'untouched items keep their identity');
  assert.equal(changed.shops[0].groups, local.groups, 'untouched groups keep their identity');
});

test('adding a name finds the item already on the list first, then the latest done or missing one', () => {
  const data = shop();
  data.items = {
    oldDone: { ...item('Milk'), done: true, updatedAt: 5 },
    newMissing: { ...item('milk ', 'bread'), missing: true, updatedAt: 9 },
    gone: { ...item('MILK'), deleted: true, updatedAt: 20 },
  };
  assert.equal(findListItem(data, '  MILK ')?.[0], 'newMissing', 'ignores case/spaces and deleted items; latest restorable wins');
  data.items.active = { ...item('Milk'), updatedAt: 1 };
  assert.equal(findListItem(data, 'milk')?.[0], 'active', 'an item still on the list wins');
  data.groups.fruit.deleted = true;
  assert.equal(findListItem(data, 'milk')?.[0], 'newMissing', 'items in deleted categories are ignored');
  assert.equal(findListItem(data, 'Bread'), undefined);
});

import { closeTrip, insertionPatches, learnedSlot, learnTrip, recordCheck, TRIP_GAP_MS } from '../src/model.ts';

// Learned pick-up order: checks within one trip teach "first before second" inside each category.
const fruitShop = names => ({ ...shop(), shared: false,
  items: Object.fromEntries(names.map((name, i) => [name.toLowerCase(), { ...item(name), position: (i + 1) * 1024 }])) });
const check = (data, name, at, done = true, groupId = 'fruit') => recordCheck(data, code, { key: name.toLowerCase(), groupId, at, done });
function trip(data, names, start) {
  names.forEach((name, i) => { data = check(data, name, start + i * 1000); });
  return closeTrip(data, start + names.length * 1000 + TRIP_GAP_MS);
}
const slotName = (data, name, list) => {
  const current = fruitShop(list);
  const before = learnedSlot(current, data.learning?.[code], name, 'fruit');
  return before === undefined ? 'unknown' : before === null ? 'last' : current.items[before].name;
};

test('two trips teach the pick-up order, and a new item is slotted between the items around it', () => {
  let data = { ...emptyState(), shops: [fruitShop([])] };
  data = trip(data, ['Apples', 'Bananas', 'Pears'], 0);
  data = trip(data, ['Apples', 'Bananas', 'Pears'], 10 * TRIP_GAP_MS);
  assert.equal(data.trip, undefined);
  assert.equal(slotName(data, 'Bananas', ['Apples', 'Pears']), 'Pears');
  assert.equal(slotName(data, 'apples ', ['Pears', 'Bananas']), 'Pears');
  assert.equal(slotName(data, 'Pears', ['Bananas', 'Apples']), 'last');
  // The position patch actually lands between the neighbours.
  const current = fruitShop(['Apples', 'Pears']);
  const patch = insertionPatches(current, 'fruit', 'new', item('Bananas'), 'pears').new;
  assert.ok(patch.position > current.items.apples.position && patch.position < current.items.pears.position);
});

test('a changed route takes over from the old order after a few trips', () => {
  let data = { ...emptyState(), shops: [fruitShop([])] };
  for (let i = 0; i < 3; i++) data = trip(data, ['Apples', 'Bananas', 'Pears'], i * 10 * TRIP_GAP_MS);
  assert.equal(slotName(data, 'Pears', ['Apples']), 'last');
  for (let i = 3; i < 6; i++) data = trip(data, ['Pears', 'Bananas', 'Apples'], i * 10 * TRIP_GAP_MS);
  assert.equal(slotName(data, 'Pears', ['Apples']), 'Apples');
});

test('short trips, unchecked items, and a still-running trip teach nothing', () => {
  let data = { ...emptyState(), shops: [fruitShop([])] };
  data = trip(data, ['Apples', 'Pears'], 0);
  assert.equal(data.learning, undefined);
  data = check(data, 'Pears', 1000);
  data = check(data, 'Apples', 2000);
  data = check(data, 'Pears', 3000, false);
  data = check(data, 'Bananas', 4000);
  data = check(data, 'Kiwi', 5000);
  assert.equal(closeTrip(data, 5000 + TRIP_GAP_MS - 1), data, 'the trip stays open within the gap');
  data = closeTrip(data, 5000 + TRIP_GAP_MS);
  assert.equal(data.learning[code].pairs.pears, undefined, 'the unchecked pick was forgotten');
  assert.ok(data.learning[code].pairs.apples.bananas > 0);
});

test('without learning, or for unknown items, adding keeps going last', () => {
  assert.equal(slotName(emptyState(), 'Apples', ['Pears']), 'unknown');
  let data = { ...emptyState(), shops: [fruitShop([])] };
  data = trip(data, ['Apples', 'Bananas', 'Pears'], 0);
  assert.equal(slotName(data, 'Kiwi', ['Apples', 'Pears']), 'unknown');
  assert.equal(slotName(data, 'Apples', []), 'unknown');
});

test('categories and stores learn separately, and a new store starts a new trip', () => {
  const other = 'BCDEFGHJKLMNPQRSTUVW';
  let data = { ...emptyState(), shops: [fruitShop([]), { ...fruitShop([]), id: other }] };
  data = check(data, 'Apples', 0);
  data = check(data, 'Bread', 1000, true, 'bread');
  data = check(data, 'Pears', 2000);
  data = recordCheck(data, other, { key: 'pears', groupId: 'fruit', at: 3000, done: true });
  assert.equal(data.trip.shopId, other);
  assert.ok(data.learning[code].pairs.apples.pears > 0);
  assert.equal(data.learning[code].pairs.apples.bread, undefined);
  assert.equal(data.learning[other], undefined);
});

test('learning forgets the least recently picked items past the cap', () => {
  let learning;
  for (let i = 0; i < 160; i++) learning = learnTrip(learning, [0, 1, 2].map(n => ({ key: `item ${i}-${n}`, groupId: 'fruit', at: i * 10 + n })));
  assert.equal(Object.keys(learning.seen).length, 300);
  assert.equal(learning.pairs['item 0-0'], undefined);
  assert.ok(learning.pairs['item 159-0']['item 159-1'] > 0);
});

test('saved lists load with or without learned order, dropping unreadable learning instead of failing', () => {
  const base = { ...emptyState(), shops: [fruitShop([])] };
  assert.equal(decodeSaved(JSON.stringify(base)).learning, undefined);
  const learned = trip(base, ['Apples', 'Bananas', 'Pears'], 0);
  assert.deepEqual(decodeSaved(JSON.stringify(learned)).learning, learned.learning);
  const broken = decodeSaved(JSON.stringify({ ...base, learning: { [code]: { pairs: 'x' } }, trip: { shopId: 1 } }));
  assert.equal(broken.learning, undefined);
  assert.equal(broken.trip, undefined);
  assert.equal(broken.shops.length, 1);
});

import { storeItems } from '../src/model.ts';
test('storeItems lists every name once, in store category order then A–Z, with its list status', () => {
  const data = shop();
  data.groupOrder = ['bread', 'fruit'];
  data.groups.gone = { name: 'Old', createdAt: 3, deleted: true };
  data.items = {
    pear: item('Pears'), apple: { ...item('apples'), done: true }, bananaOld: { ...item('Bananas'), deleted: true, updatedAt: 1 },
    banana: { ...item(' Bananas '), missing: true, updatedAt: 5 }, kiwiGone: { ...item('Kiwi'), deleted: true },
    loaf: item('Bread', 'bread'), bagel: { ...item('Bagel', 'bread'), deleted: true }, old: item('Ghost', 'gone'),
  };
  assert.deepEqual(storeItems(data).map(({ id, name, status }) => [id, name, status]), [
    ['bagel', 'Bagel', 'removed'], ['loaf', 'Bread', 'list'],
    ['apple', 'apples', 'done'], ['banana', 'Bananas', 'missing'], ['kiwiGone', 'Kiwi', 'removed'], ['pear', 'Pears', 'list'],
  ]);
  data.items.bananaNew = item('BANANAS');
  assert.equal(storeItems(data).find(entry => entry.key === 'bananas').status, 'list', 'an item on the list wins over done/missing/removed copies');
  data.groupOrder = ['fruit', 'bread'];
  assert.equal(storeItems(data)[0].groupId, 'fruit', 'follows a changed category order');
});

test('two phones adding the same item keep one copy, and later edits to the dropped copy reach the kept one', () => {
  // Alice's Milk reached the server first; Bob's own Milk (added offline) arrives second.
  const server = { ...shop(), items: { ...shop().items, aliceMilk: { ...item('Milk', 'bread'), createdAt: 5 } } };
  const bob = [write('add', 'items', 'bobMilk', { ...item(' milk ', 'fruit'), createdAt: 4, position: 1024 }),
    write('check', 'items', 'bobMilk', { done: true, updatedAt: 9 }), write('other', 'items', 'apple', { done: true, updatedAt: 9 })];
  const result = applyWritesMerged(server, bob);
  assert.equal(result.items.bobMilk, undefined);
  assert.equal(result.items.aliceMilk.done, true);
  assert.equal(result.items.aliceMilk.groupId, 'bread'); // Bob's category and position don't move the kept copy.
  assert.equal(result.items.apple.done, true);
  // A different name, or a Milk that is only done or missing, is not a duplicate.
  const done = { ...server, items: { ...server.items, aliceMilk: { ...server.items.aliceMilk, done: true } } };
  assert.ok(applyWritesMerged(done, bob.slice(0, 1)).items.bobMilk);
  assert.ok(applyWritesMerged(server, [write('add', 'items', 'oat', { ...item('Oat milk'), createdAt: 4 })]).items.oat);
});

test('restoring or renaming into a name already on the list removes that copy instead', () => {
  const server = { ...shop(), items: { ...shop().items, milk: item('Milk'), oldMilk: { ...item('Milk'), done: true }, cream: item('Cream') } };
  const restored = applyWritesMerged(server, [write('r', 'items', 'oldMilk', { done: false, missing: false, updatedAt: 7 }),
    write('m', 'items', 'oldMilk', { missing: true, updatedAt: 8 })]);
  assert.equal(restored.items.oldMilk.deleted, true);
  assert.equal(restored.items.milk.missing, true); // The later edit went to the copy on the list.
  const renamed = applyWritesMerged(server, [write('n', 'items', 'cream', { name: 'MILK', updatedAt: 7 })]);
  assert.equal(renamed.items.cream.deleted, true);
  assert.equal(renamed.items.milk.deleted, false);
  // An edit to a copy merged away in an earlier sync goes to the kept item by name, or is dropped.
  const local = { ...server, items: { ...server.items, gone: item('Milk') } };
  assert.equal(applyWritesMerged(server, [write('c', 'items', 'gone', { done: true, updatedAt: 9 })], local).items.milk.done, true);
  assert.equal(applyWritesMerged(server, [write('c', 'items', 'gone', { done: true, updatedAt: 9 })]).items.gone, undefined);
});

test('a snapshot with the other phone\'s copy merges an unsent local add right away', () => {
  let data = edit(state(), write('add', 'items', 'mine', { ...item('Milk'), createdAt: 4 }));
  data = mergeRemote(data, code, 'items', { ...shop().items, theirs: { ...item('Milk'), createdAt: 5 } });
  const items = data.shops[0].items;
  assert.equal(items.mine, undefined);
  assert.equal(items.theirs.name, 'Milk');
  assert.equal(data.outbox.length, 1); // Still sent, so the server merges it the same way.
});

test('copies already on the list twice keep the first added; done, missing and removed copies are left alone', () => {
  const doubled = { ...shop(), items: { ...shop().items,
    b: { ...item('Milk'), createdAt: 3 }, a: { ...item('milk '), createdAt: 3 }, late: { ...item('MILK'), createdAt: 1 },
    done: { ...item('Milk'), done: true }, gone: { ...item('Milk'), deleted: true }, other: { ...item('Milk'), missing: true } } };
  assert.deepEqual(duplicateItems(doubled), ['a', 'b']);
  assert.deepEqual(duplicateItems(shop()), []);
});

test('erasing an item removes its record, survives stale snapshots, and later edits from other phones cannot bring it back', () => {
  const erase = write('erase', 'items', 'apple', {});
  erase.remove = true;
  let data = edit(state(), erase);
  assert.equal(data.shops[0].items.apple, undefined);
  assert.equal(data.outbox.length, 1);
  assert.equal(edit(data, { ...erase, id: 'again' }), data, 'erasing twice changes nothing');
  data = mergeRemote(data, code, 'items', shop().items); // Older snapshot that still has it.
  assert.equal(data.shops[0].items.apple, undefined);
  // The server erases it; another phone's later check-off of the erased item is dropped.
  const server = applyWritesMerged(shop(), [erase]);
  assert.equal(server.items.apple, undefined);
  assert.equal(applyWritesMerged(server, [write('c', 'items', 'apple', { done: true, updatedAt: 9 })]).items.apple, undefined);
  assert.equal(applyWrite(shop(), { ...erase, target: 'groups', entityId: 'fruit' }).groups.fruit.name, 'Fruits', 'only items can be erased');
});

test('forgetting an item drops it from the learned order on both sides of every pair', () => {
  const learning = { seen: { milk: 1, eggs: 2, bread: 3 }, pairs: { milk: { eggs: 1 }, eggs: { milk: 0.5, bread: 1 }, bread: { eggs: 0.2 } } };
  assert.deepEqual(forgetItem(learning, 'milk'), { seen: { eggs: 2, bread: 3 }, pairs: { eggs: { bread: 1 }, bread: { eggs: 0.2 } } });
  assert.equal(forgetItem(learning, 'cheese'), learning);
  assert.equal(forgetItem(undefined, 'milk'), undefined);
});
