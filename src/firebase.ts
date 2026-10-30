import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { initializeAuth, getAuth, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
import * as FirebaseAuth from 'firebase/auth';
import type { Persistence } from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, collection, doc, getDocFromServer,
  getDocsFromServer, onSnapshot, setDoc, writeBatch,
} from 'firebase/firestore';
import { Platform } from 'react-native';
import { isGroup, isItem, isShopMeta, type Shop, type Write } from './model';

const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST;
export const firebaseConfigured = Boolean(projectId && (emulatorHost || (
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY && process.env.EXPO_PUBLIC_FIREBASE_APP_ID
)));

let services: ReturnType<typeof createServices> | undefined;
let signingIn: Promise<unknown> | undefined;

async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Could not connect. Your lists are saved here; try again when you are online.')), 12000);
  });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(timer!); }
}

function createServices() {
  const app = initializeApp({
    projectId,
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'demo-api-key',
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || 'demo-app-id',
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  });
  // The SDK's native entry point exposes this function; its shared web typings omit it.
  const nativeAuth = FirebaseAuth as typeof FirebaseAuth & {
    getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
  };
  const auth = Platform.OS === 'web' ? getAuth(app) : initializeAuth(app, {
    persistence: nativeAuth.getReactNativePersistence(AsyncStorage),
  });
  const db = getFirestore(app);
  if (emulatorHost) {
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, emulatorHost, 8080);
  }
  return { auth, db };
}

export async function connect() {
  if (!firebaseConfigured) throw new Error('Shop sharing is not connected yet. Your lists still work on this phone.');
  services ??= createServices();
  await services.auth.authStateReady();
  if (!services.auth.currentUser) {
    signingIn ??= signInAnonymously(services.auth).finally(() => { signingIn = undefined; });
    await deadline(signingIn);
  }
  return { ...services, uid: services.auth.currentUser!.uid };
}

export async function sendWrites(writes: Write[]) {
  const { db, uid } = await connect();
  const shopId = writes[0].shopId;
  const batch = writeBatch(db);
  batch.set(doc(db, 'shops', shopId, 'members', uid), { uid });
  // Each item is its own document: two people adding different items never replace each other's list.
  const merged = new Map<string, Write>();
  for (const write of writes) {
    const key = `${write.target}/${write.entityId}`;
    const previous = merged.get(key);
    merged.set(key, { ...write, data: { ...previous?.data, ...write.data } });
  }
  for (const write of merged.values()) {
    const ref = write.target === 'shop' ? doc(db, 'shops', shopId)
      : doc(db, 'shops', shopId, write.target, write.entityId);
    batch.set(ref, write.data, { merge: true });
  }
  await deadline(batch.commit());
}

export async function joinRemote(shopId: string): Promise<Shop> {
  const { db, uid } = await connect();
  const meta = await deadline(getDocFromServer(doc(db, 'shops', shopId)));
  if (!meta.exists()) throw new Error('No shop found with that ID. Check it and try again.');
  const data = meta.data();
  if (!isShopMeta(data)) throw new Error('This shop has an unsupported format.');
  await deadline(setDoc(doc(db, 'shops', shopId, 'members', uid), { uid }));
  const [groups, items] = await deadline(Promise.all([
    getDocsFromServer(collection(db, 'shops', shopId, 'groups')),
    getDocsFromServer(collection(db, 'shops', shopId, 'items')),
  ]));
  return {
    id: shopId, name: data.name, createdAt: data.createdAt, groupOrder: data.groupOrder, shared: true,
    groups: Object.fromEntries(groups.docs.filter(d => isGroup(d.data())).map(d => [d.id, d.data()])),
    items: Object.fromEntries(items.docs.filter(d => isItem(d.data())).map(d => [d.id, d.data()])),
  } as Shop;
}

export async function watchShop(
  shopId: string,
  receive: (target: Write['target'], data: Record<string, unknown>) => void,
  fail: (error: Error) => void,
) {
  const { db } = await connect();
  const stops = [
    onSnapshot(doc(db, 'shops', shopId), snap => {
      if (snap.exists() && isShopMeta(snap.data())) receive('shop', snap.data());
    }, fail),
    onSnapshot(collection(db, 'shops', shopId, 'groups'), snap => {
      receive('groups', Object.fromEntries(snap.docs.filter(d => isGroup(d.data())).map(d => [d.id, d.data()])));
    }, fail),
    onSnapshot(collection(db, 'shops', shopId, 'items'), snap => {
      receive('items', Object.fromEntries(snap.docs.filter(d => isItem(d.data())).map(d => [d.id, d.data()])));
    }, fail),
  ];
  return () => stops.forEach(stop => stop());
}
