// The one banner ad: anchored at the bottom of the Stores screen, under the store list.
// Which ads depends on the build (app.config.js): dev shows Google test ads (safe to tap), prod real
// AdMob ads, and the paid pro build none at all.
import { useEffect, useState } from 'react';
import { Platform, TurboModuleRegistry, View } from 'react-native';
import Constants from 'expo-constants';
import { ADMOB } from '../ads';
import { s } from '../styles';

const mode = (Constants.expoConfig?.extra?.ads ?? 'test') as 'test' | 'live' | 'none';
// No ads in pro; Expo Go and pro builds also have no AdMob native code, so never import it there.
const ads = mode !== 'none' && TurboModuleRegistry.get('RNGoogleMobileAdsModule')
  ? require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads') : null;
let started: Promise<unknown> | undefined;

export function StoreBanner({ onHeight }: { onHeight?: (height: number) => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (ads) started ??= ads.default().initialize(); }, []);
  // Report 0 when the banner goes away so floating buttons drop back down.
  useEffect(() => () => onHeight?.(0), [onHeight]);
  if (!ads || failed) return null;
  const { BannerAd, BannerAdSize, TestIds } = ads;
  const unitId = mode === 'live' ? ADMOB[Platform.OS === 'ios' ? 'ios' : 'android'].bannerUnitId : TestIds.ADAPTIVE_BANNER;
  return <View style={s.storeBanner} onLayout={event => onHeight?.(event.nativeEvent.layout.height)}>
    <BannerAd unitId={unitId} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
      requestOptions={{ requestNonPersonalizedAdsOnly: true }} onAdFailedToLoad={() => { setFailed(true); onHeight?.(0); }} />
  </View>;
}
