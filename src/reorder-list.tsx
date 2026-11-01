import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, StyleSheet, View, type ScrollView as RNScrollView, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, GestureStateManager, ScrollView, usePanGesture, type PanGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, measure, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useFrameCallback, useSharedValue, withSpring, withTiming, ReduceMotion, type AnimatedRef, type SharedValue } from 'react-native-reanimated';
import { runOnJS, runOnUI } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { edgeVelocity, HOLD_MS, previewOrder, rowTop, sameOrder, type Heights } from './reorder';

const AnimatedScroll = Animated.createAnimatedComponent(ScrollView);
const timing = { duration: 150, reduceMotion: ReduceMotion.System };
const spring = { damping: 30, stiffness: 320, overshootClamping: true, reduceMotion: ReduceMotion.System };
type ScrollInstance = React.ComponentRef<typeof RNScrollView>;
const ReorderSurface = createContext(false);

/** A handled long press suppresses the control's release tap, without blocking
 * the ancestor drag recognizer. Short taps keep their normal behavior. */
export function useReorderTap() {
  const inRow = useContext(ReorderSurface);
  return inRow ? { onLongPress: () => {}, delayLongPress: HOLD_MS } : {};
}

export type ReorderDrop = { id: string; order: string[]; from: number; to: number };
type Props = {
  ids: string[]; renderRow: (id: string) => ReactNode; onReorder: (drop: ReorderDrop) => void;
  onDragStart: () => void; onDragEnd: () => void;
  enabled?: boolean; header?: ReactNode; footer?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollRef?: React.RefObject<ScrollInstance | null>;
  scrollY?: SharedValue<number>; simultaneousWith?: PanGesture;
};

/** A single mounted view per ID: transforms handle both the floating row and its neighbors.
 * No React updates, cloning, or persistence occur in pointer/frame callbacks.
 */
export function ReorderList({ ids, renderRow, onReorder, onDragStart, onDragEnd, enabled = true, header, footer, contentContainerStyle, scrollRef, scrollY: externalScrollY, simultaneousWith }: Props) {
  const scroll = useAnimatedRef<ScrollInstance>();
  const rows = useAnimatedRef<View>();
  const order = useSharedValue(ids);
  const original = useSharedValue(ids);
  const heights = useSharedValue<Heights>({});
  const active = useSharedValue('');
  const phase = useSharedValue<0 | 1 | 2>(0); // idle, dragging, settling
  const finger = useSharedValue(0);
  const grab = useSharedValue(0);
  const dragTop = useSharedValue(0);
  const scale = useSharedValue(1);
  const scrollY = useSharedValue(0);
  const viewport = useSharedValue({ top: 0, height: 0 });
  const contentHeight = useSharedValue(0);
  const rowsOffset = useSharedValue(0);
  const mounted = useRef(true);
  const locked = useRef(false);
  const [completion, setCompletion] = useState(0);
  const latest = useRef({ ids, onReorder, onDragStart, onDragEnd });
  latest.current = { ids, onReorder, onDragStart, onDragEnd };
  const begin = useCallback(() => {
    if (!mounted.current || locked.current) return;
    locked.current = true; latest.current.onDragStart();
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);
  const complete = useCallback((id: string, next: string[], before: string[], cancelled: boolean) => {
    if (!mounted.current || !locked.current) return;
    try {
      if (!cancelled && sameOrder(latest.current.ids, before) && !sameOrder(before, next)) {
        latest.current.onReorder({ id, order: next, from: before.indexOf(id), to: next.indexOf(id) });
      }
    } finally {
      // Retain the preview through the synchronous local commit; then reconcile with real data.
      setCompletion(value => value + 1);
    }
  }, [order, active, phase]);
  const settle = useCallback((cancelled: boolean) => {
    'worklet';
    if (phase.value !== 1) return;
    phase.value = 2;
    if (cancelled) order.value = original.value;
    const id = active.value; const next = order.value; const before = original.value;
    scale.value = withTiming(1, timing);
    dragTop.value = withSpring(rowTop(next, heights.value, id), spring, finished => {
      if (finished) runOnJS(complete)(id, next, before, cancelled);
    });
  }, [phase, order, original, active, scale, dragTop, heights, complete]);
  const signature = JSON.stringify(ids);
  useLayoutEffect(() => {
    if (!completion || !locked.current) return;
    order.value = ids;
    active.value = ''; phase.value = 0;
    locked.current = false; latest.current.onDragEnd();
  }, [completion]);
  useLayoutEffect(() => {
    if (phase.value === 1) runOnUI(settle)(true);
    else if (phase.value === 0) order.value = ids;
  }, [signature, enabled]);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') runOnUI(settle)(true);
    });
    return () => {
      mounted.current = false; subscription.remove();
      cancelAnimation(dragTop); phase.value = 0; active.value = '';
      if (locked.current) { locked.current = false; latest.current.onDragEnd(); }
    };
  }, [settle, dragTop, phase, active]);
  const onScroll = useAnimatedScrollHandler(event => {
    scrollY.value = event.contentOffset.y;
    if (externalScrollY) externalScrollY.value = event.contentOffset.y;
  });
  useFrameCallback(frame => {
    if (phase.value !== 1) return;
    const { top, height } = viewport.value;
    const velocity = edgeVelocity(finger.value, top, height);
    const next = Math.max(0, Math.min(Math.max(0, contentHeight.value - height), scrollY.value + velocity * Math.min(frame.timeSincePreviousFrame ?? 16, 32) / 1000));
    if (next !== scrollY.value) { scrollTo(scroll, 0, next, false); scrollY.value = next; }
    dragTop.value = finger.value - top + scrollY.value - rowsOffset.value - grab.value;
    const preview = previewOrder(order.value, heights.value, active.value, dragTop.value);
    if (!sameOrder(preview, order.value)) order.value = preview;
  });
  const containerStyle = useAnimatedStyle(() => ({ height: order.value.reduce((sum, id) => sum + (heights.value[id] ?? 64), 0), zIndex: active.value ? 1 : 0 }));
  const context = { order, original, heights, active, phase, finger, grab, dragTop, scale, scrollY, viewport, rowsOffset, scroll, rows, begin, settle };
  return <AnimatedScroll ref={(instance: ScrollInstance | null) => { scroll(instance); if (scrollRef) scrollRef.current = instance; }} style={styles.flex}
    simultaneousWith={simultaneousWith} disallowInterruption={false} bounces={false} removeClippedSubviews={false}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" scrollEventThrottle={16} onScroll={onScroll}
    onLayout={() => { if (phase.value === 1) runOnUI(settle)(true); }}
    contentContainerStyle={contentContainerStyle} onContentSizeChange={(_, height) => { contentHeight.value = height; }}>
    {header}
    <Animated.View ref={rows} style={containerStyle} collapsable={false}>
      {ids.map(id => <ReorderRow key={id} id={id} enabled={enabled} context={context}>{renderRow(id)}</ReorderRow>)}
    </Animated.View>
    {footer}
  </AnimatedScroll>;
}

