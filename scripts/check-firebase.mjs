import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInAnonymously, deleteUser } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, limit, terminate } from 'firebase/firestore';

const config = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
}));
const app = initializeApp({ apiKey: config.EXPO_PUBLIC_FIREBASE_API_KEY, projectId: config.EXPO_PUBLIC_FIREBASE_PROJECT_ID, appId: config.EXPO_PUBLIC_FIREBASE_APP_ID });
const auth = getAuth(app);
const db = getFirestore(app);
const timer = setTimeout(() => { console.error('Firebase check timed out.'); process.exit(1); }, 20000);
try {
  await signInAnonymously(auth);
  console.log('Anonymous authentication: enabled');
  let listingDenied = false;
  try { await getDocs(query(collection(db, 'shops'), limit(1))); }
  catch (error) { if (error.code === 'permission-denied') listingDenied = true; else throw error; }
  if (!listingDenied) throw new Error('Shop listing is still allowed. Publish firestore.rules before using live sharing.');
  console.log('Shop listing: denied by security rules');
} catch (error) {
  console.error(error.code ? `Firebase setup is not ready: ${error.code}` : error.message);
  process.exitCode = 1;
} finally {
  if (auth.currentUser) await deleteUser(auth.currentUser).catch(() => {});
  await terminate(db);
  await deleteApp(app);
  clearTimeout(timer);
}
