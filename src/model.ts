export const GROUP_ICONS = ['bag', 'fruit', 'bread', 'milk', 'fish', 'snow', 'clean', 'carrot', 'coffee', 'bottle', 'pet', 'heart', 'egg', 'cheese', 'meat', 'cake', 'pizza', 'rice', 'pasta', 'cereal', 'candy', 'chocolate', 'salt', 'oil', 'water', 'soda', 'beer', 'wine', 'flower', 'leaf', 'baby', 'medicine'] as const;
export type GroupIcon = typeof GROUP_ICONS[number];
export type Group = { name: string; createdAt: number; icon?: GroupIcon; deleted?: boolean };
export const STARTER_GROUPS: { name: string; icon: GroupIcon }[] = [
  { name: 'Fruits', icon: 'fruit' }, { name: 'Bakery', icon: 'bread' },
  { name: 'Dairy', icon: 'milk' }, { name: 'Meat & fish', icon: 'fish' },
  { name: 'Frozen', icon: 'snow' }, { name: 'Cleaning', icon: 'clean' },
];
export type Item = {
  name: string;
  groupId: string;
  done: boolean;
  missing?: boolean;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
  position?: number;
};
export type Shop = {
  id: string;
  name: string;
  createdAt: number;
  shared: boolean;
  groupOrder: string[];
  groups: Record<string, Group>;
  items: Record<string, Item>;
};
export type Write = {
  id: string;
  shopId: string;
  target: 'shop' | 'groups' | 'items';
  entityId: string;
  data: Record<string, unknown>;
};
export type ItemSort = 'group' | 'name' | 'added';
// Learned pick-up order: a check-off on a shopping trip, and per-store "A is picked before B" weights.
// Both stay on this phone; they are never synced.
export type TripPick = { key: string; groupId: string; at: number };
export type Trip = { shopId: string; lastAt: number; picks: TripPick[] };
export type Learning = { pairs: Record<string, Record<string, number>>; seen: Record<string, number> };
export type SavedState = {
  version: 1;
  shops: Shop[];
  outbox: Write[];
  collapsed: string[];
  viewMode?: 'groups' | 'list';
  itemSort?: ItemSort;
  learning?: Record<string, Learning>;
  trip?: Trip;
};

export const emptyState = (): SavedState => ({ version: 1, shops: [], outbox: [], collapsed: [] });
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeCode(input: string) {
  const code = input.trim().toUpperCase().replace(/[\s-]/g, '');
  return /^[A-HJ-NP-Z2-9]{20}$/.test(code) ? code : null;
}

