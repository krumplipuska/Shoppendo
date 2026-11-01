import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';
import { acknowledge, CODE_ALPHABET, decodeSaved, edit, emptyState, mergeRemote, normalizeCode, unobservedWrites,
  activeItems, doneOverflow, orderedGroups, planItemMove, reorderShops, STARTER_GROUPS, GROUP_ICONS, validName, type GroupIcon, type ItemSort, type SavedState, type Shop, type Write } from './model';
import { firebaseConfigured, joinRemote, publishShop, sendWrites, watchShop, stopSharing } from './firebase';

const STORAGE_KEY = 'shoppendo.v1';
let saved = emptyState();
let view = { data: saved, ready: false, error: '', syncing: false, undo: null as { label: string; restore: () => void } | null };
let undoTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
let saveChain: Promise<void> = Promise.resolve();
let durable = true;
let syncing: Promise<void> | undefined;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let loaded: Promise<void> | undefined;
const watchers = new Map<string, () => void>();
const starting = new Set<string>();
const id = () => Crypto.randomUUID();
const shopId = () => Array.from(Crypto.getRandomBytes(20), n => CODE_ALPHABET[n & 31]).join('');

function notify(update: Partial<typeof view> = {}) {
  view = { ...view, ...update, data: saved };
  listeners.forEach(listener => listener());
}

function offerUndo(label: string, restore: () => void) {
  clearTimeout(undoTimer);
  notify({ undo: { label, restore } });
  undoTimer = setTimeout(() => notify({ undo: null }), 8000);
}

export function errorMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code?.includes('configuration-not-found') || code?.includes('operation-not-allowed') || code?.includes('admin-restricted')) return 'Sharing is not available yet. Your lists are saved on this phone.';
  if (code?.includes('unauthorized-domain') || code?.includes('invalid-api-key')) return 'Sharing is not available in this build yet. Your local lists still work.';
  if (code?.includes('permission-denied')) return 'Sharing access was denied. Your edits are saved on this phone.';
  if (code?.includes('network') || code?.includes('unavailable')) return 'Offline for now. Your edits will sync when you reconnect.';
  return error instanceof Error ? error.message : 'Something went wrong. Your local lists have been kept.';
}

function limitDone(next: SavedState) {
  for (const shop of next.shops) {
    for (const itemId of doneOverflow(shop)) next = edit(next, { id: id(), shopId: shop.id, target: 'items', entityId: itemId, data: { deleted: true, updatedAt: Date.now() } });
  }
  return next;
}

let dragDepth = 0;
const remoteSeen = new Map<string, Shop>();
const awaitingEcho = new Map<string, Write[]>();
const deferredSnapshots = new Map<string, { shopId: string; target: Write['target']; data: Record<string, unknown> }>();

function receiveSnapshot(shopId: string, target: Write['target'], data: Record<string, unknown>) {
  if (target === 'shop' && data.items && data.groups) {
    remoteSeen.set(shopId, data as Shop);
    awaitingEcho.set(shopId, unobservedWrites(awaitingEcho.get(shopId) ?? [], data as Shop));
  }
  if (dragDepth) { deferredSnapshots.set(`${shopId}:${target}`, { shopId, target, data }); return; }
  const protectedState = { ...saved, outbox: [...(awaitingEcho.get(shopId) ?? []), ...saved.outbox] };
  const merged = mergeRemote(protectedState, shopId, target, data);
  void persist({ ...merged, outbox: saved.outbox }).catch(() => {});
}

function scheduleFlush(delay = 750) {
  if (dragDepth > 0 || syncTimer) return;
  syncTimer = setTimeout(() => { syncTimer = undefined; void flush(); }, delay);
}

function persist(next: SavedState) {
  next = limitDone(next);
  const outboxChanged = next.outbox !== saved.outbox;
  saved = next;
  notify();
  const raw = JSON.stringify(next);
  const write = saveChain.then(() => AsyncStorage.setItem(STORAGE_KEY, raw));
  saveChain = write.then(() => { durable = true; }).catch(() => {
    durable = false;
    notify({ error: 'Could not save to this device. Keep the app open and free up some storage, then try again.' });
  });
  // Never send a change until its durable local copy exists.
  void write.then(() => {
    // Use a bounded window so continuous edits cannot postpone syncing forever.
    // Remote snapshots and local preferences must not flush pending edits early.
    if (outboxChanged && saved.outbox.length) scheduleFlush();
  }).catch(() => {});
  return write;
}

