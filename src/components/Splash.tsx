// Animated launch screen and the plain loading placeholder.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import Animated, { Easing, ReduceMotion, useSharedValue, useAnimatedStyle, cancelAnimation, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import { runOnJS } from 'react-native-worklets';
import { s } from '../styles';

// The native launch screen is static, so it stays up only until an identical JS copy
// (<AnimatedSplash />) is on screen. The copy then animates and fades out once the app is ready.
void SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 0, fade: false });
export const SPLASH_MIN_MS = 1500;
export const SPLASH_SIZE = 140; // must match imageWidth of the expo-splash-screen plugin in app.json
let appReady = false;
let onAppReady: (() => void) | null = null;
export function markAppReady() {
  if (appReady) return;
  appReady = true;
  onAppReady?.();
}
// Never leave the user stuck on the splash if loading hangs.
setTimeout(markAppReady, 8000);

export function AnimatedSplash() {
  const [visible, setVisible] = useState(Platform.OS !== 'web');
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  const opacity = useSharedValue(1);
  const started = useRef(false);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ translateY: lift.value }, { scale: scale.value }] }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    // The JS copy now covers the screen pixel-for-pixel, so swap out the native splash.
    SplashScreen.hide();
    const motion = { reduceMotion: ReduceMotion.System };
    const ease = Easing.bezier(0.22, 1, 0.36, 1);
    // Little "bag drop": squash, bounce up, settle - then a gentle breathing loop while loading.
    scale.value = withSequence(
      withTiming(0.92, { duration: 160, easing: Easing.out(Easing.quad), ...motion }),
      withTiming(1.05, { duration: 260, easing: ease, ...motion }),
      withTiming(1, { duration: 220, easing: Easing.inOut(Easing.quad), ...motion }),
      withRepeat(withSequence(
        withTiming(1.04, { duration: 700, easing: Easing.inOut(Easing.sin), ...motion }),
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin), ...motion }),
      ), -1, false),
    );
    lift.value = withSequence(
      withTiming(4, { duration: 160, ...motion }),
      withTiming(-10, { duration: 260, easing: ease, ...motion }),
      withTiming(0, { duration: 220, easing: Easing.inOut(Easing.quad), ...motion }),
    );
    const shownAt = Date.now();
    const exit = () => {
      setTimeout(() => {
        cancelAnimation(scale);
        // Zoom the icon towards the user while the whole splash fades away.
        scale.value = withTiming(1.35, { duration: 380, easing: Easing.in(Easing.cubic), ...motion });
        opacity.value = withDelay(80, withTiming(0, { duration: 320, ...motion }, finished => {
          if (finished) runOnJS(setVisible)(false);
        }));
      }, Math.max(0, SPLASH_MIN_MS - (Date.now() - shownAt)));
    };
    if (appReady) exit(); else onAppReady = exit;
  }, []);
  useEffect(() => {
    // Fallback in case the image load event never fires.
    const timer = Platform.OS === 'web' ? undefined : setTimeout(start, 600);
    return () => { clearTimeout(timer); onAppReady = null; };
  }, [start]);
  if (!visible) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.splash, overlayStyle]}>
    <Animated.Image accessibilityLabel="Shoppendo" source={require('../../assets/shoppendo-splash.png')} resizeMode="contain"
      onLoad={start} style={[{ width: SPLASH_SIZE, height: SPLASH_SIZE }, iconStyle]} />
  </Animated.View>;
}
export function LoadingScreen() {
  return <View style={s.loading}><Image accessibilityLabel="Loading Shoppendo" source={require('../../assets/shoppendo-splash.png')} resizeMode="contain" style={{ width: 140, height: 140 }} /></View>;
}
