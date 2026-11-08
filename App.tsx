import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { DraxProvider } from 'react-native-drax';
import { useFonts } from 'expo-font';
import { actions, errorMessage, load, useShops, UNDO_MS } from './src/store';
import { Button, EditingSurface, FloatingUndoButton } from './src/ui';
import { colors as c } from './src/theme';
import { shopCodeFromLink } from './src/links';
import { s } from './src/styles';
import { markAppReady, AnimatedSplash, LoadingScreen } from './src/components/Splash';
import { ShopList } from './src/screens/Stores';
import { ShoppingList } from './src/screens/ShoppingList';

function Main() {
  const { data, ready, error, undo } = useShops();
  const [selected, setSelected] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string } | null>(null);
  const [joining, setJoining] = useState(false);
  const [linkError, setLinkError] = useState('');
  const shop = data.shops.find(s => s.id === selected);
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (ready || error) markAppReady(); }, [ready, error]);
  useEffect(() => {
    const receive = (url: string | null | undefined) => {
      const code = url && shopCodeFromLink(url);
      if (code) setInvite({ code });
    };
    const subscription = Linking.addEventListener('url', event => receive(event.url));
    void Linking.getInitialURL().then(receive).catch(() => setLinkError('Could not open the shared store link. Please try the link again.'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!ready || !invite) return;
    let active = true;
    setJoining(true); setLinkError('');
    void actions.join(invite.code).then(id => { if (active) setSelected(id); })
      .catch(error => { if (active) setLinkError(errorMessage(error)); })
      .finally(() => { if (active) setJoining(false); });
    return () => { active = false; };
  }, [ready, invite]);
  if (!ready) return error ? <View style={s.loading}><Text style={s.caption}>{error}</Text><Button label="Try again" onPress={() => void load()} /></View> : <LoadingScreen />;
  return <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
    {joining && <View style={s.errorBanner}><ActivityIndicator color={c.primary} /><Text accessibilityLiveRegion="polite" style={s.caption}>Opening shared store…</Text></View>}
    {Boolean(linkError) && <View accessibilityRole="alert" style={s.errorBanner}><Text style={[s.caption, s.flex]}>{linkError}</Text>{invite && <Pressable accessibilityRole="button" style={s.retry} onPress={() => setInvite({ ...invite })}><Text style={s.link}>Retry</Text></Pressable>}</View>}
    {Platform.OS === 'web' && invite && <View style={s.errorBanner}><Text style={[s.caption, s.flex]}>Have Shoppendo installed?</Text><Pressable accessibilityRole="link" style={s.retry} onPress={() => { void Linking.openURL(`shoppendo://join/${invite.code}`).catch(() => setLinkError('Could not open the app. You can use this store in your browser.')); }}><Text style={s.link}>Open app</Text></Pressable></View>}
    {Boolean(error) && <View accessibilityRole="alert" style={s.errorBanner}><Text style={[s.caption, s.flex]}>{error}</Text><Pressable accessibilityRole="button" onPress={() => { actions.clearError(); void actions.retry().catch(() => {}); }} style={s.retry}><Text style={s.link}>Retry</Text></Pressable></View>}
    <View style={s.flex}>
      {/* Keep the stores visible behind the back gesture, with their own receiver registry. */}
      <View {...(Platform.OS === 'web' ? { inert: Boolean(shop) } : {})} style={s.flex}
        pointerEvents={shop ? 'none' : 'auto'} accessibilityElementsHidden={Boolean(shop)}
        importantForAccessibility={shop ? 'no-hide-descendants' : 'auto'} aria-hidden={Boolean(shop)}>
        <DraxProvider><ShopList open={setSelected} /></DraxProvider>
      </View>
      {shop && <View style={StyleSheet.absoluteFill}><ShoppingList key={shop.id} shop={shop} replaced={setSelected} back={() => setSelected(null)} /></View>}
    </View>
    {undo && <FloatingUndoButton key={undo.startedAt} label={undo.label} onPress={actions.undo} duration={UNDO_MS} />}
  </KeyboardAvoidingView>;
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular: require('@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf'),
    DMSans_500Medium: require('@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf'),
    DMSans_600SemiBold: require('@expo-google-fonts/dm-sans/600SemiBold/DMSans_600SemiBold.ttf'),
    DMSans_700Bold: require('@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf'),
  });
  return <GestureHandlerRootView style={s.root}><SafeAreaProvider><DraxProvider><StatusBar style="dark" />
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {fontsLoaded || fontError || Platform.OS === 'web' ? <EditingSurface><Main /></EditingSurface> : <LoadingScreen />}
    </SafeAreaView>
    <AnimatedSplash />
  </DraxProvider></SafeAreaProvider></GestureHandlerRootView>;
}