function update(write: Omit<Write, 'id'>) {
  const next = edit(saved, { ...write, id: id() });
  if (next !== saved) void persist(next).catch(() => {});
}

export async function load() {
  loaded ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const restored = raw ? decodeSaved(raw) : emptyState();
      saved = limitDone(restored);
      if (saved !== restored) await persist(saved);
      notify({ ready: true, error: '' });
      void flush();
      refreshWatchers();
    } catch (error) {
      notify({ error: errorMessage(error) });
      loaded = undefined;
    }
  })();
  return loaded;
}

export function flush() {
  clearTimeout(syncTimer);
  syncTimer = undefined;
  if (dragDepth > 0) return Promise.resolve();
  if (!firebaseConfigured || !view.ready) return Promise.resolve();
  if (!saved.outbox.length) { refreshWatchers(); return Promise.resolve(); }
  syncing ??= (async () => {
    try {
      while (saved.outbox.length && dragDepth === 0) {
        const firstShop = saved.outbox[0].shopId;
        // All pending edits for one shop become one document write.
        const batch = saved.outbox.filter(w => w.shopId === firstShop);
        await saveChain;
        if (!durable || dragDepth > 0) break;
        notify({ syncing: true });
        await sendWrites(batch, saved.shops.find(shop => shop.id === firstShop));
        awaitingEcho.set(firstShop, unobservedWrites([...(awaitingEcho.get(firstShop) ?? []), ...batch], remoteSeen.get(firstShop)));
        // Writes added during the network request must remain in the outbox.
        await persist(acknowledge(saved, batch.map(w => w.id)));
      }
      if (durable) notify({ error: '' });
    } catch (error) {
      notify({ error: errorMessage(error) });
    } finally {
      syncing = undefined;
      notify({ syncing: false });
      refreshWatchers();
    }
  })();
  return syncing;
}

function refreshWatchers() {
  if (!firebaseConfigured) return;
  const shared = saved.shops.filter(s => s.shared);
  for (const [shopId, stop] of watchers) {
    if (!shared.some(s => s.id === shopId)) { stop(); watchers.delete(shopId); }
  }
  for (const shop of shared) {
    if (watchers.has(shop.id) || starting.has(shop.id) || saved.outbox.some(w => w.shopId === shop.id && w.target === 'shop' && w.data.createdAt)) continue;
    starting.add(shop.id);
    void watchShop(shop, (target, data) => {
      receiveSnapshot(shop.id, target, data);
    }, error => notify({ error: errorMessage(error) })).then(stop => {
      if (saved.shops.some(s => s.id === shop.id && s.shared)) watchers.set(shop.id, stop);
      else stop();
    }).catch(error => notify({ error: errorMessage(error) })).finally(() => starting.delete(shop.id));
  }
}

export function useShops() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => view);
}

