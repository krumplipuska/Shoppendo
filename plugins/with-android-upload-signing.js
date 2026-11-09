// Sign Android release builds (the Play Store .aab and release .apk) with the private upload key in
// credentials/ (git-ignored), or in the folder named by ANDROID_CREDENTIALS_DIR (used by the TeamCity agent). Without that folder, release builds fall back to the debug key, which
// still installs on a phone but which Play Console rejects.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// shoppendo-upload-signing';
const LOAD = `${MARKER}
def uploadKeyDir = System.getenv('ANDROID_CREDENTIALS_DIR') ? new File(System.getenv('ANDROID_CREDENTIALS_DIR')) : rootProject.file('../credentials')
def uploadKeyFile = new File(uploadKeyDir, 'android-upload.properties')
def uploadKey = new Properties()
if (uploadKeyFile.exists()) uploadKeyFile.withInputStream { uploadKey.load(it) }
else logger.warn("\${uploadKeyFile} is missing: release builds use the debug key and Play Console will reject them.")

`;
const RELEASE_CONFIG = `
        release {
            if (uploadKeyFile.exists()) {
                storeFile new File(uploadKeyFile.parentFile, uploadKey['storeFile'])
                storePassword uploadKey['storePassword']
                keyAlias uploadKey['keyAlias']
                keyPassword uploadKey['keyPassword']
            }
        }`;

module.exports = config => withAppBuildGradle(config, gradle => {
  let src = gradle.modResults.contents;
  if (src.includes(MARKER)) return gradle;
  const replace = (pattern, value) => {
    if (!pattern.test(src)) throw new Error(`with-android-upload-signing: could not find ${pattern} in app/build.gradle`);
    src = src.replace(pattern, value);
  };
  replace(/(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/, '$1signingConfig uploadKeyFile.exists() ? signingConfigs.release : signingConfigs.debug');
  replace(/signingConfigs \{/, `signingConfigs {${RELEASE_CONFIG}`);
  replace(/^android \{/m, `${LOAD}android {`);
  gradle.modResults.contents = src;
  return gradle;
});
