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
export type SavedState = {
  version: 1;
  shops: Shop[];
  outbox: Write[];
  collapsed: string[];
  viewMode?: 'groups' | 'list';
  itemSort?: ItemSort;
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
  return {
    ...state,
    shops: state.shops.map(s => s.id === shop.id ? applyWrite(s, write) : s),
    outbox: shop.shared ? [...state.outbox, write] : state.outbox,
  };
}

// Replay unsent changes over remote snapshots so an older snapshot cannot erase offline edits.
export function mergeRemote(state: SavedState, shopId: string, target: Write['target'], data: Record<string, unknown>): SavedState {
  return {
    ...state,
    shops: state.shops.map(shop => {
      if (shop.id !== shopId) return shop;
      let merged = target === 'shop'
        ? { ...shop, name: data.name as string, groupOrder: data.groupOrder as string[],
          ...(data.groups && data.items ? { groups: data.groups as Shop['groups'], items: data.items as Shop['items'] } : {}) }
        : { ...shop, [target]: data };
      for (const write of state.outbox.filter(w => w.shopId === shopId)) merged = applyWrite(merged, write);
      return merged;
    }),
  };
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
    .filter(([, item]) => item.groupId === groupId && !shop.groups[groupId]?.deleted && !item.done && !item.deleted)
    .sort(([a, x], [b, y]) => (sort === 'name' ? x.name.localeCompare(y.name, undefined, { sensitivity: 'base', numeric: true }) : sort === 'added' ? x.createdAt - y.createdAt : (x.position ?? x.createdAt) - (y.position ?? y.createdAt)) || a.localeCompare(b));
}

export function listItems(shop: Shop, sort: ItemSort = 'group') {
  const items = orderedGroups(shop).flatMap(groupId => activeItems(shop, groupId));
  if (sort === 'name') items.sort(([a, x], [b, y]) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base', numeric: true }) || a.localeCompare(b));
  if (sort === 'added') items.sort(([a, x], [b, y]) => x.createdAt - y.createdAt || a.localeCompare(b));
  return items;
}

const searchName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
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
export function planItemMove(shop: Shop, itemId: string, groupId: string, beforeId: string | null = null, allowCompleted = false) {
  const item = shop.items[itemId];
  if (!shop.groups[groupId] || shop.groups[groupId].deleted || !item || shop.groups[item.groupId]?.deleted || (item.done && !allowCompleted) || item.deleted || beforeId === itemId) return {};
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

export function storeInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
}

export const MAX_DONE_ITEMS = 100;
export function doneOverflow(shop: Shop) {
  return Object.entries(shop.items).filter(([, item]) => item.done && !item.deleted)
    .sort(([a, x], [b, y]) => y.updatedAt - x.updatedAt || a.localeCompare(b)).slice(MAX_DONE_ITEMS).map(([id]) => id);
}

export function doneItems(shop: Shop) {
  return Object.entries(shop.items)
    .filter(([, item]) => item.done && !item.deleted && !shop.groups[item.groupId]?.deleted)
    .sort(([a, x], [b, y]) => y.updatedAt - x.updatedAt || a.localeCompare(b)).slice(0, MAX_DONE_ITEMS);
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
    && typeof v.groupId === 'string' && typeof v.done === 'boolean' && typeof v.deleted === 'boolean'
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
  return data;
}
