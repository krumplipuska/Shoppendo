// The paid "pro" build has no ads: keep the AdMob SDK out of it entirely, not just switched off.
const noAds = process.env.APP_VARIANT === 'pro';
module.exports = {
  dependencies: noAds ? { 'react-native-google-mobile-ads': { platforms: { android: null, ios: null } } } : {},
};
