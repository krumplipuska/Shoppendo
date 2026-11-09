// Three builds of one app, picked with APP_VARIANT (default: dev). app.json holds everything shared.
//   dev   com.tamasbagyinszki.shoppendo.dev   "Shoppendo Dev"   Google test ads; installs next to the store apps
//   prod  com.tamasbagyinszki.shoppendo       "Shoppendo"       free on Play, real AdMob ads
//   pro   com.tamasbagyinszki.shoppendo.pro   "Shoppendo Pro"   paid on Play, no ads (the ads SDK isn't even included)
// Package names are permanent once a build is uploaded to Play Console.
const VARIANTS = {
  dev: { name: 'Shoppendo Dev', androidPackage: 'com.tamasbagyinszki.shoppendo.dev', ads: 'test' },
  prod: { name: 'Shoppendo', androidPackage: 'com.tamasbagyinszki.shoppendo', ads: 'live' },
  pro: { name: 'Shoppendo Pro', androidPackage: 'com.tamasbagyinszki.shoppendo.pro', ads: 'none' },
};
const variant = process.env.APP_VARIANT ?? 'dev';
if (!VARIANTS[variant]) throw new Error(`APP_VARIANT must be one of ${Object.keys(VARIANTS).join(', ')}, not "${variant}".`);
const { name, androidPackage, ads } = VARIANTS[variant];

module.exports = ({ config }) => ({
  ...config,
  name,
  android: { ...config.android, package: androidPackage },
  // Without ads the AdMob plugin (and, via react-native.config.js, the SDK) is left out.
  plugins: config.plugins.filter(plugin => ads !== 'none' || (Array.isArray(plugin) ? plugin[0] : plugin) !== 'react-native-google-mobile-ads'),
  extra: { ...config.extra, variant, ads },
});