export function formatCode(code: string) {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

export function validName(input: string, max = 200) {
  const name = input.trim();
  if (!name || name.length > max) throw new Error(`Enter a name between 1 and ${max} characters.`);
  return name;
}

export function applyWrite(shop: Shop, write: Write): Shop {
  const current = write.target === 'shop' ? shop : shop[write.target][write.entityId];
  if (current && Object.entries(write.data).every(([key, value]) => {
    const previous = (current as Record<string, unknown>)[key];
    return Object.is(previous, value) || (Array.isArray(previous) && Array.isArray(value)
      && previous.length === value.length && previous.every((entry, index) => Object.is(entry, value[index])));
  })) return shop;
  if (write.target === 'shop') return { ...shop, ...write.data } as Shop;
  const records = shop[write.target];
  return {
    ...shop,
    [write.target]: { ...records, [write.entityId]: { ...records[write.entityId], ...write.data } },
  };
}

export function edit(state: SavedState, write: Write): SavedState {
  const shop = state.shops.find(s => s.id === write.shopId);
  if (!shop) return state;
  const updated = applyWrite(shop, write);
  if (updated === shop) return state;
  return {
    ...state,
    shops: state.shops.map(s => s.id === shop.id ? updated : s),
    outbox: shop.shared ? [...state.outbox, write] : state.outbox,
  };
}

// Replay unsent changes over remote snapshots so an older snapshot cannot erase offline edits.
export function mergeRemote(state: SavedState, shopId: string, target: Write['target'], data: Record<string, unknown>): SavedState {
  const next: SavedState = {
    ...state,
    shops: state.shops.map(shop => {
      if (shop.id !== shopId) return shop;
      let merged = target === 'shop'
        ? { ...shop, name: data.name as string, groupOrder: data.groupOrder as string[],
          ...(data.groups && data.items ? { groups: data.groups as Shop['groups'], items: data.items as Shop['items'] } : {}) }
        : { ...shop, [target]: data };
      for (const write of state.outbox.filter(w => w.shopId === shopId)) merged = applyWrite(merged, write);
      return keepUnchanged(shop, merged);
    }),
  };
  // A snapshot that only echoes what this phone already has changes nothing: keep the same state
  // so the store skips the local save and screens skip re-rendering.
  return next.shops.every((shop, index) => shop === state.shops[index]) ? state : next;
}

const sameFields = (a: object, b: object) => {
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const key of keys) if (!Object.is(x[key], y[key])) return false;
  return true;
};
function keepUnchangedRecords<T extends object>(previous: Record<string, T>, next: Record<string, T>) {
  let changed = Object.keys(previous).length !== Object.keys(next).length;
  const result: Record<string, T> = {};
  for (const [id, value] of Object.entries(next)) {
    const old = Object.hasOwn(previous, id) ? previous[id] : undefined;
    if (old && sameFields(old, value)) result[id] = old;
    else { result[id] = value; changed = true; }
  }
  return changed ? result : previous;
}
// Reuse unchanged groups, items and the order array so memoized rows don't re-render.
function keepUnchanged(previous: Shop, next: Shop): Shop {
  const groups = keepUnchangedRecords(previous.groups, next.groups);
  const items = keepUnchangedRecords(previous.items, next.items);
  const groupOrder = previous.groupOrder.length === next.groupOrder.length && previous.groupOrder.every((id, i) => id === next.groupOrder[i])
    ? previous.groupOrder : next.groupOrder;
  if (groups === previous.groups && items === previous.items && groupOrder === previous.groupOrder
    && previous.name === next.name && previous.createdAt === next.createdAt && previous.shared === next.shared) return previous;
  return { ...next, groups, items, groupOrder };
}

export function acknowledge(state: SavedState, writeIds: string[]): SavedState {
  const sent = new Set(writeIds);
  return { ...state, outbox: state.outbox.filter(w => !sent.has(w.id)) };
}

export function orderedGroups(shop: Shop) {
  const known = new Set(shop.groupOrder);
  return [...shop.groupOrder.filter(id => shop.groups[id]), ...Object.keys(shop.groups).filter(id => !known.has(id))]
    .filter(id => !shop.groups[id].deleted);
}

// Keep additions from another device and discard categories removed while sorting.
export function mergeCategoryOrder(current: string[], draft: string[]) {
  const active = new Set(current);
  return [...new Set([...draft.filter(id => active.has(id)), ...current])];
}

export function reorderShops(shops: Shop[], order: string[]) {
  if (order.length !== shops.length || new Set(order).size !== shops.length || order.some(id => !shops.some(shop => shop.id === id))) return shops;
  const byId = new Map(shops.map(shop => [shop.id, shop]));
  return order.map(id => byId.get(id)!);
}

export function activeItems(shop: Shop, groupId: string, sort: ItemSort = 'group') {
  return Object.entries(shop.items)
    .filter(([, item]) => item.groupId === groupId && !shop.groups[groupId]?.deleted && !item.done && !item.missing && !item.deleted)
    .sort(([a, x], [b, y]) => (sort === 'name' ? x.name.localeCompare(y.name, undefined, { sensitivity: 'base', numeric: true }) : sort === 'added' ? x.createdAt - y.createdAt : (x.position ?? x.createdAt) - (y.position ?? y.createdAt)) || a.localeCompare(b));
}

