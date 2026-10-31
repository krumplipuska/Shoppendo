import { entityTone } from '../src/theme.ts';
import { deleteSwipeProgress, backSwipeDirection, swipeAxis, keyboardOverlap } from '../src/interaction.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acknowledge, activeItems, decodeSaved, doneItems, doneOverflow, MAX_DONE_ITEMS, edit, emptyState, formatCode, GROUP_ICONS, isGroup, itemSuggestions, listItems, mergeRemote, mergeCategoryOrder, normalizeCode, orderedGroups, planItemMove, reorderShops, STARTER_GROUPS, storeInitials, validName } from '../src/model.ts';

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

test('Done shows the newest completion first across categories', () => {
  const data = shop();
  data.items.apple = { ...data.items.apple, done:true, updatedAt:20 };
  data.items.loaf = { ...data.items.loaf, done:true, updatedAt:40 };
  assert.deepEqual(doneItems(data).map(([id])=>id), ['loaf','apple']);
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
  assert.equal(doneItems(data)[0][0],'done102');
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
