// Page-level back gestures and the drag-aware list scroll view.
import { useContext, useEffect, useRef } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';
import { GestureStateManager, ScrollView as GestureScrollView, usePanGesture } from 'react-native-gesture-handler';
import { DraxView } from 'react-native-drax';
import { Easing, ReduceMotion, useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { useFinishEditing } from './ui';
import { backSwipeDirection, swipeAxis, shouldStartListPull } from './interaction';
import { s } from './styles';
import { DRAG_DELAY, ItemDragContext } from './drag';

export function usePageBack(back: () => void, enabled: boolean) {
  const dimensions = useWindowDimensions();
  const finishEditing = useFinishEditing();
  const width = Math.min(dimensions.width, 520);
  const height = dimensions.height;
  const x = useSharedValue(0); const y = useSharedValue(0);
  const closing = useSharedValue(false); const axis = useSharedValue(1);
  const scrollY = useSharedValue(0);
  const pullStart = useSharedValue({ x: 0, y: 0, time: 0, atTop: false });
  const bodyActive = useSharedValue(false);
  const headerActive = useSharedValue(false); const edgeActive = useSharedValue(false);
  const reset = () => { 'worklet'; if (!closing.value) { x.value = withTiming(0, { duration: 150, reduceMotion: ReduceMotion.System }); y.value = withTiming(0, { duration: 150, reduceMotion: ReduceMotion.System }); } };
  const exit = (direction: 'left' | 'right' | 'down') => {
    'worklet';
    if (closing.value) return;
    closing.value = true;
    const complete = (finished?: boolean) => { 'worklet'; if (finished) runOnJS(back)(); };
    if (direction === 'down') y.value = withTiming(height, { duration: 340, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }, complete);
    else x.value = withTiming(direction === 'left' ? -width : width, { duration: 340, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }, complete);
  };
  const header = usePanGesture({
    enabled, minDistance: 10, maxPointers: 1,
    onActivate: event => { 'worklet'; headerActive.value = true; axis.value = 0; },
    onUpdate: event => { 'worklet'; if (closing.value) return; if (axis.value === 0) axis.value = swipeAxis(event.translationX, event.translationY); if (axis.value === 0) return; if (axis.value === 1) x.value = event.translationX; else y.value = Math.max(0, event.translationY); },
    onDeactivate: event => { 'worklet'; headerActive.value = false; const direction = backSwipeDirection(axis.value === 1 ? event.translationX : 0, axis.value === 2 ? event.translationY : 0, event.velocityX, event.velocityY); if (direction) exit(direction); else reset(); },
    onFinalize: () => { 'worklet'; if (headerActive.value) { headerActive.value = false; reset(); } },
  });
  const edge = usePanGesture({
    enabled, hitSlop: { left: 0, width: 36 }, activeOffsetX: 8, failOffsetX: -8, failOffsetY: [-32, 32], maxPointers: 1,
    onActivate: () => { 'worklet'; edgeActive.value = true; },
    onUpdate: event => { 'worklet'; if (!closing.value) x.value = Math.max(0, event.translationX); },
    onDeactivate: event => { 'worklet'; edgeActive.value = false; if (backSwipeDirection(event.translationX, 0, event.velocityX, 0) === 'right') exit('right'); else reset(); },
    onFinalize: () => { 'worklet'; if (edgeActive.value) { edgeActive.value = false; reset(); } },
  });
  const body = usePanGesture({
    enabled, manualActivation: true, maxPointers: 1,
    onTouchesDown: event => {
      'worklet'; const touch = event.allTouches[0];
      if (touch) pullStart.value = { x: touch.absoluteX, y: touch.absoluteY, time: Date.now(), atTop: scrollY.value <= 1 };
    },
    onTouchesMove: event => {
      'worklet'; if (bodyActive.value) return;
      const touch = event.allTouches[0]; if (!touch) return;
      const start = pullStart.value; const dx = touch.absoluteX - start.x; const dy = touch.absoluteY - start.y;
      if (!start.atTop || Date.now() - start.time >= DRAG_DELAY || dy < -8 || Math.abs(dx) > 18) GestureStateManager.fail(event.handlerTag);
      else if (shouldStartListPull(dx, dy, scrollY.value)) GestureStateManager.activate(event.handlerTag);
    },
    onActivate: () => { 'worklet'; bodyActive.value = true; },
    onUpdate: event => { 'worklet'; if (!closing.value) y.value = Math.max(0, event.absoluteY - pullStart.value.y); },
    onDeactivate: event => { 'worklet'; bodyActive.value = false; if (event.absoluteY - pullStart.value.y >= 140) exit('down'); else reset(); },
    onFinalize: () => { 'worklet'; if (bodyActive.value) { bodyActive.value = false; reset(); } },
  });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));
  return { header, edge, body, scrollY, style, close: () => { if (finishEditing()) exit('left'); } };
}
export function ShopScroll({ page, children, horizontalPadding = 20 }: { page: ReturnType<typeof usePageBack>; children: React.ReactNode; horizontalPadding?: number }) {
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const offset = useSharedValue({ x: 0, y: 0 });
  const size = useRef({ viewport: 0, content: 0, y: 0 });
  const autoDirection = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const list = useContext(ItemDragContext);
  const dragging = list?.dragging ?? false;
  const stop = () => { clearInterval(autoTimer.current); autoTimer.current = undefined; autoDirection.current = 0; };
  useEffect(() => { if (!dragging) stop(); return stop; }, [dragging]);
  return <DraxView isParent style={s.flex} scrollPosition={offset} draggable={false} receptive={false} onMeasure={list?.measureViewport}
    onMonitorDragExit={stop} onMonitorDragEnd={stop} onMonitorDragDrop={stop}
    onMonitorDragOver={event => {
      if (!dragging) return;
      autoDirection.current = event.monitorOffsetRatio.y < 0.1 ? -1 : event.monitorOffsetRatio.y > 0.9 ? 1 : 0;
      if (!autoTimer.current) autoTimer.current = setInterval(() => {
        const next = Math.max(0, Math.min(size.current.content - size.current.viewport, size.current.y + autoDirection.current * 12));
        if (next !== size.current.y) ref.current?.scrollTo({ y: next, animated: false });
      }, 32);
    }}>
    <GestureScrollView ref={ref} simultaneousWith={page.body} disallowInterruption={false} style={s.flex}
      contentContainerStyle={[s.listContent, { paddingHorizontal: horizontalPadding }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" bounces={false}
      scrollEnabled={!dragging} scrollEventThrottle={16} onLayout={event => { size.current.viewport = event.nativeEvent.layout.height; }}
      onContentSizeChange={(_, height) => { size.current.content = height; }}
      onScroll={event => { const y = event.nativeEvent.contentOffset.y; size.current.y = y; offset.value = { x: 0, y }; page.scrollY.value = y; }}>
      {children}
    </GestureScrollView>
  </DraxView>;
}