type RowContext = {
  order: SharedValue<string[]>; original: SharedValue<string[]>; heights: SharedValue<Heights>;
  active: SharedValue<string>; phase: SharedValue<0 | 1 | 2>; finger: SharedValue<number>; grab: SharedValue<number>;
  dragTop: SharedValue<number>; scale: SharedValue<number>; scrollY: SharedValue<number>;
  viewport: SharedValue<{ top: number; height: number }>; rowsOffset: SharedValue<number>;
  scroll: AnimatedRef<ScrollInstance>; rows: AnimatedRef<View>; begin: () => void; settle: (cancelled: boolean) => void;
};
function ReorderRow({ id, children, enabled, context }: { id: string; children: ReactNode; enabled: boolean; context: RowContext }) {
  const { order, original, heights, active, phase, finger, grab, dragTop, scale, scrollY, viewport, rowsOffset, scroll, rows, begin, settle } = context;
  const y = useSharedValue(0);
  useAnimatedReaction(() => ({ top: rowTop(order.value, heights.value, id), phase: phase.value }), (value, previous) => {
    if (value.top !== previous?.top || value.phase !== previous?.phase) y.value = value.phase ? withTiming(value.top, timing) : value.top;
  });
  const gesture = usePanGesture({
    enabled, activateAfterLongPress: HOLD_MS, failOffsetX: [-12, 12], failOffsetY: [-12, 12], maxPointers: 1,
    cancelsJSResponder: true, cancelsTouchesInView: true,
    onTouchesDown: event => {
      'worklet';
      if (phase.value !== 0) {
        if (active.value === id) settle(true);
        GestureStateManager.fail(event.handlerTag); return;
      }
    },
    onActivate: event => {
      'worklet';
      const bounds = measure(scroll); const list = measure(rows);
      if (!bounds || !list || phase.value !== 0 || order.value.some(key => !heights.value[key])) { GestureStateManager.fail(event.handlerTag); return; }
      viewport.value = { top: bounds.pageY, height: bounds.height };
      rowsOffset.value = list.pageY - bounds.pageY + scrollY.value;
      original.value = order.value; active.value = id; phase.value = 1;
      dragTop.value = rowTop(order.value, heights.value, id);
      grab.value = event.absoluteY - list.pageY - dragTop.value;
      finger.value = event.absoluteY; scale.value = withTiming(1.03, timing);
      runOnJS(begin)();
    },
    onUpdate: event => {
      'worklet';
      if (active.value !== id || phase.value !== 1) return;
      finger.value = event.absoluteY;
      dragTop.value = event.absoluteY - viewport.value.top + scrollY.value - rowsOffset.value - grab.value;
    },
    onDeactivate: event => { 'worklet'; if (active.value === id) settle(event.canceled); },
    onFinalize: event => { 'worklet'; if (active.value === id && phase.value === 1) settle(true); },
  });
  const style = useAnimatedStyle(() => {
    const lifted = active.value === id;
    return { transform: [{ translateY: lifted ? dragTop.value : y.value }, { scale: lifted ? scale.value : 1 }],
      zIndex: lifted ? 100 : 0, elevation: lifted ? 12 : 0,
      shadowOpacity: lifted ? 0.15 * Math.max(0, (scale.value - 1) / 0.03) : 0 };
  });
  return <ReorderSurface.Provider value={enabled}><GestureDetector gesture={gesture} touchAction="pan-y">
    <Animated.View pointerEvents="auto" style={[styles.row, style]} collapsable={false} onLayout={event => {
      const height = event.nativeEvent.layout.height;
      if (height > 0 && heights.value[id] !== height) {
        if (phase.value === 1) runOnUI(settle)(true);
        heights.value = { ...heights.value, [id]: height };
      }
    }}>{children}</Animated.View>
  </GestureDetector></ReorderSurface.Provider>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { position: 'absolute', top: 0, left: 0, right: 0, shadowColor: '#000', shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
});