export const actions = {
  beginDrag() { dragDepth += 1; clearTimeout(syncTimer); syncTimer = undefined; },
  endDrag() {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      const snapshots = [...deferredSnapshots.values()]; deferredSnapshots.clear();
      for (const { shopId, target, data } of snapshots) receiveSnapshot(shopId, target, data);
      if (saved.outbox.length) scheduleFlush(0);
    }
  },
  undo() {
    const restore = view.undo?.restore;
    clearTimeout(undoTimer); notify({ undo: null }); restore?.();
  },
  clearError() { notify({ error: '' }); },
  async retry() { await persist(saved); await flush(); refreshWatchers(); },
  addShop(input: string) {
    const now = Date.now();
    const groups = Object.fromEntries(STARTER_GROUPS.map(group => [id(), { ...group, createdAt: now }]));
    const shop: Shop = { id: shopId(), name: validName(input, 80), createdAt: now, shared: false, groupOrder: Object.keys(groups), groups, items: {} };
    void persist({ ...saved, shops: [...saved.shops, shop] }).catch(() => {});
    return shop.id;
  },
  renameShop(shopId: string, name: string) {
    update({ shopId, target: 'shop', entityId: '', data: { name: validName(name, 80) } });
  },
  removeShop(shopId: string) {
    const shop = saved.shops.find(s => s.id === shopId);
    if (!shop) return;
    const index = saved.shops.indexOf(shop);
    const pending = saved.outbox.filter(w => w.shopId === shopId);
    const groupIds = new Set(Object.keys(shop?.groups ?? {}));
    const collapsed = saved.collapsed.filter(id => groupIds.has(id));
    void persist({ ...saved, shops: saved.shops.filter(s => s.id !== shopId), outbox: saved.outbox.filter(w => w.shopId !== shopId), collapsed: saved.collapsed.filter(id => !groupIds.has(id)) }).catch(() => {});
    refreshWatchers();
    offerUndo(`${shop.name} removed`, () => {
      if (saved.shops.some(s => s.id === shopId)) return;
      const shops = [...saved.shops]; shops.splice(index, 0, shop);
      void persist({ ...saved, shops, outbox: [...saved.outbox, ...pending], collapsed: [...new Set([...saved.collapsed, ...collapsed])] }).catch(() => {});
      refreshWatchers();
    });
  },
  reorderShops(order: string[]) {
    const shops = reorderShops(saved.shops, order);
    if (shops !== saved.shops) void persist({ ...saved, shops }).catch(() => {});
  },
  addGroup(shopId: string, input: string) {
    const shop = saved.shops.find(s => s.id === shopId)!;
    if (orderedGroups(shop).length >= 100) throw new Error('A shop can have up to 100 groups.');
    const groupId = id();
    const name = validName(input, 80);
    update({ shopId, target: 'groups', entityId: groupId, data: { name, icon: 'bag', createdAt: Date.now() } });
    update({ shopId, target: 'shop', entityId: '', data: { groupOrder: [...orderedGroups(saved.shops.find(s => s.id === shopId)!), groupId].filter((v, i, a) => a.indexOf(v) === i) } });
    return groupId;
  },
  editGroup(shopId: string, groupId: string, name: string, icon: GroupIcon) {
    if (!saved.shops.find(s => s.id === shopId)?.groups[groupId] || !GROUP_ICONS.includes(icon)) return;
    update({ shopId, target: 'groups', entityId: groupId, data: { name: validName(name, 80), icon } });
  },
  deleteGroup(shopId: string, groupId: string) {
    const group = saved.shops.find(s => s.id === shopId)?.groups[groupId];
    if (!group || group.deleted) return;
    update({ shopId, target: 'groups', entityId: groupId, data: { deleted: true } });
    offerUndo(`${group.name} deleted`, () => update({ shopId, target: 'groups', entityId: groupId, data: { deleted: false } }));
  },
  reorder(shopId: string, groupOrder: string[]) {
    const shop = saved.shops.find(s => s.id === shopId)!;
    const known = orderedGroups(shop);
    if (groupOrder.length !== known.length || new Set(groupOrder).size !== known.length || groupOrder.some(id => !shop.groups[id])) return;
    update({ shopId, target: 'shop', entityId: '', data: { groupOrder } });
  },
  collapse(groupId: string, collapse?: boolean) {
    const set = new Set(saved.collapsed);
    if (collapse ?? !set.has(groupId)) set.add(groupId); else set.delete(groupId);
    void persist({ ...saved, collapsed: [...set] }).catch(() => {});
  },
  setItemSort(itemSort: ItemSort) {
    if ((saved.itemSort ?? 'group') === itemSort) return;
    void persist({ ...saved, itemSort }).catch(() => {});
  },
  setViewMode(viewMode: 'groups' | 'list') {
    void persist({ ...saved, viewMode }).catch(() => {});
  },
  addItem(shopId: string, groupId: string, input: string) {
    const shop = saved.shops.find(s => s.id === shopId);
    if (!shop?.groups[groupId] || shop.groups[groupId].deleted) throw new Error('This group is no longer available.');
    const now = Date.now();
    const last = activeItems(shop, groupId).at(-1)?.[1];
    const position = last ? (last.position ?? last.createdAt) + 1024 : 1024;
    const itemId = id();
    update({ shopId, target: 'items', entityId: itemId, data: { name: validName(input), groupId, done: false, deleted: false, position, createdAt: now, updatedAt: now } });
    return itemId;
  },
  moveItem(shopId: string, itemId: string, groupId: string, beforeId: string | null = null, allowCompleted = false) {
    const shop = saved.shops.find(s => s.id === shopId);
    if (!shop) return;
    const patches = planItemMove(shop, itemId, groupId, beforeId, allowCompleted);
    let next = saved;
    for (const [entityId, data] of Object.entries(patches)) {
      next = edit(next, { id: id(), shopId, target: 'items', entityId, data: { ...data, updatedAt: Date.now() } });
    }
    if (next !== saved) void persist(next).catch(() => {});
  },
  toggleItem(shopId: string, itemId: string) {
    const item = saved.shops.find(s => s.id === shopId)?.items[itemId];
    if (!item || item.deleted) return;
    const done = !item.done;
    update({ shopId, target: 'items', entityId: itemId, data: { done, updatedAt: Date.now() } });
    return done;
  },
  renameItem(shopId: string, itemId: string, input: string) {
    const name = validName(input);
    if (saved.shops.find(s => s.id === shopId)?.items[itemId]?.name === name) return;
    update({ shopId, target: 'items', entityId: itemId, data: { name, updatedAt: Date.now() } });
  },
  deleteItem(shopId: string, itemId: string) {
    const item = saved.shops.find(s => s.id === shopId)?.items[itemId];
    if (!item || item.deleted) return;
    update({ shopId, target: 'items', entityId: itemId, data: { deleted: true, updatedAt: Date.now() } });
    offerUndo(`${item.name} deleted`, () => update({ shopId, target: 'items', entityId: itemId, data: { deleted: false, updatedAt: Date.now() } }));
  },
  async share(shopId: string) {
    if (!firebaseConfigured) throw new Error('Shop sharing is not connected yet. Your lists still work on this phone.');
    const shop = saved.shops.find(s => s.id === shopId)!;
    if (!shop.shared) {
      const writes: Write[] = [
        { id: id(), shopId, target: 'shop', entityId: '', data: { name: shop.name, groupOrder: shop.groupOrder, createdAt: shop.createdAt } },
        ...Object.entries(shop.groups).map(([entityId, data]): Write => ({ id: id(), shopId, target: 'groups', entityId, data })),
        ...Object.entries(shop.items).map(([entityId, data]): Write => ({ id: id(), shopId, target: 'items', entityId, data })),
      ];
      await persist({ ...saved, shops: saved.shops.map(s => s.id === shopId ? { ...s, shared: true } : s), outbox: [...saved.outbox, ...writes] });
    }
    await flush();
    if (saved.outbox.some(w => w.shopId === shopId)) {
      throw new Error(view.error || 'Connect to the internet to finish sharing this shop. Your list is saved here.');
    }
    await publishShop(saved.shops.find(s => s.id === shopId)!);
    return shopId;
  },
  async stopSharing(shopIdToStop: string) {
    await flush();
    await stopSharing(shopIdToStop);
    const newId = shopId();
    watchers.get(shopIdToStop)?.();
    watchers.delete(shopIdToStop);
    await persist({ ...saved,
      shops: saved.shops.map(shop => shop.id === shopIdToStop ? { ...shop, id: newId, shared: false } : shop),
      outbox: saved.outbox.filter(write => write.shopId !== shopIdToStop) });
    notify({ error: '' });
    return newId;
  },
  async join(input: string) {
    const code = normalizeCode(input);
    if (!code) throw new Error('Enter the full shop ID, including all five groups of letters and numbers.');
    if (saved.shops.some(s => s.id === code)) return code;
    const shop = await joinRemote(code);
    await persist({ ...saved, shops: [...saved.shops.filter(s => s.id !== code), shop] });
    refreshWatchers();
    return code;
  },
};

// Retry while active; flush the short batching window on app state transitions.
setInterval(() => { if (view.ready && AppState.currentState === 'active' && dragDepth === 0) void flush(); }, 15000);
AppState.addEventListener('change', () => { if (dragDepth === 0) void flush(); });