export function listItems(shop: Shop, sort: ItemSort = 'group') {
  const items = orderedGroups(shop).flatMap(groupId => activeItems(shop, groupId));
  if (sort === 'name') items.sort(([a, x], [b, y]) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base', numeric: true }) || a.localeCompare(b));
  if (sort === 'added') items.sort(([a, x], [b, y]) => x.createdAt - y.createdAt || a.localeCompare(b));
  return items;
}

// Also the key for learned pick-up order, so "Milk " and "milk" are the same item.
export const searchName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

// The item with this name (ignoring case and extra spaces) in a live category. An item still on the
// list wins; otherwise the most recently changed done or missing item, so adding it again can restore it.
export function findListItem(shop: Shop, name: string): [string, Item] | undefined {
  const term = searchName(name);
  let match: [string, Item] | undefined;
  for (const entry of Object.entries(shop.items)) {
    const item = entry[1];
    if (item.deleted || !shop.groups[item.groupId] || shop.groups[item.groupId].deleted || searchName(item.name) !== term) continue;
    if (!item.done && !item.missing) return entry;
    if (!match || item.updatedAt > match[1].updatedAt) match = entry;
  }
  return match;
}
export function itemSuggestions(shops: Shop[], shop: Shop, query: string) {
  const term = searchName(query);
  if (!term) return [];
  const groups = orderedGroups(shop);
  const candidates: { name: string; groupId: string; rank: number; local: number; usedAt: number }[] = [];
  for (const source of shops) {
    for (const item of Object.values(source.items)) {
      const group = source.groups[item.groupId];
      if (!group || group.deleted) continue;
      const groupId = source.id === shop.id ? groups.find(id => id === item.groupId)
        : groups.find(id => searchName(shop.groups[id].name) === searchName(group.name));
      const name = searchName(item.name);
      if (!groupId || !name.includes(term)) continue;
      candidates.push({ name: item.name, groupId, rank: name === term ? 0 : name.startsWith(term) ? 1 : 2,
        local: source.id === shop.id ? 0 : 1, usedAt: item.updatedAt });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.local - b.local || b.usedAt - a.usedAt || a.name.localeCompare(b.name));
  const seen = new Set<string>();
  return candidates.filter(item => {
    const name = searchName(item.name);
    if (seen.has(name)) return false;
    seen.add(name); return true;
  }).slice(0, 5).map(({ name, groupId }) => ({ name, groupId }));
}

// A move usually needs only one item patch.
export function itemDropSlot(shop: Shop, source: string, target: string, after: boolean) {
  const item = shop.items[source], receiver = shop.items[target];
  if (source === target || !item || item.deleted || item.missing || item.done || !receiver || receiver.deleted || receiver.missing || receiver.done) return null;
  if (![item.groupId, receiver.groupId].every(id => shop.groups[id] && !shop.groups[id].deleted)) return null;
  const ids = activeItems(shop, receiver.groupId).map(([id]) => id);
  const without = ids.filter(id => id !== source);
  const index = without.indexOf(target) + Number(after);
  if (ids.indexOf(source) === index) return null;
  return { groupId: receiver.groupId, beforeId: without[index] ?? null };
}

export function planItemMove(shop: Shop, itemId: string, groupId: string, beforeId: string | null = null, allowCompleted = false) {
  const item = shop.items[itemId];
  if (!shop.groups[groupId] || shop.groups[groupId].deleted || !item || shop.groups[item.groupId]?.deleted || ((item.done || item.missing) && !allowCompleted) || item.deleted || beforeId === itemId) return {};
  return insertionPatches(shop, groupId, itemId, item, beforeId);
}

// Position patches that place an item (existing or about to be added) before beforeId, or last.
export function insertionPatches(shop: Shop, groupId: string, itemId: string, item: Item, beforeId: string | null): Record<string, { groupId: string; position: number }> {
  const items = activeItems(shop, groupId).filter(([id]) => id !== itemId);
  const index = beforeId === null ? items.length : items.findIndex(([id]) => id === beforeId);
  if (index < 0) return {};
  const left = items[index - 1]?.[1]; const right = items[index]?.[1];
  const low = left ? left.position ?? left.createdAt : undefined;
  const high = right ? right.position ?? right.createdAt : undefined;
  const position = low === undefined ? (high === undefined ? 1024 : high - 1024)
    : high === undefined ? low + 1024 : low + (high - low) / 2;
  if (Number.isFinite(position) && (low === undefined || position > low) && (high === undefined || position < high)) {
    return { [itemId]: { groupId, position } };
  }
  // Re-space tied legacy timestamps or exhausted floating-point gaps only when needed.
  items.splice(index, 0, [itemId, item]);
  return Object.fromEntries(items.map(([id], i) => [id, { groupId, position: (i + 1) * 1024 }]));
}

// --- Learned pick-up order ---
// Check-offs less than TRIP_GAP_MS apart in one store form a trip. When the trip ends, every pair of
// items checked in the same category teaches "first before second". Old trips fade by LEARN_DECAY,
// so a changed store layout takes over within a few trips.
export const TRIP_GAP_MS = 45 * 60_000;
export const MIN_TRIP_PICKS = 3;
const LEARN_DECAY = 0.7;
export const MAX_LEARNED_ITEMS = 300;

export function learnTrip(learning: Learning | undefined, picks: TripPick[]): Learning | undefined {
  if (picks.length < MIN_TRIP_PICKS) return learning;
  const byGroup = new Map<string, string[]>();
  for (const pick of [...picks].sort((a, b) => a.at - b.at)) {
    const keys = byGroup.get(pick.groupId) ?? [];
    if (!keys.includes(pick.key)) keys.push(pick.key);
    byGroup.set(pick.groupId, keys);
  }
  const ordered = [...byGroup.values()].filter(keys => keys.length >= 2);
  if (!ordered.length) return learning;
  const pairs = { ...learning?.pairs };
  const seen = { ...learning?.seen };
  const copied = new Set<string>();
  // Copy each touched row once so the previous learning object is never mutated.
  const row = (key: string) => {
    if (!copied.has(key)) { pairs[key] = { ...pairs[key] }; copied.add(key); }
    return pairs[key];
  };
  const lastAt = Math.max(...picks.map(pick => pick.at));
  for (const keys of ordered) {
    keys.forEach((first, i) => {
      seen[first] = lastAt;
      for (const second of keys.slice(i + 1)) {
        row(first)[second] = (pairs[first][second] ?? 0) * LEARN_DECAY + 1;
        const back = (pairs[second]?.[first] ?? 0) * LEARN_DECAY;
        if (back >= 0.01) row(second)[first] = back; else if (pairs[second]?.[first] !== undefined) delete row(second)[first];
      }
    });
  }
  // Forget the items not picked for the longest time once a store has too many.
  const stale = Object.entries(seen).sort(([a, x], [b, y]) => x - y || a.localeCompare(b)).slice(0, Math.max(0, Object.keys(seen).length - MAX_LEARNED_ITEMS)).map(([key]) => key);
  for (const key of stale) {
    delete seen[key]; delete pairs[key];
    for (const other of Object.keys(pairs)) if (pairs[other][key] !== undefined) delete row(other)[key];
  }
  return { pairs, seen };
}

// End the current trip and learn from it, once the gap has passed (or always when forced).
export function closeTrip(state: SavedState, now: number, force = false): SavedState {
  const trip = state.trip;
  if (!trip || (!force && now - trip.lastAt < TRIP_GAP_MS)) return state;
  const { trip: _, ...rest } = state;
  if (!state.shops.some(shop => shop.id === trip.shopId)) return rest;
  const learned = learnTrip(state.learning?.[trip.shopId], trip.picks);
  return learned ? { ...rest, learning: { ...state.learning, [trip.shopId]: learned } } : rest;
}

// Record a check (done) or uncheck of an item. Unchecking during the trip un-learns that pick.
export function recordCheck(state: SavedState, shopId: string, item: TripPick & { done: boolean }): SavedState {
  const next = state.trip && (state.trip.shopId !== shopId || item.at - state.trip.lastAt >= TRIP_GAP_MS) ? closeTrip(state, item.at, true) : state;
  const picks = next.trip?.picks.filter(pick => pick.key !== item.key) ?? [];
  if (!item.done) return next.trip && picks.length !== next.trip.picks.length ? { ...next, trip: { ...next.trip, picks } } : next;
  return { ...next, trip: { shopId, lastAt: item.at, picks: [...picks, { key: item.key, groupId: item.groupId, at: item.at }] } };
}

// Where an item fits in its category's current list by learned order: the id to insert before,
// null for last, or undefined when nothing is known about it relative to the items on the list.
export function learnedSlot(shop: Shop, learning: Learning | undefined, name: string, groupId: string, excludeId?: string): string | null | undefined {
  if (!learning) return undefined;
  const key = searchName(name);
  const items = activeItems(shop, groupId).filter(([id, item]) => id !== excludeId && searchName(item.name) !== key);
  const before = (a: string, b: string) => learning.pairs[a]?.[b] ?? 0;
  const keys = items.map(([, item]) => searchName(item.name));
  if (!keys.some(other => before(key, other) || before(other, key))) return undefined;
  // Cost of slot i: evidence against the items placed before it and after it. Ties go to the later slot.
  let best = 0, bestCost = Infinity;
  for (let slot = 0; slot <= keys.length; slot++) {
    const cost = keys.slice(0, slot).reduce((sum, other) => sum + before(key, other), 0)
      + keys.slice(slot).reduce((sum, other) => sum + before(other, key), 0);
    if (cost <= bestCost) { best = slot; bestCost = cost; }
  }
  return items[best]?.[0] ?? null;
}

const isNumberMap = (value: unknown): value is Record<string, number> => Boolean(value) && typeof value === 'object'
  && Object.values(value as object).every(Number.isFinite);
function isLearning(value: unknown): value is Learning {
  const v = value as Learning;
  return Boolean(v) && typeof v === 'object' && isNumberMap(v.seen) && Boolean(v.pairs) && typeof v.pairs === 'object' && Object.values(v.pairs).every(isNumberMap);
}
function isTrip(value: unknown): value is Trip {
  const v = value as Trip;
  return Boolean(v) && typeof v === 'object' && typeof v.shopId === 'string' && Number.isFinite(v.lastAt) && Array.isArray(v.picks)
    && v.picks.every(pick => pick && typeof pick.key === 'string' && typeof pick.groupId === 'string' && Number.isFinite(pick.at));
}

export function storeInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
}

export const MAX_DONE_ITEMS = 100;
export function doneOverflow(shop: Shop) {
  const done = Object.entries(shop.items).filter(([, item]) => item.done && !item.missing && !item.deleted);
  // Runs on every save: skip the sort in the common case where nothing overflows.
  if (done.length <= MAX_DONE_ITEMS) return [];
  return done
    .sort(([a, x], [b, y]) => y.updatedAt - x.updatedAt || a.localeCompare(b)).slice(MAX_DONE_ITEMS).map(([id]) => id);
}

// Picking order: by the store's category order, then each item's position within its category.
function inStoreOrder(shop: Shop, entries: [string, Item][]) {
  const groups = orderedGroups(shop);
  const rank = new Map(groups.map((id, index) => [id, index]));
  const groupRank = (item: Item) => rank.get(item.groupId) ?? groups.length;
  return entries.sort(([a, x], [b, y]) => groupRank(x) - groupRank(y)
    || (x.position ?? x.createdAt) - (y.position ?? y.createdAt) || a.localeCompare(b));
}

export function missingItems(shop: Shop) {
  return inStoreOrder(shop, Object.entries(shop.items)
    .filter(([, item]) => item.missing && !item.deleted && shop.groups[item.groupId] && !shop.groups[item.groupId].deleted));
}

// Keeps the newest MAX_DONE_ITEMS completions, shown in picking order.
export function doneItems(shop: Shop) {
  return inStoreOrder(shop, Object.entries(shop.items)
    .filter(([, item]) => item.done && !item.missing && !item.deleted && !shop.groups[item.groupId]?.deleted)
    .sort(([a, x], [b, y]) => y.updatedAt - x.updatedAt || a.localeCompare(b)).slice(0, MAX_DONE_ITEMS));
}

export function isGroup(value: unknown): value is Group {
  if (!value || typeof value !== 'object') return false;
  const v = value as Group;
  return typeof v.name === 'string' && v.name.trim().length > 0 && v.name.length <= 80 && Number.isFinite(v.createdAt)
    && (v.icon === undefined || GROUP_ICONS.includes(v.icon)) && (v.deleted === undefined || typeof v.deleted === 'boolean');
}

export function isItem(value: unknown): value is Item {
  if (!value || typeof value !== 'object') return false;
  const v = value as Item;
  return typeof v.name === 'string' && v.name.trim().length > 0 && v.name.length <= 200
    && typeof v.groupId === 'string' && typeof v.done === 'boolean' && (v.missing === undefined || typeof v.missing === 'boolean') && typeof v.deleted === 'boolean'
    && Number.isFinite(v.createdAt) && Number.isFinite(v.updatedAt)
    && (v.position === undefined || Number.isFinite(v.position));
}

export function isShopMeta(value: unknown): value is Pick<Shop, 'name' | 'groupOrder' | 'createdAt'> {
  if (!value || typeof value !== 'object') return false;
  const v = value as Shop;
  return typeof v.name === 'string' && v.name.trim().length > 0 && v.name.length <= 80
    && Array.isArray(v.groupOrder) && v.groupOrder.length <= 100
    && v.groupOrder.every(id => typeof id === 'string' && /^[\w-]{1,80}$/.test(id))
    && new Set(v.groupOrder).size === v.groupOrder.length && Number.isFinite(v.createdAt);
}

export function decodeSaved(raw: string): SavedState {
  const data = JSON.parse(raw) as SavedState;
  if (data.version !== 1 || !Array.isArray(data.shops) || !Array.isArray(data.outbox)
    || !Array.isArray(data.collapsed) || !data.collapsed.every(id => typeof id === 'string')
    || !data.shops.every(s => isShopMeta(s) && normalizeCode(s.id) === s.id && typeof s.shared === 'boolean'
      && s.groups && Object.values(s.groups).every(isGroup) && s.items && Object.values(s.items).every(isItem))
    || !data.outbox.every(w => typeof w.id === 'string' && normalizeCode(w.shopId) === w.shopId
      && ['shop', 'groups', 'items'].includes(w.target) && typeof w.entityId === 'string'
      && w.data && typeof w.data === 'object')) {
    throw new Error('The saved lists could not be read. Your data has been kept; it has not been reset.');
  }
  if (data.itemSort !== undefined && !['group', 'name', 'added'].includes(data.itemSort)) delete data.itemSort;
  if (data.viewMode !== undefined && !['groups', 'list'].includes(data.viewMode)) delete data.viewMode;
  // Learned order is a convenience: drop it if unreadable instead of rejecting the saved lists.
  if (data.learning !== undefined && !(data.learning && typeof data.learning === 'object' && Object.values(data.learning).every(isLearning))) delete data.learning;
  if (data.trip !== undefined && !isTrip(data.trip)) delete data.trip;
  return data;
}
