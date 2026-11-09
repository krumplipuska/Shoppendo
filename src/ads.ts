// AdMob IDs for Shoppendo (publisher pub-6495432322512713). These are public: they ship inside the app.
// The app IDs are also set in app.json (react-native-google-mobile-ads plugin), where the native SDK reads them.
// Only the prod build (APP_VARIANT=prod) shows these live units; dev builds use Google's test ads, since
// tapping your own live ads can suspend the AdMob account. See src/components/StoreBanner.tsx.
export const ADMOB = {
  android: { appId: 'ca-app-pub-6495432322512713~5666248779', bannerUnitId: 'ca-app-pub-6495432322512713/4008397229' },
  ios: { appId: 'ca-app-pub-6495432322512713~7508658535', bannerUnitId: 'ca-app-pub-6495432322512713/1727003765' },
} as const;
