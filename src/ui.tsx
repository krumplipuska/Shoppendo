import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { colors as c, fonts as f } from './theme';
import { type GroupIcon } from './model';
import { deleteSwipeProgress } from './interaction';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-worklets';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming, cancelAnimation } from 'react-native-reanimated';

export type IconName = 'plus' | 'check' | 'back' | 'down' | 'right' | 'share' | 'copy' | 'close' | 'trash' | 'more' | GroupIcon;
export type InputHandle = React.ComponentRef<typeof TextInput>;
type Dismiss = () => void | boolean;
const EditingContext = createContext<Map<symbol, Dismiss> | null>(null);
const ProtectedRegions = createContext<symbol[]>([]);
function dismissOutside(regions: Map<symbol, Dismiss>, protectedKeys: symbol[] = []) {
  for (const [key, close] of [...regions]) {
    if (protectedKeys.includes(key)) continue;
    // Remove before calling: a touch can emit both pointer and touch events.
    regions.delete(key);
    if (close() === false) regions.set(key, close);
  }
}
export function EditingSurface({ children }: { children: React.ReactNode }) {
  const editors = useRef(new Map<symbol, Dismiss>()).current;
  const dismiss = () => { dismissOutside(editors); Keyboard.dismiss(); };
  return <EditingContext value={editors}><View style={{ flex: 1 }} onTouchStart={dismiss} onPointerDown={Platform.OS === 'web' ? dismiss : undefined}>{children}</View></EditingContext>;
}
export function EditingRegion({ children, onDismiss }: { children: React.ReactNode; onDismiss?: Dismiss }) {
  const editors = useContext(EditingContext);
  const ancestors = useContext(ProtectedRegions);
  const key = useRef(Symbol()).current;
  const dismiss = useRef(onDismiss); dismiss.current = onDismiss;
  useEffect(() => {
    if (!editors || !onDismiss) return;
    editors.set(key, () => dismiss.current?.());
    return () => { editors.delete(key); };
  }, [editors, key, Boolean(onDismiss)]);
  const protect = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    if (editors) dismissOutside(editors, [...ancestors, key]);
  };
  return <ProtectedRegions value={[...ancestors, key]}><View onTouchStart={protect} onPointerDown={Platform.OS === 'web' ? protect : undefined}>{children}</View></ProtectedRegions>;
}
export function useFinishEditing() {
  const editors = useContext(EditingContext);
  return () => {
    if (editors) dismissOutside(editors);
    Keyboard.dismiss();
    return !editors?.size;
  };
}
const paths: Record<Exclude<IconName, 'more'>, string> = {
  copy: 'M9 9h12v12H9V9ZM5 15H3V3h12v2',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  plus: 'M12 5v14M5 12h14', check: 'm5 12 4 4L19 6', back: 'm14 5-7 7 7 7', down: 'm7 10 5 5 5-5', right: 'm9 6 6 6-6 6',
  share: 'M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8', close: 'm6 6 12 12M6 18 18 6', bag: 'M5 7h14l1 14H4L5 7ZM8 8V6a4 4 0 0 1 8 0v2',
  fruit: 'M12 8c-6-5-11 1-8 8 2 5 5 6 8 4 3 2 6 1 8-4 3-7-2-13-8-8Zm0 0V4m0 1c1-3 4-3 6-2-1 3-3 4-6 2Z',
  bread: 'M6 7c-5 0-5 7-2 8v6h16v-6c3-1 3-8-2-8-1-5-11-5-12 0Zm3 5 1 4m4-4 1 4',
  milk: 'M8 3h8v4l3 4v10H5V11l3-4V3Zm0 4h8M5 11h14M9 15h6v3H9Z',
  fish: 'M3 12c5-8 12-8 16 0-4 8-11 8-16 0Zm16 0 3-5v10l-3-5ZM7 10h.01m4-5 3-3 1 4m-4 13 3 3 1-4',
  snow: 'M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3M3 10l4-1-1-4m12 14-1-4 4-1M3 14l4 1-1 4M18 5l-1 4 4 1',
  clean: 'M9 8h7v3l3 4v6H6v-6l3-4V8Zm0 0V4h8v3m0-3h3v3M6 16h13M3 3v4M1 5h4',
  carrot: 'M15 7c6 4-5 13-12 14 1-7 6-20 12-14Zm0 0 2-5m-2 5 6-2m-6 2 6 3M7 11l3 2m-5 3 2 1',
  coffee: 'M4 8h12v8a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm12 1h2a3 3 0 0 1 0 6h-2M7 2v3m4-3v3',
  bottle: 'M9 2h6v4l3 5v10H6V11l3-5V2Zm0 4h6M6 13h12M9 16h6',
  pet: 'M8 14c-5 5-2 9 2 6l2-1 2 1c4 3 7-1 2-6-3-4-5-4-8 0ZM3 8c0-4 4-4 4 0s-4 4-4 0Zm6-4c0-4 4-4 4 0s-4 4-4 0Zm7 0c0-4 4-4 4 0s-4 4-4 0Zm3 7c0-4 4-4 4 0s-4 4-4 0Z',
  heart: 'M12 21 3 12C-3 4 7-2 12 5c5-7 15-1 9 7l-9 9Z',
  egg: 'M20 14c0 10-16 10-16 0 0-5 5-12 8-12s8 7 8 12Z',
  cheese: 'M3 10 17 3l4 7v11H3V10Zm0 0h18M7 15h.01M15 14h.01M12 18h.01M18 19h.01',
  meat: 'M14 3c8-3 11 8 4 12l-5 3-4-4 3-6 2-5ZM9 14l-5 5m-1-3c-3 0-3 5 0 5 0 3 5 3 5 0M16 7c-3 0-3 4 0 4s3-4 0-4Z',
  cake: 'M3 11h18v10H3V11Zm0 4c3 4 5-3 8 0s5-3 10 0M7 11V7h10v4M12 7V3m0 0 1-2',
  pizza: 'M3 21 9 3c5-1 10 3 12 7L3 21ZM8 6c5-1 9 2 10 6M9 12h.01M11 16h.01M14 10h.01',
  rice: 'M3 12h18c-1 12-17 12-18 0Zm2 0c-2-5 5-8 7-5 2-4 9-1 7 5M8 6l-1-3m7 2 1-3M7 16h10',
  pasta: 'M4 8c0 8 4 12 8 12s8-4 8-12M2 8h20M7 8V3m4 5V2m4 6V4M5 13h14',
  cereal: 'M5 3h14v18H5V3Zm0 4h14M8 12h.01M13 11h.01M16 15h.01M10 17h.01',
  candy: 'm8 8 8 8m-9-3 4 4c6 4 10-2 6-6l-4-4c-5-4-10 2-6 6ZM7 8 2 4v7l5 2m10 3 5 4v-7l-5-2',
  chocolate: 'M5 2h14v20H5V2Zm0 7h14M5 15h14M12 2v20',
  salt: 'M8 3h8v5l3 5v8H5v-8l3-5V3Zm0 5h8M9 5h.01M13 5h.01M10 15h.01M14 18h.01',
  oil: 'M9 2h6v5l4 5v10H5V12l4-5V2Zm0 5h6m-3 5c-6 6-3 8 0 8s6-2 0-8Z',
  water: 'M12 2c-3 5-8 10-8 14 0 8 16 8 16 0 0-4-5-9-8-14Zm-4 14c0 2 1 3 3 3',
  soda: 'M7 3h10l2 18H5L7 3Zm0 4h10M12 3V1h8M8 11h8m-7 5h6',
  beer: 'M4 7h12v14H4V7Zm12 2h3c4 0 4 8 0 8h-3M8 10v7m4-7v7M4 7c-4-5 3-8 5-4 3-4 9-1 7 4',
  wine: 'M7 2h10l1 7c1 8-13 8-12 0l1-7Zm-1 6h12m-6 7v7m-5 0h10',
  flower: 'M12 10c-7-10-10 0-4 2-8 2-3 10 3 4-2 9 9 7 5 0 9 3 10-8 2-6 5-8-5-12-6 0Zm0 5V9m0 9v5m0-2 6-2',
  leaf: 'M21 3C4 0-1 17 9 20 20 24 21 10 21 3ZM3 22 17 8M8 17v-6m0 6h6',
  baby: 'M12 5c13 0 13 17 0 17S-1 5 12 5Zm0 0c-4-5 4-5 3-1M7 12h.01M17 12h.01M8 16c2 3 6 3 8 0',
  medicine: 'M7 3c-4 0-4 6 0 6h10c4 0 4-6 0-6H7Zm5 0v6M4 13h16v9H4v-9Zm8 2v5m-3-2h6',
};
export function Icon({ name, color = c.primary, size = 22 }: { name: IconName; color?: string; size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {name === 'more' ? [5, 12, 19].map(x => <Circle key={x} cx={x} cy={12} r={1} />) : <Path d={paths[name]} />}
  </Svg>;
}

export function SwipeToDelete({ children, label, onDelete, disabled = false, onSwipeStart, onSwipeEnd }: {
  children: (action: (normal?: React.ReactNode) => React.ReactNode) => React.ReactNode; label: string; onDelete: () => void;
  disabled?: boolean; onSwipeStart?: () => void; onSwipeEnd?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const active = useSharedValue(false);
  const progress = useSharedValue(0);
  const start = useSharedValue(0);
  const reset = () => { setOpen(false); setVisible(false); progress.value = withTiming(0, { duration: 160, reduceMotion: ReduceMotion.System }); };
  const begin = () => { setVisible(true); onSwipeStart?.(); };
  const finish = (armed: boolean) => { setOpen(armed); setVisible(armed); onSwipeEnd?.(); };
  const gesture = usePanGesture({
    enabled: !disabled, activeOffsetX: [-14, 14], failOffsetY: [-12, 12],
    onActivate: () => { 'worklet'; active.value = true; cancelAnimation(progress); start.value = progress.value; runOnJS(begin)(); },
    onUpdate: event => { 'worklet'; progress.value = deleteSwipeProgress(event.translationX, start.value); },
    onDeactivate: () => {
      'worklet'; active.value = false; const armed = progress.value >= 0.45;
      progress.value = withTiming(armed ? 1 : 0, { duration: 160, reduceMotion: ReduceMotion.System }); runOnJS(finish)(armed);
    },
    onFinalize: () => { 'worklet'; if (active.value) { active.value = false; progress.value = withTiming(0, { duration: 160, reduceMotion: ReduceMotion.System }); runOnJS(finish)(false); } },
  });
  const normalStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const deleteStyle = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: 0.85 + progress.value * 0.15 }] }));
  const action = (normal?: React.ReactNode) => <View style={ui.actionSlot}>
    <Animated.View style={[StyleSheet.absoluteFill, normalStyle]} pointerEvents={open ? 'none' : 'auto'} accessibilityElementsHidden={open} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'} aria-hidden={open}>{normal}</Animated.View>
    <Animated.View style={[StyleSheet.absoluteFill, deleteStyle]} pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'} aria-hidden={!open}>
      <EditingRegion onDismiss={visible ? reset : undefined}>
        <IconButton icon="trash" filled color={c.danger} disabled={!open} label={`Delete ${label}`} onPress={() => { reset(); onDelete(); }} />
      </EditingRegion>
    </Animated.View>
  </View>;
  return <GestureDetector gesture={gesture} touchAction="pan-y"><View>{children(action)}</View></GestureDetector>;
}

