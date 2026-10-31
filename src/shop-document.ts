import { collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, runTransaction, setDoc, type Firestore } from 'firebase/firestore';
import { applyWrite, isGroup, isItem, isShopMeta, type Group, type Item, type Shop, type Write } from './model.ts';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const validId = (id: string) => /^[\w-]{1,80}$/.test(id);

export function decodeShop(id: string, data: unknown): Shop {
  if (!record(data)) throw new Error('This shop has an unsupported format.');
  if (data.stopped === true) throw new Error('Sharing has stopped for this shop. Your local list has been kept.');
  const categories = data.categories;
  if (data.schemaVersion !== 2 || !record(categories) || !isShopMeta(data)) {
    throw new Error('This shop has an unsupported format. Your local list has been kept.');
  }
  const groups: Record<string, Group> = Object.create(null);
  const items: Record<string, Item> = Object.create(null);
  for (const [groupId, category] of Object.entries(categories)) {
    if (!validId(groupId) || !record(category)) throw new Error('This shop contains an invalid category.');
    const { items: nestedItems, ...group } = category;
    if (!isGroup(group) || !record(nestedItems)) throw new Error('This shop contains an invalid category.');
    groups[groupId] = group;
    for (const [itemId, value] of Object.entries(nestedItems)) {
      const item = record(value) ? { ...value, groupId } : null;
      if (!validId(itemId) || !isItem(item) || Object.hasOwn(items, itemId)) throw new Error('This shop contains an invalid item.');
      items[itemId] = item;
    }
  }
  return { id, name: data.name, createdAt: data.createdAt, groupOrder: data.groupOrder, shared: true, groups, items };
}

export function encodeShop(shop: Shop) {
  const categories = Object.fromEntries(Object.entries(shop.groups).map(([id, group]) => [id, { ...group, items: {} as Record<string, Omit<Item, 'groupId'>> }]));
  for (const [id, item] of Object.entries(shop.items)) {
    const { groupId, ...fields } = item;
    if (!Object.hasOwn(categories, groupId)) throw new Error('This item has no category. Your local list has been kept.');
    categories[groupId].items[id] = fields;
  }
  const data = { schemaVersion: 2, name: shop.name, createdAt: shop.createdAt, groupOrder: shop.groupOrder, categories };
  decodeShop(shop.id, data);
  return data;
}

// One-time upgrade: leave old subcollections untouched as a backup.
export async function migrateShop(db: Firestore, uid: string, shopId: string): Promise<Shop> {
  const ref = doc(db, 'shops', shopId);
  await setDoc(doc(ref, 'members', uid), { uid });
  const [groups, items] = await Promise.all([
    getDocsFromServer(collection(ref, 'groups')), getDocsFromServer(collection(ref, 'items')),
  ]);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (data?.schemaVersion === 2) return decodeShop(shopId, data);
    if (!isShopMeta(data)) throw new Error('This shop has an unsupported format.');
    const shop: Shop = { id: shopId, ...data, shared: true,
      groups: Object.fromEntries(groups.docs.map(d => [d.id, d.data() as Group])),
      items: Object.fromEntries(items.docs.map(d => [d.id, d.data() as Item])),
    };
    transaction.set(ref, encodeShop(shop));
    return shop;
  });
}

export async function readShop(db: Firestore, uid: string, shopId: string) {
  const snapshot = await getDocFromServer(doc(db, 'shops', shopId));
  if (!snapshot.exists()) throw new Error('No shop found with that ID. Check it and try again.');
  return snapshot.data().schemaVersion === 2 ? decodeShop(shopId, snapshot.data()) : migrateShop(db, uid, shopId);
}

export async function writeShop(db: Firestore, uid: string, writes: Write[], localShop?: Shop) {
  if (!writes.length && !localShop) return;
  if (localShop && !localShop.shared) throw new Error('Use Share shop ID to upload this local list.');
  const shopId = localShop?.id ?? writes[0].shopId;
  if (writes.some(write => write.shopId !== shopId)) throw new Error('Cannot sync different shops together.');
  const ref = doc(db, 'shops', shopId);
  const legacy = new Error('Shop needs migration');
  const commit = () => runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists() && snapshot.data().schemaVersion !== 2) throw legacy;
    // Sharing again verifies the document without overwriting other devices' changes.
    if (snapshot.exists() && !writes.length) { decodeShop(shopId, snapshot.data()); return; }
    let shop: Shop = snapshot.exists() ? decodeShop(shopId, snapshot.data())
      : localShop ?? { id: shopId, name: '', createdAt: 0, groupOrder: [], groups: {}, items: {}, shared: true };
    const before = snapshot.exists() ? JSON.stringify(encodeShop(shop)) : undefined;
    for (const write of writes) shop = applyWrite(shop, write);
    const data = encodeShop(shop);
    // A retry after a lost acknowledgement may already be applied on the server.
    if (JSON.stringify(data) === before) return;
    // A transaction retries against the latest shop if another device edits it.
    // ponytail: one document has a 1 MiB ceiling; split shops again if lists outgrow it.
    transaction.set(ref, data);
  });
  try { await commit(); }
  catch (error) {
    if (error !== legacy) throw error;
    await migrateShop(db, uid, shopId);
    await commit();
  }
}

export function watchShopDocument(db: Firestore, uid: string, shopId: string, receive: (shop: Shop) => void, fail: (error: Error) => void, localShop?: Shop) {
  let migrating: Promise<Shop> | undefined;
  let restoring: Promise<void> | undefined;
  return onSnapshot(doc(db, 'shops', shopId), { includeMetadataChanges: true }, snapshot => {
    if (!snapshot.exists()) {
      // An empty local SDK cache is not evidence that the server document is missing.
      if (snapshot.metadata.fromCache) return;
      if (localShop) {
        restoring ??= writeShop(db, uid, [], localShop).catch(fail).finally(() => { restoring = undefined; });
      } else fail(new Error('This shared shop no longer exists.'));
      return;
    }
    if (snapshot.data().schemaVersion !== 2) {
      migrating ??= migrateShop(db, uid, shopId).catch(error => { fail(error); throw error; });
      void migrating.catch(() => { migrating = undefined; });
      return;
    }
    try { receive(decodeShop(shopId, snapshot.data())); }
    catch (error) { fail(error as Error); }
  }, fail);
}

// Replace the shared content with a permanent tombstone so old IDs cannot be reused.
export async function stopShopSharing(db: Firestore, shopId: string) {
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'shops', shopId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || snapshot.data().stopped === true) return;
    transaction.set(ref, { schemaVersion: 2, name: 'Sharing stopped', createdAt: snapshot.data().createdAt,
      groupOrder: [], categories: {}, stopped: true });
  });
}
