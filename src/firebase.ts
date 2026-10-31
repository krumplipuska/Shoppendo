import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { initializeAuth, getAuth, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
import * as FirebaseAuth from 'firebase/auth';
import type { Persistence } from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator,
} from 'firebase/firestore';
import { Platform } from 'react-native';
import type { Shop, Write } from './model';
import { readShop, writeShop, watchShopDocument, stopShopSharing } from './shop-document';

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

export async function sendWrites(writes: Write[], localShop?: Shop) {
  const { db, uid } = await connect();
  await deadline(writeShop(db, uid, writes, localShop));
}

export async function publishShop(shop: Shop) {
  const { db, uid } = await connect();
  await deadline(writeShop(db, uid, [], shop));
}

export async function joinRemote(shopId: string): Promise<Shop> {
  const { db, uid } = await connect();
  return deadline(readShop(db, uid, shopId));
}

export async function watchShop(
  shop: Shop,
  receive: (target: Write['target'], data: Record<string, unknown>) => void,
  fail: (error: Error) => void,
) {
  const { db, uid } = await connect();
  return watchShopDocument(db, uid, shop.id, remote => receive('shop', { ...remote }), fail, shop);
}

export async function stopSharing(shopId: string) {
  const { db } = await connect();
  await deadline(stopShopSharing(db, shopId));
}