export function IconButton({ icon, label, onPress, filled = false, disabled = false, color = c.primary, style }: {
  icon: IconName; label: string; onPress: () => void; filled?: boolean; disabled?: boolean; color?: string; style?: StyleProp<ViewStyle>;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [ui.iconButton, filled && { backgroundColor: color }, pressed && { opacity: 0.7 }, disabled && { opacity: 0.4 }, style]}>
    <Icon name={icon} color={filled ? c.white : color} />
  </Pressable>;
}

export function Button({ label, onPress, secondary = false, disabled = false, busy = false }: {
  label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; busy?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [ui.button, secondary && { backgroundColor: c.secondary }, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
    {busy ? <ActivityIndicator color={c.white} /> : <Text style={ui.buttonText}>{label}</Text>}
  </Pressable>;
}

export function InlineInput({ placeholder, label, onAdd, autoFocus, initial = '', submitLabel = 'Add', inputRef, onCancel, maxLength = 200, keepOpen = true, onValueChange, value: controlledValue }: {
  placeholder: string; label: string; onAdd: (value: string) => void; initial?: string; submitLabel?: string;
  autoFocus?: boolean; inputRef?: React.RefObject<InputHandle | null>; onCancel?: () => void; maxLength?: number; keepOpen?: boolean; onValueChange?: (value: string) => void; value?: string;
}) {
  const ref = useRef<InputHandle>(null);
  const [localValue, setLocalValue] = useState(initial);
  const value = controlledValue ?? localValue;
  const setValue = (value: string) => { setLocalValue(value); onValueChange?.(value); };
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  const submit = () => {
    if (!value.trim()) return;
    try { onAdd(value); setError(''); if (keepOpen) { setValue(''); (inputRef ?? ref).current?.focus(); } else Keyboard.dismiss(); }
    catch (error) { setError((error as Error).message); }
  };
  const acceptOutside = () => {
    try { if (value.trim()) onAdd(value); Keyboard.dismiss(); onCancel?.(); }
    catch (error) { setError((error as Error).message); return false; }
  };
  return <EditingRegion onDismiss={onCancel ? acceptOutside : undefined}>
    <View style={[ui.inline, focused && { borderBottomColor: c.primary }]}>
      <TextInput ref={inputRef ?? ref} accessibilityLabel={label} value={value} onChangeText={setValue}
        placeholder={placeholder} placeholderTextColor={c.muted} style={ui.input} autoFocus={autoFocus}
        returnKeyType="done" submitBehavior="submit" blurOnSubmit={false} onSubmitEditing={submit} onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)} maxLength={maxLength} autoCapitalize="sentences" selectionColor={c.primary} />
      {onCancel && !value.trim() ? <IconButton icon="close" label="Cancel adding" onPress={onCancel} />
        : <IconButton icon={value.trim() ? 'check' : 'plus'} label={submitLabel} onPress={submit} filled={Boolean(value.trim())} disabled={!value.trim()} />}
    </View>
    {Boolean(error) && <Text accessibilityRole="alert" style={ui.errorText}>{error}</Text>}
  </EditingRegion>;
}

