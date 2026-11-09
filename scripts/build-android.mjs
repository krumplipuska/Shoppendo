// Build Android release files on this Mac (no cloud).
//   node scripts/build-android.mjs aab   → Play Store bundle; raises versionCode in app.json first,
//                                          since Play Console accepts each versionCode only once.
//   node scripts/build-android.mjs apk   → installable release APK (same versionCode).
// Both are signed with the upload key in credentials/ (see plugins/with-android-upload-signing.js).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const kind = process.argv[2];
if (kind !== 'aab' && kind !== 'apk') { console.error('Usage: node scripts/build-android.mjs aab|apk'); process.exit(1); }
if (!existsSync('credentials/android-upload.properties')) {
  console.error('credentials/android-upload.properties is missing. Restore the credentials folder from your backup first.');
  process.exit(1);
}
// Gradle needs the Android SDK: ANDROID_HOME, or Android Studio's default folder in either home.
const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), 'Library/Android/sdk'),
  '/Volumes/ExternalSSD/Library/Android/sdk'].find(path => path && existsSync(path));
if (!sdk) { console.error('Android SDK not found. Install it with Android Studio or set ANDROID_HOME.'); process.exit(1); }
const run = (command, args, cwd = '.') => execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ANDROID_HOME: sdk, CI: '1' } });

const original = readFileSync('app.json', 'utf8');
if (kind === 'aab') {
  const next = JSON.parse(original).expo.android.versionCode + 1;
  writeFileSync('app.json', original.replace(/("versionCode":\s*)\d+/, `$1${next}`));
  console.log(`versionCode → ${next}`);
}
try {
  // Apply app.json (version, plugins, signing) to the native android/ project.
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install']);
  run('./gradlew', [kind === 'aab' ? 'bundleRelease' : 'assembleRelease'], 'android');
} catch (error) {
  writeFileSync('app.json', original); // A failed build keeps the old versionCode.
  console.error('\nBuild failed; app.json was left unchanged.');
  process.exit(1);
}
console.log(`\nBuilt: android/app/build/outputs/${kind === 'aab' ? 'bundle/release/app-release.aab' : 'apk/release/app-release.apk'}`);
