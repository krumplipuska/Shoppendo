// Build Android release files on this Mac or the TeamCity agent (no cloud).
//   node scripts/build-android.mjs <aab|apk|both> [dev|prod|pro]     (variant defaults to prod)
//     aab   Play Store bundle    apk   installable release APK    both   one Gradle run for both
//     dev   test ads, .dev app   prod  real ads, the free app     pro    no ads, the paid app
// Outputs are copied to dist/android/<variant>/shoppendo-<variant>-<versionCode>.<aab|apk>.
//
// Version code: Play Console accepts each one once per app. Locally an aab (or both) raises
// android.versionCode in app.json; commit that. CI sets ANDROID_VERSION_CODE instead: that number is
// used for this build only and app.json is left as it was.
// Signing: the upload key in credentials/ (see plugins/with-android-upload-signing.js), or the folder
// named by ANDROID_CREDENTIALS_DIR (the TeamCity agent uses the Mac's copy that way).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const [kind, variant = 'prod'] = process.argv.slice(2);
if (!['aab', 'apk', 'both'].includes(kind) || !['dev', 'prod', 'pro'].includes(variant)) {
  console.error('Usage: node scripts/build-android.mjs <aab|apk|both> [dev|prod|pro]');
  process.exit(1);
}
const credentials = resolve(process.env.ANDROID_CREDENTIALS_DIR ?? 'credentials');
if (!existsSync(join(credentials, 'android-upload.properties'))) {
  console.error(`${join(credentials, 'android-upload.properties')} is missing. Restore the credentials folder from your backup first.`);
  process.exit(1);
}
// Gradle needs the Android SDK: ANDROID_HOME, or Android Studio's default folder in either home.
const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), 'Library/Android/sdk'),
  '/Volumes/ExternalSSD/Library/Android/sdk'].find(path => path && existsSync(path));
if (!sdk) { console.error('Android SDK not found. Install it with Android Studio or set ANDROID_HOME.'); process.exit(1); }
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_CREDENTIALS_DIR: credentials, APP_VARIANT: variant, CI: '1' };
const run = (command, args, cwd = '.') => execFileSync(command, args, { cwd, stdio: 'inherit', env });

const original = readFileSync('app.json', 'utf8');
const ciVersion = process.env.ANDROID_VERSION_CODE;
if (ciVersion !== undefined && !/^[1-9]\d{0,9}$/.test(ciVersion)) {
  console.error(`ANDROID_VERSION_CODE must be a positive whole number, not "${ciVersion}".`);
  process.exit(1);
}
const current = JSON.parse(original).expo.android.versionCode;
const versionCode = ciVersion ? Number(ciVersion) : kind === 'apk' ? current : current + 1;
if (versionCode !== current) writeFileSync('app.json', original.replace(/("versionCode":\s*)\d+/, `$1${versionCode}`));
console.log(`Building ${variant} ${kind}, versionCode ${versionCode}`);

const tasks = { aab: ['bundleRelease'], apk: ['assembleRelease'], both: ['bundleRelease', 'assembleRelease'] }[kind];
try {
  // Apply app.config.js for this variant (package, name, ads, signing) to the native android/ project.
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install']);
  run('./gradlew', tasks, 'android');
} catch {
  writeFileSync('app.json', original); // A failed build keeps the old versionCode.
  console.error('\nBuild failed; app.json was left unchanged.');
  process.exit(1);
}
if (ciVersion) writeFileSync('app.json', original);

const out = join('dist', 'android', variant);
mkdirSync(out, { recursive: true });
const built = {
  aab: 'android/app/build/outputs/bundle/release/app-release.aab',
  apk: 'android/app/build/outputs/apk/release/app-release.apk',
};
for (const type of kind === 'both' ? ['aab', 'apk'] : [kind]) {
  const target = join(out, `shoppendo-${variant}-${versionCode}.${type}`);
  copyFileSync(built[type], target);
  console.log(`Built: ${target}`);
}
// R8's mapping file turns obfuscated Play crash reports back into readable stack traces.
const mapping = 'android/app/build/outputs/mapping/release/mapping.txt';
if (existsSync(mapping)) copyFileSync(mapping, join(out, `mapping-${variant}-${versionCode}.txt`));