export function Sheet({ visible, title, children, onClose }: { visible: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={ui.modalRoot}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close dialog" accessibilityRole="button" />
      <View accessibilityViewIsModal style={ui.sheet}>
        <View style={ui.grabber} />
        <View style={ui.sheetHeading}><Text accessibilityRole="header" style={ui.sheetTitle}>{title}</Text><IconButton icon="close" label="Close" onPress={onClose} /></View>
        {children}
      </View>
    </View>
  </Modal>;
}

export const ui = StyleSheet.create({
  actionSlot: { width: 44, height: 44 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  button: { minHeight: 50, backgroundColor: c.primary, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 12 },
  buttonText: { fontFamily: f.bold, fontSize: 15, color: c.white },
  inline: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.border, minHeight: 56, gap: 8 },
  input: { flex: 1, fontFamily: f.regular, fontSize: 16, color: c.text, paddingVertical: 13, minHeight: 48, paddingHorizontal: 8, ...Platform.select({ web: { outlineStyle: 'none' as never } }) },
  errorText: { color: c.danger, fontFamily: f.regular, fontSize: 12, lineHeight: 18, marginTop: 6 },
  modalRoot: { flex: 1, backgroundColor: '#0D201840', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 520, backgroundColor: c.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40, gap: 14 },
  grabber: { width: 40, height: 4, borderRadius: 4, backgroundColor: c.border, alignSelf: 'center', marginBottom: 8 },
  sheetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  sheetTitle: { flex: 1, fontFamily: f.bold, fontSize: 23, lineHeight: 30, color: c.text },
});
