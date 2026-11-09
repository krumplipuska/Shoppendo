// The one banner ad: anchored under the store page's list. Google test ads for now (TestIds), so tapping
// them is safe. Swap in ADMOB.<platform>.bannerUnitId from ../ads for release once live ads are wanted.
import { useEffect, useState } from 'react';
import { TurboModuleRegistry, View } from 'react-native';
import { s } from '../styles';

// Expo Go has no AdMob native code; skip ads there instead of crashing on import.
const ads = TurboModuleRegistry.get('RNGoogleMobileAdsModule')
  ? require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads') : null;
let started: Promise<unknown> | undefined;

export function StoreBanner({ onHeight }: { onHeight?: (height: number) => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (ads) started ??= ads.default().initialize(); }, []);
  // Report 0 when the banner goes away so floating buttons drop back down.
  useEffect(() => () => onHeight?.(0), [onHeight]);
  if (!ads || failed) return null;
  const { BannerAd, BannerAdSize, TestIds } = ads;
  return <View style={s.storeBanner} onLayout={event => onHeight?.(event.nativeEvent.layout.height)}>
    <BannerAd unitId={TestIds.ADAPTIVE_BANNER} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
      requestOptions={{ requestNonPersonalizedAdsOnly: true }} onAdFailedToLoad={() => { setFailed(true); onHeight?.(0); }} />
  </View>;
}
