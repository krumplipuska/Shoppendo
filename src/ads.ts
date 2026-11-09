// AdMob IDs for Shoppendo (publisher pub-6495432322512713). These are public: they ship inside the app.
// The app IDs also live in app.json under "react-native-google-mobile-ads", where the SDK reads them.
// Not wired up yet: the banner still needs react-native-google-mobile-ads and a new native build.
// Use Google's test ad units in development builds; tapping your own live ads can suspend the account.
export const ADMOB = {
  android: { appId: 'ca-app-pub-6495432322512713~5666248779', bannerUnitId: 'ca-app-pub-6495432322512713/4008397229' },
  ios: { appId: 'ca-app-pub-6495432322512713~7508658535', bannerUnitId: 'ca-app-pub-6495432322512713/1727003765' },
} as const;
