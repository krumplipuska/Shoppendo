import { createContext, memo, useContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, BackHandler, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureDetector, GestureHandlerRootView, GestureStateManager, ScrollView as GestureScrollView, usePanGesture } from 'react-native-gesture-handler';
import { DraxProvider, DraxView, DraxHandle, DraxScrollView, DraxSnapbackTargetPreset, type DraxRenderHoverContentProps, type DraxViewMeasurements, type DraxDragEventData, type DraxDragWithReceiverEventData } from 'react-native-drax';
import Animated, { FadeIn, FadeInUp, FadeInDown, FadeOut, FadeOutDown, ZoomIn, SlideInDown, Easing, ReduceMotion, useSharedValue, useAnimatedStyle, cancelAnimation, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { actions, errorMessage, getShopSnapshot, load, useShops, UNDO_MS } from './src/store';
import { activeItems, doneItems, missingItems, formatCode, GROUP_ICONS, itemSuggestions, itemDropSlot, listItems, orderedGroups, mergeCategoryOrder, storeInitials, type GroupIcon, type Item, type Shop } from './src/model';
import { Button, Icon, IconButton, EditingRegion, EditingSurface, useFinishEditing, InlineInput, Sheet, SwipeToDelete, FloatingAddButton, FloatingUndoButton, ui } from './src/ui';
import { colors as c, fonts as f, entityTone } from './src/theme';

import { runOnJS } from 'react-native-worklets';
import { backSwipeDirection, swipeAxis, dragSession, insertionSide, itemDragLayout, dragSlotTop, dragOrder, shouldStartListPull } from './src/interaction';
import { shopLink, shopCodeFromLink } from './src/links';

// The native launch screen is static, so it stays up only until an identical JS copy
// (<AnimatedSplash />) is on screen. The copy then animates and fades out once the app is ready.
void SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 0, fade: false });
const SPLASH_MIN_MS = 1500;
const SPLASH_SIZE = 140; // must match imageWidth of the expo-splash-screen plugin in app.json
let appReady = false;
let onAppReady: (() => void) | null = null;
function markAppReady() {
  if (appReady) return;
  appReady = true;
  onAppReady?.();
}
// Never leave the user stuck on the splash if loading hangs.
setTimeout(markAppReady, 8000);

function AnimatedSplash() {
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
    <Animated.Image accessibilityLabel="Shoppendo" source={require('./assets/shoppendo-splash.png')} resizeMode="contain"
      onLoad={start} style={[{ width: SPLASH_SIZE, height: SPLASH_SIZE }, iconStyle]} />
  </Animated.View>;
}

type Drag = { kind: 'item' | 'group' | 'store'; id: string; shopId: string };
function accepts(payload: unknown, shopId: string, kind?: Drag['kind']): payload is Drag {
  const drag = payload as Drag | null;
  return Boolean(drag && drag.shopId === shopId && typeof drag.id === 'string' && (kind ? drag.kind === kind : ['item', 'group', 'store'].includes(drag.kind)));
}
function dragFeedback() {
  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
const DRAG_DELAY = 320;
const fadeIn = FadeIn.duration(150).reduceMotion(ReduceMotion.System);
const fadeOut = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

function useHoldDrag() {
  const held = useRef(false);
  const [active, setActive] = useState(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(releaseTimer.current), []);
  const suppress = () => {
    held.current = true; clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => { held.current = false; }, 1500);
  };
  const start = () => { clearTimeout(releaseTimer.current); held.current = true; setActive(true); dragFeedback(); };
  const stop = () => { setActive(false); clearTimeout(releaseTimer.current); releaseTimer.current = setTimeout(() => { held.current = false; }, 100); };
  const list = useContext(ItemDragContext);
  useEffect(() => { if (active && !list?.dragging) stop(); }, [active, list?.dragging]);
  return { held, active, start, stop, suppress };
}

function ShopScroll({ page, children, horizontalPadding = 20 }: { page: ReturnType<typeof usePageBack>; children: React.ReactNode; horizontalPadding?: number }) {
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
const ItemEditorContext = createContext<(id: string) => void>(() => {});
// Rows rendered with a list's first frame skip their entry animation, so opening a store doesn't
// start one layout animation per row on top of the page slide. Rows added later still animate.
const EntryAnimation = createContext<{ current: boolean }>({ current: true });
function useEntryGate() {
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);
  return mounted;
}

type ItemPreview = { source: string; target: string; after: boolean };
const ItemDragContext = createContext<ReturnType<typeof useListDrag> | null>(null);

const STORE_GAP = 12;
const CATEGORY_GAP = 8;
const ITEM_PANEL_BORDER = 1;
const DEBUG_DRAG = false;
function trace(session: number, phase: string, details?: unknown) {
  if (__DEV__ && DEBUG_DRAG) console.debug('[drag]', session, phase, details);
}
function hoverSize(dimensions?: { width: number; height: number }) {
  return dimensions && [dimensions.width, dimensions.height].every(n => Number.isFinite(n) && n > 0)
    ? { width: dimensions.width, minHeight: dimensions.height } : undefined;
}

function hoverFrame({ dimensions, viewState }: DraxRenderHoverContentProps) {
  const grab = viewState?.grabOffset;
  return { ...hoverSize(dimensions), transformOrigin: grab ? `${grab.x}px ${grab.y}px` : 'center' };
}

function useListDrag(ids: string[], commit: (preview: ItemPreview) => void, sort = 'manual', gap = 0) {
  const sessions = useRef(dragSession()).current;
  // These viewport views have no Drax parent, so their bounds are provider-relative.
  const viewport = useRef<DraxViewMeasurements | undefined>(undefined);
  const measureViewport = useCallback((bounds: DraxViewMeasurements | undefined) => { viewport.current = bounds; }, []);
  const active = useRef<{ token: number; source: Drag; draxId: string; height: number } | null>(null);
  const [preview, setPreview] = useState<ItemPreview | null>(null);
  const latest = useRef({ ids, commit }); latest.current = { ids, commit };
  const clear = (commit?: () => void) => {
    const session = active.current;
    if (!session || !sessions.finish(session.token, commit)) return;
    active.current = null;
    setPreview(null);
    trace(session.token, 'cleanup');
  };
  useLayoutEffect(() => {
    if (active.current && (!ids.includes(active.current.source.id) || preview && !ids.includes(preview.target))) clear();
  }, [ids, preview]);
  useEffect(() => () => { if (active.current) sessions.finish(active.current.token); active.current = null; }, []);
  const resolve = (event: DraxDragWithReceiverEventData, drop: boolean) => {
    const session = active.current;
    const target = event.receiver.payload;
    if (!session || event.dragged.id !== session.draxId || !accepts(target, session.source.shopId, session.source.kind)) return null;
    const receiver = event.receiver.measurements, source = event.dragged.measurements;
    if (!receiver || !source || !latest.current.ids.includes(target.id) || !latest.current.ids.includes(session.source.id)) return null;
    const bounds = viewport.current;
    if (!bounds || insertionSide({ x: event.dragAbsolutePosition.x - bounds.x, y: event.dragAbsolutePosition.y - bounds.y }, bounds, source, drop) === null) return null;
    const side = insertionSide(event.receiver.receiveOffset, receiver, source, drop);
    const tail = 'tail' in target && target.tail === true;
    if (side === null || tail && latest.current.ids.at(-1) !== target.id) return null;
    return { source: session.source.id, target: target.id, after: tail || side };
  };
  const selection = useRef('');
  const report = useRef(0);
  useLayoutEffect(() => {
    if (report.current) { trace(report.current, 'resulting order', ids); report.current = 0; }
  });
  const handlers = {
    start: (id: string, event: DraxDragEventData) => {
      const token = sessions.start();
      active.current = { token, source: event.dragged.payload as Drag, draxId: event.dragged.id, height: hoverSize(event.dragged.measurements)?.minHeight ?? 0 };
      selection.current = '';
      setPreview({ source: id, target: id, after: false });
      trace(token, 'start', { id, draxId: event.dragged.id, bounds: event.dragged.measurements, sort, pending: false });
      return token;
    },
    over: (event: DraxDragWithReceiverEventData) => {
      const session = active.current;
      if (!session || event.dragged.id !== session.draxId) return;
      const next = resolve(event, false);
      const key = next ? event.receiver.id + String(next.after) : '';
      if (selection.current === key) return;
      selection.current = key;
      setPreview(next ?? { source: session.source.id, target: session.source.id, after: false });
      trace(active.current?.token ?? 0, 'receiver', { next, id: event.receiver.id, bounds: event.receiver.measurements, hover: event.dragged.hoverPosition });
    },
    exit: (event: DraxDragWithReceiverEventData) => {
      if (event.dragged.id !== active.current?.draxId) return;
      selection.current = ''; setPreview(previous => previous && { ...previous, target: previous.source }); trace(active.current.token, 'exit', event.receiver.id);
    },
    release: (token: number, event: DraxDragEventData, cancelled: boolean) => {
      if (token !== active.current?.token || event.dragged.id !== active.current.draxId) return DraxSnapbackTargetPreset.None;
      const drop = 'receiver' in event ? event as DraxDragWithReceiverEventData : undefined;
      const chosen = drop && !cancelled ? resolve(drop, true) : null;
      trace(token, drop ? 'drop' : 'end', { cancelled, chosen, receiver: drop?.receiver.id, pending: false });
      // Drop offsets use the hover's top-left. Subtracting the receiver offset
      // gives its current provider-relative origin, including the scroll offset.
      let landing: { x: number; y: number } | DraxSnapbackTargetPreset = DraxSnapbackTargetPreset.Default;
      if (chosen && drop?.receiver.measurements) {
        const height = active.current.height;
        const top = event.dragAbsolutePosition.y - drop.receiver.receiveOffset.y;
        const receiver = drop.receiver.payload;
        const tail = typeof receiver === 'object' && receiver !== null && 'tail' in receiver && receiver.tail === true;
        const inset = tail && active.current.source.kind === 'item' ? ITEM_PANEL_BORDER : 0;
        landing = {
          x: event.dragAbsolutePosition.x - drop.receiver.receiveOffset.x + inset,
          y: tail ? top - height - inset : dragSlotTop(latest.current.ids, { ...chosen, height: height + gap }, top, drop.receiver.measurements.height + gap),
        };
      }
      clear(chosen && chosen.source !== chosen.target ? () => {
        trace(token, 'commit attempt', chosen);
        if (__DEV__ && DEBUG_DRAG) report.current = token;
        latest.current.commit(chosen);
      } : undefined);
      return landing;
    },
  };
  // Rows read this through context: keep the callbacks and the value stable so a drag preview
  // change is the only thing that re-renders them.
  const latestHandlers = useRef(handlers); latestHandlers.current = handlers;
  const stable = useState(() => ({
    start: (id: string, event: DraxDragEventData) => latestHandlers.current.start(id, event),
    over: (event: DraxDragWithReceiverEventData) => latestHandlers.current.over(event),
    exit: (event: DraxDragWithReceiverEventData) => latestHandlers.current.exit(event),
    release: (token: number, event: DraxDragEventData, cancelled: boolean) => latestHandlers.current.release(token, event, cancelled),
  }))[0];
  return useMemo(() => {
    const shifts = preview && active.current ? itemDragLayout(ids, { ...preview, height: active.current.height + gap }).shifts : {};
    return { shifts, measureViewport, dragging: preview !== null, ...stable };
  }, [preview, ids, gap, measureViewport, stable]);
}

// Shift only the visible contents. The registered receiver stays at its
// measured position so the animated gap cannot move its own midpoint.
function useRowMotion(id: string, scaleLift = true) {
  const list = useContext(ItemDragContext);
  const shift = list?.shifts[id] ?? 0;
  const dragging = list?.dragging ?? false;
  const lift = useSharedValue(0);
  const motion = useAnimatedStyle(() => ({
    transform: [{ translateY: dragging ? withTiming(shift, { duration: 180, reduceMotion: ReduceMotion.System }) : 0 }],
  }));
  const hover = useAnimatedStyle(() => ({
    transform: [{ scale: scaleLift ? 1 + 0.02 * lift.value : 1 }],
    shadowOpacity: 0.14 * lift.value,
    elevation: 5 * lift.value,
  }));
  const setLift = (raised: boolean) => {
    lift.value = withTiming(raised ? 1 : 0, { duration: raised ? 130 : 200, reduceMotion: ReduceMotion.System });
  };
  return { motion, hover, setLift };
}

function ListTail({ shopId, kind, last }: { shopId: string; kind: Drag['kind']; last?: string }) {
  const preview = useContext(ItemDragContext);
  if (!last) return null;
  return <DraxView draggable={false} style={{ height: 28 }} receiverPayload={{ kind, shopId, id: last, tail: true }}
    acceptsDrag={payload => accepts(payload, shopId, kind)}
    onReceiveDragEnter={preview?.over} onReceiveDragOver={preview?.over} onReceiveDragExit={preview?.exit} />;
}

type GroupInfo = { groups: Shop['groups']; order: string[] };
function CategoryBadge({ groups, order, id }: GroupInfo & { id: string }) {
  const tone = entityTone(id, order);
  return <View style={[s.itemCategoryCapsule, { backgroundColor: tone.soft }]}>
    <Icon name={groups[id]?.icon ?? 'bag'} color={tone.color} size={16} />
    <Text numberOfLines={1} ellipsizeMode="tail" style={[s.itemCategoryName, { color: tone.color }]}>{groups[id]?.name ?? 'Unknown'}</Text>
  </View>;
}

function ItemDragPreview({ groups, order, item }: GroupInfo & { item: Item }) {
  return <View style={s.item}>
    <View style={[StyleSheet.absoluteFill, s.item]}><View style={s.checkboxTarget}><View style={s.checkbox} /></View></View>
    <View style={s.itemTextOverlay}><View style={s.itemNameTarget}><Text style={s.itemName}>{item.name}</Text></View>
      <View style={[s.itemCategoryAction, { justifyContent: 'center' }]}><CategoryBadge groups={groups} order={order} id={item.groupId} /></View>
    </View>
    <View style={s.itemDivider} />
  </View>;
}

function ItemCategory({ groups, order, groupId }: GroupInfo & { groupId: string }) {
  const [shown, setShown] = useState(groupId);
  const angle = useSharedValue(0);
  useEffect(() => {
    if (groupId === shown) { angle.value = 0; return; }
    const reveal = () => {
      setShown(groupId); angle.value = -90;
      requestAnimationFrame(() => { angle.value = withTiming(0, { duration: 120, reduceMotion: ReduceMotion.System }); });
    };
    const timer = setTimeout(() => {
      angle.value = withTiming(90, { duration: 120, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(reveal)(); });
    }, 400);
    return () => { clearTimeout(timer); cancelAnimation(angle); };
  }, [groupId]);
  const flip = useAnimatedStyle(() => ({ transform: [{ perspective: 400 }, { rotateY: `${angle.value}deg` }] }));
  return <Animated.View style={[{ backfaceVisibility: 'hidden' }, flip]}><CategoryBadge groups={groups} order={order} id={shown} /></Animated.View>;
}

// Memoized: rows receive only stable or per-item props, so editing one item re-renders one row.
const ItemRow = memo(function ItemRow({ shopId, groups, order, id, item, toggle, showCategory = false, manualOrder = true }: GroupInfo & {
  shopId: string; id: string; item: Item; toggle: (id: string) => void; showCategory?: boolean; manualOrder?: boolean;
}) {
  const editItem = useContext(ItemEditorContext);
  const animateEntry = useContext(EntryAnimation).current;
  const preview = useContext(ItemDragContext);
  const token = useRef(0);
  const { motion, hover, setLift } = useRowMotion(id, false);
  const drag = useHoldDrag();
  const missingAction = {
    icon: item.missing ? 'undo' as const : 'missing' as const,
    label: item.missing ? `Return ${item.name} to shopping list` : `Mark ${item.name} as missing`,
    onPress: () => actions.setItemMissing(shopId, id, !item.missing),
  };
  const move = (direction: number) => {
    const shop = getShopSnapshot().data.shops.find(entry => entry.id === shopId);
    if (!shop || !manualOrder || item.missing || item.done) return;
    const ids = activeItems(shop, item.groupId).map(([key]) => key);
    const index = ids.indexOf(id); const to = index + direction;
    if (to < 0 || to >= ids.length) return;
    ids.splice(index, 1); ids.splice(to, 0, id);
    actions.moveItem(shopId, id, item.groupId, ids[to + 1] ?? null);
  };
  // Reanimated custom entry cleanup on web pins rows to their initial absolute position.
  return <Animated.View entering={Platform.OS === 'web' || !animateEntry ? undefined : FadeInUp.duration(420).withInitialValues({ opacity: 0, transform: [{ translateY: -56 }] }).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System)} exiting={item.done ? FadeOutDown.duration(220).reduceMotion(ReduceMotion.System) : fadeOut} collapsable={false}>
    <DraxView dragHandle snapDelay={0} snapDuration={200} draggable={!item.done && !item.missing && manualOrder} receptive={!item.done && !item.missing && manualOrder} longPressDelay={DRAG_DELAY} dragActivationFailOffset={12}
      renderHoverContent={props => <Animated.View pointerEvents="none" style={[s.dragging, hoverFrame(props), hover]}><ItemDragPreview groups={groups} order={order} item={item} /></Animated.View>}
      payload={{ kind: 'item', id, shopId } satisfies Drag}
      acceptsDrag={payload => accepts(payload, shopId, 'item') && payload.id !== id}
      onDragStart={event => { drag.start(); setLift(true); token.current = preview?.start(id, event) ?? 0; }}
      onDragEnd={event => { drag.stop(); setLift(false); return preview?.release(token.current, event, event.cancelled); }}
      onDragDrop={event => { drag.stop(); setLift(false); return preview?.release(token.current, event, false); }} onSnapEnd={() => trace(token.current, 'snap complete')}
      onReceiveDragEnter={preview?.over} onReceiveDragOver={preview?.over} onReceiveDragExit={preview?.exit}
      style={s.itemDrop} draggingStyle={s.itemDragOrigin} dragReleasedStyle={s.itemDragOrigin}
     >
      <Animated.View style={motion}><SwipeToDelete extraAction={missingAction} label={item.name} onDelete={() => actions.deleteItem(shopId, id)} disabled={drag.active} onSwipeStart={drag.suppress} onSwipeEnd={drag.stop}>{action =>
        <View style={[s.item, item.missing && s.missingRow]}>
          <DraxHandle style={StyleSheet.absoluteFill}><View style={s.item} pointerEvents="box-none">
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.name}, ${item.done ? 'picked up' : 'to get'}`} accessibilityState={{ checked: item.done }}
            onPress={() => { if (!drag.held.current) toggle(id); }} onLongPress={() => {}} delayLongPress={DRAG_DELAY} style={[s.checkboxTarget, { position: 'absolute', left: 0, top: 0, bottom: 0 }]}>
            <View style={[s.checkbox, item.done && s.checked]}>{item.done && <Animated.View entering={ZoomIn.duration(160).reduceMotion(ReduceMotion.System)}><Icon name="check" size={15} color={c.white} /></Animated.View>}</View>
          </Pressable>
          <View pointerEvents="box-none" style={s.itemTextOverlay}>
          <Pressable style={s.itemNameTarget} accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`}
            accessibilityHint={item.done ? 'Tap to edit. Swipe left to delete.' : manualOrder ? 'Tap to edit. Hold anywhere to drag. Swipe left to delete.' : 'Tap to edit. Choose By group in the shop menu to drag items.'}
            accessibilityActions={[{ name: 'missing', label: missingAction.label }, { name: 'delete', label: 'Delete item' }, { name: 'increment', label: 'Move item later' }, { name: 'decrement', label: 'Move item earlier' }]}
            onAccessibilityAction={event => { const name = event.nativeEvent.actionName; if (name === 'missing') missingAction.onPress(); else if (name === 'delete') actions.deleteItem(shopId, id); else move(name === 'increment' ? 1 : -1); }}
            onKeyDown={event => { const key = event.nativeEvent as unknown as { altKey?: boolean; key?: string }; if (key.altKey && ['ArrowUp', 'ArrowDown'].includes(key.key ?? '')) { event.preventDefault(); move(key.key === 'ArrowUp' ? -1 : 1); } }}
            onPress={() => { if (!drag.held.current) editItem(id); }} onLongPress={() => {}} delayLongPress={DRAG_DELAY}>
            <Text style={[s.itemName, item.done && s.doneName]}>{item.name}</Text>
          </Pressable>
          {action(showCategory && <Pressable accessibilityRole="button" accessibilityLabel={`Change category for ${item.name}`}
            accessibilityHint={`Current category: ${groups[item.groupId]?.name ?? 'Unknown'}`} style={{ minHeight: 60, justifyContent: 'center' }}
            onPress={() => { if (!drag.held.current) editItem(id); }} onLongPress={() => {}} delayLongPress={DRAG_DELAY}>
            <ItemCategory groups={groups} order={order} groupId={item.groupId} />
          </Pressable>, s.itemCategoryAction)}
          </View>
          </View></DraxHandle>
          {!item.missing && !item.done && <View pointerEvents="none" style={s.itemDivider} />}
        </View>}
      </SwipeToDelete></Animated.View>
    </DraxView>
  </Animated.View>;
});

function AddStore({ open, close }: { open: (id: string) => void; close: () => void }) {
  const [mode, setMode] = useState<'new' | 'join'>('new');
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const focusInput = useCallback(() => { requestAnimationFrame(() => input.current?.focus()); }, []);
  const scrollY = useRef(0);
  const [storeName, setStoreName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const create = () => {
    try { const id = actions.addShop(storeName); Keyboard.dismiss(); close(); open(id); }
    catch (error) { setError(errorMessage(error)); }
  };
  async function join() {
    setJoining(true); setError('');
    try { const id = await actions.join(joinId); Keyboard.dismiss(); close(); open(id); }
    catch (error) { setError(errorMessage(error)); }
    finally { setJoining(false); }
  }
  return <Sheet visible compact title="Add store" canSwipeDown={() => scrollY.current <= 1} onShow={focusInput} onClose={() => { Keyboard.dismiss(); close(); }}>
    <EditingRegion style={{ flexShrink: 1 }}><ScrollView style={{ maxHeight: 260, flexShrink: 1 }} keyboardShouldPersistTaps="handled" bounces={false}
      onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} contentContainerStyle={s.addStoreForm}>
    <View style={s.addModes}>
      {(['new', 'join'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={value === 'new' ? 'New store' : 'Join by ID'}
        disabled={joining} accessibilityState={{ selected: mode === value }} onPress={() => { setMode(value); setError(''); focusInput(); }} style={[s.addMode, mode === value && s.addModeSelected]}>
        <Icon name={value === 'new' ? 'bag' : 'share'} size={20} /><Text style={s.link}>{value === 'new' ? 'New store' : 'Join by ID'}</Text>
      </Pressable>)}
    </View>
    <Text style={s.caption}>{mode === 'new' ? 'Give this store its own picking order.' : 'Enter the ID shared with you.'}</Text>
    <View style={{ gap: 4 }}>
      <Text style={s.fieldLabel}>{mode === 'new' ? 'Store name' : 'Store ID'}</Text>
      <TextInput ref={input} accessibilityLabel={mode === 'new' ? 'Store name' : 'Store ID'} placeholder={mode === 'new' ? 'Store name' : 'Store ID'}
        placeholderTextColor={c.muted} value={mode === 'new' ? storeName : joinId} onChangeText={mode === 'new' ? setStoreName : setJoinId}
        style={[ui.input, s.editStoreInput, { borderColor: c.primary }]} autoCapitalize={mode === 'new' ? 'words' : 'characters'}
        autoCorrect={mode === 'new'} maxLength={mode === 'new' ? 80 : 40} returnKeyType="done"
        onSubmitEditing={() => { if (mode === 'new') { if (storeName.trim()) create(); } else if (joinId.trim() && !joining) void join(); }} />
    </View>
    <Button label={mode === 'new' ? 'Create store' : 'Join store'} busy={joining}
      disabled={!(mode === 'new' ? storeName : joinId).trim()} onPress={mode === 'new' ? create : join} />
    {Boolean(error) && <Text accessibilityRole="alert" style={ui.errorText}>{error}</Text>}
  </ScrollView></EditingRegion></Sheet>;
}

// Memoized: the store list stays mounted behind an open store, so it must not re-render every row on each edit.
const StoreRow = memo(function StoreRow({ shop, open, share }: { shop: Shop; open: (id: string) => void; share: (id: string) => void }) {
  const animateEntry = useContext(EntryAnimation).current;
  const drag = useHoldDrag();
  const preview = useContext(ItemDragContext);
  const token = useRef(0);
  const { motion, hover, setLift } = useRowMotion(shop.id);
  const count = Object.values(shop.items).filter(item => !item.deleted && !item.done && !item.missing && shop.groups[item.groupId] && !shop.groups[item.groupId].deleted).length;
  const details = <Text style={s.caption}>{count} {count === 1 ? 'item' : 'items'}</Text>;
  const move = (direction: number) => {
    const order = getShopSnapshot().data.shops.map(s => s.id); const from = order.indexOf(shop.id); const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]]; actions.reorderShops(order);
  };
  const renderCard = (action?: (normal?: React.ReactNode) => React.ReactNode) => {
    const Handle = action ? DraxHandle : View;
    const renderAction = action ?? ((normal?: React.ReactNode) => normal);
    return (
        <View style={[s.storeRow, !action && s.liftedCard]}>
          <Handle style={StyleSheet.absoluteFill}><View style={s.storeDragArea} pointerEvents="box-none">
            <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={`Open ${shop.name} row`}
              onPress={() => { if (!drag.held.current) open(shop.id); }} onLongPress={() => {}} delayLongPress={DRAG_DELAY} />
            <View pointerEvents="none" style={s.storeBadge}><Text style={[s.storeInitials, { color: c.primary }]}>{storeInitials(shop.name)}</Text></View>
            <View pointerEvents="none" style={s.flex} />
            {shop.shared && <IconButton icon="share" color={c.primary} label={`Share ${shop.name}, shared store`} onPress={() => { if (!drag.held.current) share(shop.id); }} />}
            {renderAction(<IconButton icon="right" color={c.primary} label={`Open ${shop.name}`} onPress={() => { if (!drag.held.current) open(shop.id); }} />)}
          </View></Handle>
          <View pointerEvents="box-none" style={s.storeTextOverlay}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${shop.name} store, ${count} ${count === 1 ? 'item' : 'items'}`} style={[s.nameTouch, { marginRight: shop.shared ? 88 : 44 }]}
              onPress={() => { if (!drag.held.current) open(shop.id); }}
              accessibilityHint="Swipe left to remove."
              accessibilityActions={[{ name: 'delete', label: 'Remove store' }, { name: 'increment', label: 'Move store later' }, { name: 'decrement', label: 'Move store earlier' }]}
              onAccessibilityAction={event => { const name = event.nativeEvent.actionName; if (name === 'delete') actions.removeShop(shop.id); else move(name === 'increment' ? 1 : -1); }}
              onKeyDown={event => { const key = event.nativeEvent as unknown as { altKey?: boolean; key?: string }; if (key.altKey && ['ArrowUp', 'ArrowDown'].includes(key.key ?? '')) { event.preventDefault(); move(key.key === 'ArrowUp' ? -1 : 1); } }}>
              <Text numberOfLines={1} style={s.storeName}>{shop.name}</Text>
            </Pressable>
            <View pointerEvents="none">{details}</View>
          </View>
        </View>
    );
  };
  return <Animated.View entering={Platform.OS === 'web' || !animateEntry ? undefined : fadeIn} exiting={fadeOut} collapsable={false}>
    <DraxView dragHandle snapDelay={0} snapDuration={200} style={s.dropTarget} longPressDelay={DRAG_DELAY} dragActivationFailOffset={12}
      renderHoverContent={props => <Animated.View pointerEvents="none" style={[s.dragging, hoverFrame(props), hover]}>{renderCard()}</Animated.View>}
      payload={{ kind: 'store', id: shop.id, shopId: '' } satisfies Drag}
      acceptsDrag={payload => accepts(payload, '', 'store') && payload.id !== shop.id}
      onDragStart={event => { drag.start(); setLift(true); token.current = preview?.start(shop.id, event) ?? 0; }}
      onDragEnd={event => { drag.stop(); setLift(false); return preview?.release(token.current, event, event.cancelled); }}
      onDragDrop={event => { drag.stop(); setLift(false); return preview?.release(token.current, event, false); }} onSnapEnd={() => trace(token.current, 'snap complete')}
      onReceiveDragEnter={preview?.over} onReceiveDragOver={preview?.over} onReceiveDragExit={preview?.exit}
      draggingStyle={s.itemDragOrigin} dragReleasedStyle={s.itemDragOrigin}>
      <Animated.View style={motion}><SwipeToDelete label={shop.name} onDelete={() => actions.removeShop(shop.id)} disabled={drag.active} onSwipeStart={drag.suppress} onSwipeEnd={drag.stop}>{action =>
        renderCard(action)}
      </SwipeToDelete></Animated.View>
    </DraxView>
  </Animated.View>;
});

const ShopList = memo(function ShopList({ open }: { open: (id: string) => void }) {
  const { data } = useShops();
  const [adding, setAdding] = useState(false);
  const order = useMemo(() => data.shops.map(shop => shop.id), [data.shops]);
  const entryGate = useEntryGate();
  const dragList = useListDrag(order, chosen => {
    const current = getShopSnapshot().data.shops.map(shop => shop.id);
    const next = dragOrder(current, chosen);
    if (next !== current) actions.reorderShops(next);
  }, 'manual', STORE_GAP);
  const [sharing, setSharing] = useState<string | null>(null);
  const sharedShop = data.shops.find(shop => shop.id === sharing);
  return <EntryAnimation.Provider value={entryGate}><ItemDragContext.Provider value={dragList}><View style={s.storesPage}>
    <View style={s.homeHeader}><View style={s.titleRow}><View style={s.flex}><Text accessibilityRole="header" style={s.title}>Stores</Text><Text style={s.homeSubtitle}>A picking order for every store.</Text></View></View></View>
    <DraxView style={s.flex} draggable={false} receptive={false} onMeasure={dragList.measureViewport}><DraxScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" bounces={false} contentContainerStyle={s.storesContent} style={s.flex}>
      <View style={s.storeRows}>{data.shops.map(shop => <StoreRow key={shop.id} shop={shop} open={open} share={setSharing} />)}</View>
      <ListTail shopId="" kind="store" last={order.at(-1)} />
      {!data.shops.length && <View style={s.emptyStores}><Icon name="bag" size={32} /><Text style={s.emptyTitle}>Your first store</Text><Text style={s.caption}>Tap + to create a store or join by ID.</Text></View>}
    </DraxScrollView></DraxView>
    {!adding && <FloatingAddButton label="Add store" accessibilityLabel="Add or join a store" onPress={() => setAdding(true)} />}
    {adding && <AddStore open={open} close={() => setAdding(false)} />}
    {sharedShop && <ShareShop shop={sharedShop} replaced={setSharing} close={() => setSharing(null)} />}
  </View></ItemDragContext.Provider></EntryAnimation.Provider>;
});

function ShareShop({ shop, close, replaced }: { shop: Shop; close: () => void; replaced: (id: string) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function share(copyOnly = false) {
    setBusy(true); setError('');
    try {
      const code = copyOnly && shop.shared ? shop.id : await actions.share(shop.id);
      if (copyOnly) {
        await Clipboard.setStringAsync(formatCode(code)); setCopied(true);
      } else {
        await Share.share({ title: `Share ${shop.name}`, message: `Join ${shop.name} in Shoppendo:\n${shopLink(code)}` });
      }
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true); setError('');
    try { replaced(await actions.stopSharing(shop.id)); close(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Sheet visible title={`Share ${shop.name}`} onClose={close}>
    <Text style={s.caption}>Anyone with this ID can edit this shop.</Text>
    <View style={s.idBox}>
      <Text style={s.idLabel}>SHOP ID</Text>
      <View style={s.shareActions}><Text selectable style={[s.idCode, s.flex]}>{formatCode(shop.id)}</Text>
        <IconButton icon={copied ? 'check' : 'copy'} label={copied ? 'ID copied' : 'Copy shop ID'} disabled={busy} onPress={() => void share(true)} />
      </View>
    </View>
    <Button label="Share link" busy={busy} onPress={() => void share()} />
    {shop.shared && <>
      <Button label="Stop sharing" secondary disabled={busy} onPress={() => void stop()} />
      <Text style={s.caption}>Stops sharing for everyone. Your list stays on this phone; the old ID will stop working.</Text>
    </>}
    {Boolean(error) && <Text accessibilityRole="alert" style={ui.errorText}>{error}</Text>}
  </Sheet>;
}

function CategoryButtons({ shop, selected, select, add }: { shop: Shop; selected: string; select: (id: string) => void; add: () => void }) {
  const groups = orderedGroups(shop);
  return <View style={s.categoryTiles}>{groups.map(id => {
    const tone = entityTone(id, groups);
    return <Pressable key={id} accessibilityRole="radio" accessibilityLabel={`Category ${shop.groups[id].name}`}
      accessibilityState={{ checked: selected === id, selected: selected === id }} onPress={() => select(id)}
      style={[s.categoryTile, { backgroundColor: selected === id ? c.primarySoft : tone.soft, borderColor: selected === id ? c.primary : 'transparent' }]}>
      <Icon name={shop.groups[id].icon ?? 'bag'} color={tone.color} size={21} />
      <Text numberOfLines={1} style={[s.categoryTileName, { color: selected === id ? c.text : tone.color }]}>{shop.groups[id].name}</Text>
      {selected === id && <View style={[s.selectionBadge, { backgroundColor: c.primary }]}><Icon name="check" color={c.white} size={12} /></View>}
    </Pressable>;
  })}
    <Pressable accessibilityRole="button" accessibilityLabel="Add category" onPress={add} style={s.categoryTile}>
      <Icon name="plus" size={21} /><Text style={s.categoryTileName}>Add category</Text>
    </Pressable>
  </View>;
}

function ItemArrival({ shop, item, close, start, end }: { shop: Shop; item: { name: string; groupId: string }; close: () => void; start: number; end: number }) {
  const y = useSharedValue(start);
  const opacity = useSharedValue(1);
  const tone = entityTone(item.groupId, orderedGroups(shop));
  useEffect(() => {
    y.value = withTiming(end, { duration: 650, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System });
    opacity.value = withDelay(850, withTiming(0, { duration: 180, reduceMotion: ReduceMotion.System }, finished => { if (finished) runOnJS(close)(); }));
    return () => { cancelAnimation(y); cancelAnimation(opacity); };
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }] }));
  return <Animated.View pointerEvents="none" style={[s.itemArrival, style]} accessibilityLiveRegion="polite">
    <View style={[s.itemCategory, { backgroundColor: tone.soft }]}><Icon name={shop.groups[item.groupId]?.icon ?? 'bag'} color={tone.color} /></View>
    <Text style={[s.itemName, s.flex]} numberOfLines={1}>{item.name}</Text><Icon name="check" size={20} /><Text style={s.caption}>Added</Text>
  </Animated.View>;
}

function CategoryOrder({ shop, draft, change, close }: { shop: Shop; draft: string[]; change: (order: string[]) => void; close: () => void }) {
  const [editor, setEditor] = useState<string | null>(null);
  const order = useMemo(() => mergeCategoryOrder(orderedGroups(shop), draft), [shop.groups, shop.groupOrder, draft]);
  const dragList = useListDrag(order, chosen => { const next = dragOrder(order, chosen); if (next !== order) change(next); }, 'manual', CATEGORY_GAP);
  const page = usePageBack(close, !dragList.dragging && !editor);
  return <ItemDragContext.Provider value={dragList}><GestureDetector gesture={page.edge} touchAction="pan-y"><Animated.View style={[s.flex, s.shopPage, page.style]}>
    <View style={s.listHeader}><GestureDetector gesture={page.header} touchAction="none"><View style={s.pageHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${shop.name}`} onPress={page.close} style={s.headerBack}>
        <Icon name="back" />
      </Pressable>
      <View style={s.headerCopy}>
        <Text accessibilityRole="header" style={s.title}>Categories</Text>
        <Text style={s.caption}>Change picking order</Text>
      </View>
    </View></GestureDetector>
    </View>
    <GestureDetector gesture={page.body} touchAction="pan-y"><View style={s.categoryOrderPage}>
    <ShopScroll page={page} horizontalPadding={0}>
      <View style={{ gap: CATEGORY_GAP }}>{order.map(id => <CategoryOrderRow key={id} shop={shop} id={id} order={order} change={change} edit={() => setEditor(id)} />)}</View>
      <ListTail shopId={shop.id} kind="group" last={order.at(-1)} />
      {!order.length && <Text style={s.caption}>Add your first category to organize this store.</Text>}
    </ShopScroll>
    </View></GestureDetector>
    {!editor && <FloatingAddButton label="Add category" onPress={() => setEditor('new')} />}
    {editor && (editor === 'new' || order.includes(editor)) && <NewCategory key={editor} shop={shop} editingId={editor === 'new' ? undefined : editor} created={() => {}} close={() => setEditor(null)} />}
  </Animated.View></GestureDetector></ItemDragContext.Provider>;
}

function CategoryOrderRow({ shop, id, order, change, edit }: { shop: Shop; id: string; order: string[]; change: (order: string[]) => void; edit: () => void }) {
  const drag = useHoldDrag();
  const preview = useContext(ItemDragContext);
  const token = useRef(0);
  const { motion, hover, setLift } = useRowMotion(id);
  const tone = entityTone(id, orderedGroups(shop));
  const group = shop.groups[id];
  const move = (direction: number) => {
    const index = order.indexOf(id); const to = index + direction;
    if (to < 0 || to >= order.length) return;
    const next = [...order]; [next[index], next[to]] = [next[to], next[index]]; change(next);
  };
  const grip = <View accessible={false} style={s.orderGrip}>{[0, 1, 2, 3, 4, 5].map(dot => <View key={dot} style={s.gripDot} />)}</View>;
  const gripSlot = { height: 40, justifyContent: 'center' as const, alignItems: 'center' as const };
  const content = <>
    <View style={[s.orderIcon, { backgroundColor: tone.soft }]}><Icon name={group.icon ?? 'bag'} color={tone.color} /></View>
    <Text style={[s.groupName, s.flex]}>{group.name}</Text>
  </>;
  return <Animated.View collapsable={false}><DraxView dragHandle snapDelay={0} snapDuration={0} style={s.dropTarget} longPressDelay={DRAG_DELAY} dragActivationFailOffset={12}
    renderHoverContent={props => <Animated.View pointerEvents="none" style={[s.dragging, hoverFrame(props), hover]}><View style={[s.categoryOrderRow, s.liftedCard]}><View style={StyleSheet.absoluteFill}><View style={s.categoryRowInner}><View style={s.categoryRowLabel}>{content}</View><View style={[ui.actionSlot, gripSlot]}>{grip}</View></View></View></View></Animated.View>}
      payload={{ kind: 'group', id, shopId: shop.id } satisfies Drag} acceptsDrag={payload => accepts(payload, shop.id, 'group') && payload.id !== id}
    onDragStart={event => { drag.start(); setLift(true); token.current = preview?.start(id, event) ?? 0; }}
      onDragEnd={event => { drag.stop(); setLift(false); preview?.release(token.current, event, event.cancelled); return DraxSnapbackTargetPreset.None; }}
    onDragDrop={event => { drag.stop(); setLift(false); preview?.release(token.current, event, false); return DraxSnapbackTargetPreset.None; }} onSnapEnd={() => trace(token.current, 'snap complete')}
    onReceiveDragEnter={preview?.over} onReceiveDragOver={preview?.over} onReceiveDragExit={preview?.exit}
    draggingStyle={s.itemDragOrigin} dragReleasedStyle={s.itemDragOrigin}>
    <Animated.View style={motion}><SwipeToDelete label={group.name} onDelete={() => actions.deleteGroup(shop.id, id)} disabled={drag.active} onSwipeStart={drag.suppress} onSwipeEnd={drag.stop} activeOffsetX={8} failOffsetY={32} touchAction="pan-x">{action =>
      <View style={s.categoryOrderRow}><DraxHandle style={StyleSheet.absoluteFill}><View style={s.categoryRowInner} pointerEvents="box-none">
        <Pressable style={s.categoryRowLabel} accessibilityRole="button" accessibilityLabel={`Edit ${group.name} category`} accessibilityHint="Tap to edit. Hold anywhere to drag. Swipe left to delete. Alt+Up or Alt+Down also moves the category."
          onPress={() => { if (!drag.held.current) edit(); }}
          accessibilityActions={[{ name: 'delete', label: 'Delete category' }, { name: 'increment', label: 'Move later' }, { name: 'decrement', label: 'Move earlier' }]}
          onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'delete') actions.deleteGroup(shop.id, id); else move(event.nativeEvent.actionName === 'increment' ? 1 : -1); }}
          onKeyDown={event => { const key = event.nativeEvent as unknown as { altKey?: boolean; key?: string }; if (key.altKey && ['ArrowUp','ArrowDown'].includes(key.key ?? '')) { event.preventDefault(); move(key.key === 'ArrowUp' ? -1 : 1); } }}
          onLongPress={() => {}} delayLongPress={DRAG_DELAY}>{content}</Pressable>
        {action(grip, gripSlot)}
      </View></DraxHandle></View>}
    </SwipeToDelete></Animated.View>
  </DraxView></Animated.View>;
}

function NewCategory({ shop, created, close, embedded = false, scrollOffset, editingId }: {
  shop: Shop; created: (id: string) => void; close: () => void; embedded?: boolean; scrollOffset?: React.RefObject<number>; editingId?: string;
}) {
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const focusInput = useCallback(() => { requestAnimationFrame(() => input.current?.focus()); }, []);
  const ownScroll = useRef(0); const scrollY = scrollOffset ?? ownScroll;
  const editing = editingId ? shop.groups[editingId] : undefined;
  const [name, setName] = useState(editing?.name ?? '');
  const [icon, setIcon] = useState<GroupIcon>(editing?.icon ?? 'bag');
  const finish = () => { if (!embedded) Keyboard.dismiss(); close(); };
  const save = (value: string) => {
    if (editingId) { actions.editGroup(shop.id, editingId, value, icon); finish(); return; }
    const id = actions.addGroup(shop.id, value); actions.editGroup(shop.id, id, value, icon); created(id); finish();
  };
  const form = <EditingRegion style={{ maxHeight: 260, flexShrink: 1, gap: 4 }}>
    <Text style={s.caption}>Category name</Text>
      <View style={s.composerInput}><InlineInput leadingIcon={icon} inputRef={input} label={editingId ? 'Category name' : 'New category name'} placeholder="Category name" value={name} onValueChange={setName} onAdd={save}
        autoFocus={embedded} keepOpen={false} submitLabel={editingId ? 'Save category' : 'Create category'} maxLength={80} /></View>
    <Text style={s.fieldLabel}>Choose icon</Text>
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingRight: 12, paddingBottom: 6 }} keyboardShouldPersistTaps="handled"
      onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
      <View style={s.iconGrid}>{GROUP_ICONS.map(option => <Pressable key={option} accessibilityRole="radio" accessibilityLabel={`${option} icon`}
        accessibilityState={{ checked: icon === option, selected: icon === option }} onPress={() => setIcon(option)} style={[s.iconChoice, icon === option && s.selectedIcon]}>
        <Icon name={option} size={24} />{icon === option && <View style={s.selectionBadge}><Icon name="check" color={c.white} size={13} /></View>}
      </Pressable>)}</View>
    </ScrollView>
  </EditingRegion>;
  return embedded ? form : <Sheet visible compact title={editingId ? 'Edit category' : 'Add category'} canSwipeDown={() => scrollY.current <= 1} onShow={focusInput}
    onClose={finish}>{form}</Sheet>;
}

function AddItem({ shop, close, initialCategory, editingId, onAdded }: { shop: Shop; close: () => void; initialCategory?: string; editingId?: string; onAdded?: (id: string, name: string, groupId: string) => void }) {
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const focusInput = useCallback(() => { requestAnimationFrame(() => input.current?.focus()); }, []);
  const [addingCategory, setAddingCategory] = useState(false);
  const editing = editingId ? shop.items[editingId] : undefined;
  const { data } = useShops();
  const scrollY = useRef(0);
  const groups = orderedGroups(shop);
  const [category, setCategory] = useState(editing?.groupId ?? initialCategory ?? groups[0] ?? '');
  const [query, setQuery] = useState(editing?.name ?? '');
  const [suggestionsHidden, setSuggestionsHidden] = useState(false);
  const [error, setError] = useState('');
  const suggestions = editing || suggestionsHidden ? [] : itemSuggestions(data.shops, shop, query);
  const type = (value: string) => {
    setQuery(value); setSuggestionsHidden(false); setError('');
  };
  const add = (name: string) => {
    if (editingId) {
      actions.renameItem(shop.id, editingId, name);
      if (category !== editing?.groupId) actions.moveItem(shop.id, editingId, category, null, true);
      Keyboard.dismiss(); close();
    } else { const id = actions.addItem(shop.id, category, name); onAdded?.(id, name.trim(), category); }
  };
  return <Sheet visible compact canSwipeDown={() => scrollY.current <= 1} title={addingCategory ? 'Add category' : editing ? 'Edit item' : 'Add item'} onShow={focusInput} onClose={() => { Keyboard.dismiss(); close(); }}><EditingRegion style={{ flexShrink: 1 }}>
    {addingCategory ? <NewCategory embedded scrollOffset={scrollY} shop={shop} created={id => { setCategory(id); }}
      close={() => { setAddingCategory(false); scrollY.current = 0; focusInput(); }} /> : <View style={s.itemComposer}><ScrollView onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} style={{ maxHeight: 260, flexShrink: 1 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false}>
      <View style={s.composerInput}><InlineInput inputRef={input} label={editing ? "Edit item name" : "New item name"} placeholder={editing ? "Item name" : "Add item…"} keepOpen={!editing} submitLabel={editing ? "Save item" : "Add item"} onAdd={add}
        value={query} onValueChange={type} /></View>
      {suggestions.length > 0 && <ScrollView style={s.suggestions} keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false}>{suggestions.map(option => <Pressable key={option.name}
        accessibilityRole="button" accessibilityLabel={`Suggest ${option.name}, ${shop.groups[option.groupId].name}`}
        onPress={() => { setQuery(option.name); setCategory(option.groupId); setSuggestionsHidden(true); }} style={s.suggestion}>
        <Icon name={shop.groups[option.groupId].icon ?? 'bag'} color={entityTone(option.groupId, groups).color} size={19} />
        <Text style={[s.link, s.flex]}>{option.name}</Text><Text style={s.caption}>{shop.groups[option.groupId].name}</Text>
      </Pressable>)}</ScrollView>}
      <Text style={s.selectedCategoryLabel}>Category</Text>
      <CategoryButtons shop={shop} selected={category} add={() => { scrollY.current = 0; setAddingCategory(true); }} select={id => { setCategory(id); setError(''); }} />
      <Pressable accessibilityRole="button" accessibilityLabel={editing ? "Cancel editing item" : "Cancel adding item"} style={s.textButton} onPress={() => { Keyboard.dismiss(); close(); }}><Text style={s.link}>Cancel</Text></Pressable>
      {Boolean(error) && <Text accessibilityRole="alert" style={ui.errorText}>{error}</Text>}
    </ScrollView></View>}
  </EditingRegion></Sheet>;
}

function usePageBack(back: () => void, enabled: boolean) {
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

function ShoppingList({ shop, back, replaced }: { shop: Shop; back: () => void; replaced: (id: string) => void }) {
  const { data } = useShops();
  const [sharing, setSharing] = useState(false);
  const [editingStore, setEditingStore] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [topAdding, setTopAdding] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<string[] | null>(null);
  const sortingGroups = categoryDraft !== null;
  const [headerHeight, setHeaderHeight] = useState(72);
  const finishSorting = () => {
    if (categoryDraft) {
      const current = orderedGroups(shop); const next = mergeCategoryOrder(current, categoryDraft);
      if (next.some((id, index) => current[index] !== id)) actions.reorder(shop.id, next);
    }
    setCategoryDraft(null);
  };
  const startSorting = () => { setMenuOpen(false); setCategoryDraft(orderedGroups(shop)); setTopAdding(false); setEditingItem(null); };
  const [arrival, setArrival] = useState<{ id: string; name: string; groupId: string } | null>(null);
  const itemSort = data.itemSort ?? 'group';
  const [checking, setChecking] = useState<Set<string>>(() => new Set());
  const checkTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => { for (const timer of checkTimers.current.values()) clearTimeout(timer); }, []);
  const toggle = useCallback((id: string) => {
    clearTimeout(checkTimers.current.get(id)); checkTimers.current.delete(id);
    const done = actions.toggleItem(shop.id, id);
    setChecking(previous => { const next = new Set(previous); if (done) next.add(id); else next.delete(id); return next; });
    if (done) checkTimers.current.set(id, setTimeout(() => {
      checkTimers.current.delete(id);
      setChecking(previous => { const next = new Set(previous); next.delete(id); return next; });
    }, 1000));
  }, [shop.id]);
  // Persist checks immediately; delay only their visual move so navigating away cannot lose one.
  // Derived lists are sorted copies of the whole shop: compute them only when their inputs change.
  const displayShop = useMemo(() => checking.size ? { ...shop, items: Object.fromEntries(Object.entries(shop.items).map(([id, item]) => [id, checking.has(id) ? { ...item, done: false } : item])) } : shop, [shop, checking]);
  const groups = useMemo(() => orderedGroups(shop), [shop.groups, shop.groupOrder]);
  const missing = useMemo(() => missingItems(shop), [shop]);
  const picked = useMemo(() => doneItems(shop).filter(([id]) => !checking.has(id)), [shop, checking]);
  const flatItems = useMemo(() => listItems(displayShop, itemSort), [displayShop, itemSort]);
  const dragIds = useMemo(() => itemSort === 'group' ? listItems(shop).map(([id]) => id) : [], [shop, itemSort]);
  const entryGate = useEntryGate();
  const editItem = useCallback((id: string) => { setEditingItem(id); setTopAdding(false); }, []);
  const itemDrag = useListDrag(dragIds, chosen => {
    const { data } = getShopSnapshot();
    const currentShop = data.shops.find(entry => entry.id === shop.id);
    if (!currentShop || (data.itemSort ?? 'group') !== 'group') return;
    const slot = itemDropSlot(currentShop, chosen.source, chosen.target, chosen.after);
    if (slot) actions.moveItem(shop.id, chosen.source, slot.groupId, slot.beforeId);
  }, itemSort);
  const page = usePageBack(back, !itemDrag.dragging && !editingStore && !topAdding && !editingItem && !sortingGroups && !menuOpen);
  const closePage = () => { if (sortingGroups) finishSorting(); else page.close(); };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closePage(); return true; });
    return () => sub.remove();
  }, [page.close, categoryDraft, shop]);
  const completed = picked;
  return <Animated.View style={s.flex} entering={SlideInDown.duration(240).easing(Easing.bezier(0.22, 1, 0.36, 1)).reduceMotion(ReduceMotion.System)}>
    <View style={s.flex} {...(Platform.OS === 'web' ? { inert: sortingGroups } : {})}
      pointerEvents={sortingGroups ? 'none' : 'auto'} accessibilityElementsHidden={sortingGroups}
      importantForAccessibility={sortingGroups ? 'no-hide-descendants' : 'auto'} aria-hidden={sortingGroups}>
    <GestureDetector gesture={page.edge} touchAction="pan-y"><Animated.View style={[s.flex, s.shopPage, page.style]}>
    <View style={s.listHeader} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
      <GestureDetector gesture={page.header} touchAction="none"><View style={s.pageHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to stores" onPress={closePage} style={s.headerBack}>
          <Icon name="back" />
        </Pressable>
        <View style={s.headerCopy}>
          {editingStore ? <TextInput accessibilityLabel="Store name" autoFocus selectTextOnFocus defaultValue={shop.name}
            style={[s.title, { padding: 0 }]} maxLength={80} returnKeyType="done" submitBehavior="submit"
            onSubmitEditing={event => {
              const name = event.nativeEvent.text.trim();
              if (!name) return;
              if (name !== shop.name) actions.renameShop(shop.id, name);
              setEditingStore(false);
            }} onBlur={() => setEditingStore(false)} /> : <Text accessibilityRole="header" numberOfLines={1} style={s.title}>{shop.name}</Text>}
        </View>
        <View style={s.headerActions}>
          <IconButton icon="categories" label="Categories" onPress={startSorting} />
          <IconButton icon="share" label="Share shop" onPress={() => { setMenuOpen(false); setSharing(true); }} />
          <IconButton icon="more" label="Store settings" onPress={() => setMenuOpen(!menuOpen)} />
        </View>
      </View></GestureDetector>
      <View style={s.statusSummary}>
        <Text style={s.statusCount}>{flatItems.length} to get</Text>
        <View style={s.statusDivider} />
        <View style={[s.statusBadge, s.missingTint]}><Icon name="missing" size={15} color={c.danger} /><Text style={[s.statusCount, { color: c.danger }]}>{missing.length} missing</Text></View>
        <View style={s.statusDivider} />
        <View style={s.statusBadge}><Icon name="check" size={15} /><Text style={[s.statusCount, { color: c.primary }]}>{completed.length} done</Text></View>
      </View>
      {menuOpen && <View style={s.menuPosition}><EditingRegion onDismiss={() => setMenuOpen(false)}>
        <Animated.View entering={fadeIn} style={s.viewMenu}>
          <Pressable accessibilityRole="button" style={s.menuOption} onPress={() => { setMenuOpen(false); setEditingStore(true); }}>
            <Text style={s.link}>Rename store</Text>
          </Pressable>
          <Text style={[s.menuCaption, s.menuShare]}>Sort items</Text>
          <Text style={s.menuCaption}>Choose By group to drag items.</Text>
          {([['group', 'By group'], ['name', 'By name (A–Z)'], ['added', 'By time added (oldest first)']] as const).map(([sort, label]) => <Pressable key={sort} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: itemSort === sort }} style={s.menuOption}
            onPress={() => { actions.setItemSort(sort); setMenuOpen(false); }}>
            <Text style={[s.link, s.flex]}>{label}</Text>{itemSort === sort && <Icon name="check" size={18} />}
          </Pressable>)}
          <Text style={[s.menuCaption, s.menuShare]}>Categories</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Manage categories" style={s.menuOption} onPress={startSorting}>
            <Text style={[s.link, s.flex]}>Manage categories</Text><Icon name="right" size={18} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Share shop ID" style={[s.menuOption, s.menuShare]} onPress={() => { setMenuOpen(false); setSharing(true); }}>
            <Text style={[s.link, s.flex]}>Share shop ID</Text><Icon name="share" size={18} />
          </Pressable>
        </Animated.View>
      </EditingRegion></View>}
    </View>
    <EntryAnimation.Provider value={entryGate}><ItemEditorContext.Provider value={editItem}><ItemDragContext.Provider value={itemDrag}><GestureDetector gesture={page.body} touchAction="pan-y"><View style={s.flex}><ShopScroll page={page}>
      <View>
        <View style={flatItems.length ? s.itemPanel : undefined}>{flatItems.map(([id]) => <ItemRow key={id} shopId={shop.id} groups={shop.groups} order={groups} id={id} item={shop.items[id]} showCategory manualOrder={itemSort === 'group'} toggle={toggle} />)}</View>
        {!flatItems.length && groups.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Add an item to the list" style={s.emptyList} onPress={() => setTopAdding(true)}>
          <Icon name="bag" size={28} /><Text style={s.caption}>{picked.length || missing.length ? 'Nothing left to pick up' : 'Add your first item'}</Text>
        </Pressable>}
      </View>
      {!groups.length && <View style={s.noGroups}><Text style={s.emptyTitle}>Start with a category</Text><Text style={s.caption}>Open Categories to create your first category.</Text></View>}
      <ListTail shopId={shop.id} kind="item" last={flatItems.at(-1)?.[0]} />
      <View>
        {missing.length > 0 && <View style={s.doneSection}><Text accessibilityRole="header" style={[s.doneLabel, { color: c.danger }]}>Missing · {missing.length}</Text>{missing.map(([id, item]) => <ItemRow key={id} shopId={shop.id} groups={shop.groups} order={groups} id={id} item={item} showCategory manualOrder={false} toggle={toggle} />)}</View>}
        {completed.length > 0 && <View style={s.doneSection}><Text accessibilityRole="header" style={s.doneLabel}>Done · {completed.length}</Text>{completed.map(([id]) => <ItemRow key={id} shopId={shop.id} groups={shop.groups} order={groups} id={id} item={shop.items[id]} showCategory manualOrder={itemSort === 'group'} toggle={toggle} />)}</View>}
      </View>
    </ShopScroll></View></GestureDetector></ItemDragContext.Provider></ItemEditorContext.Provider></EntryAnimation.Provider>
    {!topAdding && !editingItem && <FloatingAddButton label="Add item" disabled={!groups.length} onPress={() => setTopAdding(true)} />}
    {arrival && !sortingGroups && <ItemArrival key={arrival.id} shop={shop} item={arrival} start={76} end={headerHeight + 16} close={() => setArrival(null)} />}
      {(topAdding || editingItem) && <AddItem key={editingItem ?? 'new'} shop={shop} editingId={editingItem ?? undefined}
        onAdded={(id, name, groupId) => setArrival({ id, name, groupId })} close={() => { setTopAdding(false); setEditingItem(null); }} />}
    {sharing && <ShareShop shop={shop} replaced={replaced} close={() => setSharing(false)} />}
    </Animated.View></GestureDetector></View>
    {sortingGroups && <Animated.View style={StyleSheet.absoluteFill} entering={SlideInDown.duration(240).easing(Easing.bezier(0.22, 1, 0.36, 1)).reduceMotion(ReduceMotion.System)}>
      <DraxProvider><CategoryOrder shop={shop} draft={categoryDraft!} change={setCategoryDraft} close={finishSorting} /></DraxProvider>
    </Animated.View>}
  </Animated.View>;
}

function LoadingScreen() {
  return <View style={s.loading}><Image accessibilityLabel="Loading Shoppendo" source={require('./assets/shoppendo-splash.png')} resizeMode="contain" style={{ width: 140, height: 140 }} /></View>;
}

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

const s = StyleSheet.create({
  categoryOrderPage: { flex: 1, backgroundColor: c.background, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, gap: 8 },
  itemArrival: { position: 'absolute', left: 12, right: 12, top: 0, zIndex: 1000, elevation: 40, backgroundColor: c.white, borderRadius: 12, borderWidth: 1, borderColor: c.border, minHeight: 54, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: c.text, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  orderStoreLabel: { fontFamily: f.medium, color: c.muted, textTransform: 'uppercase', fontSize: 12, marginVertical: 10 },
  categoryOrderRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 6, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 14 },
  categoryRowLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 42, gap: 12 },
  categoryRowInner: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 16 },
  liftedCard: { flex: 1, borderColor: '#85A67D' },
  orderIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  orderGrip: { width: 12, height: 20, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center', gap: 4 },
  gripDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.muted },
  selectedCategoryLabel: { fontFamily: f.semibold, fontSize: 12, color: c.text, paddingTop: 8 },
  editorHeading: { fontFamily: f.semibold, fontSize: 17, color: c.text, marginBottom: 6 },
  selectionBadge: { position: 'absolute', right: -5, top: -5, width: 21, height: 21, borderRadius: 11, borderWidth: 2, borderColor: c.white, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center' },
  shopPage: { backgroundColor: c.background },
  categoryTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8, paddingHorizontal: 5 },
  categoryTile: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 42, paddingHorizontal: 12, gap: 7, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', backgroundColor: c.background },
  categoryTileName: { flexShrink: 1, fontFamily: f.medium, fontSize: 14, color: c.text },
  root: { flex: 1, backgroundColor: c.background }, flex: { flex: 1 },
  safe: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', backgroundColor: c.background },
  splash: { zIndex: 10000, elevation: 100, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 },
  currentStore: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  storeTitleTouch: { flexShrink: 1, justifyContent: 'center' },
  currentStoreName: { fontFamily: f.bold, fontSize: 22, lineHeight: 28, includeFontPadding: false, color: c.text },
  nameTouch: { alignSelf: 'flex-start', maxWidth: '100%' },
  storeTextOverlay: { position: 'absolute', left: 84, right: 16, top: 0, bottom: 0, justifyContent: 'center' },
  groupTextOverlay: { position: 'absolute', left: 44, right: 104, top: 0, bottom: 0, justifyContent: 'center' },
  storeDragArea: { flex: 1, paddingLeft: 16, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  storeOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  fieldLabel: { fontFamily: f.semibold, fontSize: 14, color: c.text },
  addModes: { flexDirection: 'row', gap: 10 }, addMode: { flex: 1, minHeight: 50, borderWidth: 1, borderColor: c.border, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addModeSelected: { backgroundColor: c.primarySoft, borderColor: c.primary },
  dropTarget: { borderRadius: 12 },
  storesContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 112 },
  homeSubtitle: { fontFamily: f.regular, fontSize: 16, color: c.muted },
  storesPage: { flex: 1, backgroundColor: c.background },
  homeHeader: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  title: { fontFamily: f.bold, fontSize: 32, lineHeight: 40, color: c.text, flexShrink: 1 },
  storeRows: { gap: STORE_GAP }, storeRow: { minHeight: 88, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 14 },
  storeNameWrap: { flex: 1, gap: 4 }, storeName: { fontFamily: f.bold, color: c.text, fontSize: 18 },
  storeBadge: { width: 52, height: 52, borderRadius: 14, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  storeInitials: { fontFamily: f.bold, fontSize: 24, color: c.primary },
  emptyStores: { alignItems: 'center', paddingVertical: 32, gap: 10 }, emptyTitle: { fontFamily: f.semibold, fontSize: 18, color: c.text },
  caption: { fontFamily: f.regular, fontSize: 13, color: c.muted, lineHeight: 20 },
  textButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  dangerText: { color: c.danger, fontFamily: f.medium, fontSize: 15 }, link: { color: c.primary, fontFamily: f.medium, fontSize: 14 },
  editStoreInput: { flex: undefined, borderWidth: 1, borderColor: c.border, borderRadius: 10 },
  listHeader: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 8, gap: 6, zIndex: 10, backgroundColor: c.background },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 52 },
  headerBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0, justifyContent: 'center' },
  backLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  storeHeading: { alignItems: 'flex-start', gap: 2 },
  itemPanel: { backgroundColor: c.white, borderWidth: ITEM_PANEL_BORDER, borderColor: c.border, borderRadius: 14 },
  itemComposer: { paddingBottom: 4, flexShrink: 1 },
  composerInput: { borderWidth: 1.5, borderColor: c.primary, borderRadius: 14, paddingHorizontal: 6, overflow: 'hidden', marginBottom: 6 },
  menuPosition: { position: 'absolute', top: 62, right: 12, zIndex: 20 },
  viewMenu: { width: 208, padding: 8, backgroundColor: c.white, borderRadius: 14, borderWidth: 1, borderColor: c.border, elevation: 8, shadowColor: c.text, shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
  menuCaption: { fontFamily: f.medium, color: c.muted, fontSize: 12, paddingHorizontal: 10, paddingVertical: 6 },
  menuOption: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 },
  menuShare: { borderTopWidth: 1, borderTopColor: c.border, marginTop: 4 },
  topComposer: { marginTop: 8, padding: 10, backgroundColor: c.primarySoft, borderRadius: 12 },
  itemCategory: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySoft, borderRadius: 9, marginRight: 10 },
  itemCategoryCapsule: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '100%' },
  itemCategoryName: { flexShrink: 1, fontFamily: f.medium, fontSize: 12, lineHeight: 18 },
  itemCategoryAction: { width: 'auto', maxWidth: '45%', minWidth: 44, height: 60, justifyContent: 'center' },
  itemCategoryPicker: { paddingHorizontal: 10, paddingBottom: 4, backgroundColor: c.primarySoft, borderRadius: 12 },
  categoryButton: { width: 44, height: 44, borderWidth: 1, borderColor: c.border, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: c.white },
  categoryCaption: { fontFamily: f.medium, fontSize: 12, color: c.primary, paddingTop: 6 },
  suggestions: { maxHeight: 96, borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 4 },
  suggestion: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 },
  emptyList: { alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 160 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 52 },
  shareLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }, shareText: { fontFamily: f.medium, fontSize: 14, color: c.secondary },
  listContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 112 },
  group: { paddingBottom: 16, backgroundColor: c.white, borderRadius: 12 },
  dragging: { backgroundColor: c.white, borderRadius: 12, shadowColor: c.text, shadowOpacity: 0, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  itemDragOrigin: { opacity: 0 },
  dragOrigin: { opacity: 0.25 }, groupReceiving: { backgroundColor: c.primarySoft, borderColor: c.primary },
  itemDrop: { borderRadius: 5 },
  dropBefore: { borderTopColor: c.primary, borderBottomColor: 'transparent', backgroundColor: c.primarySoft }, dropAfter: { borderTopColor: 'transparent', borderBottomColor: c.primary, backgroundColor: c.primarySoft },
  groupIcon: { backgroundColor: c.primarySoft, width: 36, height: 36, borderRadius: 10 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  inlineEditor: { paddingHorizontal: 4, backgroundColor: c.white }, addStoreForm: { gap: 12 },
  iconChoice: { width: 44, minHeight: 44, borderWidth: 1.5, borderColor: c.border, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4 },
  selectedIcon: { borderColor: c.primary, backgroundColor: c.primarySoft }, iconLabel: { fontFamily: f.medium, fontSize: 10, color: c.muted, textTransform: 'capitalize' },
  editActions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  groupHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52 }, groupHeaderTarget: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 5 },
  groupName: { flexShrink: 1, fontFamily: f.semibold, fontSize: 17, color: c.text }, item: { flexDirection: 'row', minHeight: 64, alignItems: 'center' },
  itemDivider: { position: 'absolute', left: 52, right: 0, bottom: 0, height: StyleSheet.hairlineWidth * 2, backgroundColor: c.border },
  checkboxTarget: { width: 44, minHeight: 64, alignItems: 'center', justifyContent: 'center' }, checkbox: { width: 22, height: 22, borderWidth: 1.8, borderColor: c.muted, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: c.primary, borderColor: c.primary }, itemTextOverlay: { flex: 1, marginLeft: 52, marginRight: 11, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 }, itemNameTarget: { flex: 1, minHeight: 60, justifyContent: 'center' },
  itemName: { fontFamily: f.medium, fontSize: 18, color: c.text, lineHeight: 23 }, doneName: { color: c.muted, textDecorationLine: 'line-through' },
  emptyGroup: { minHeight: 44, justifyContent: 'center', paddingLeft: 25 }, noGroups: { gap: 10, paddingVertical: 26 },
  addGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, marginTop: 2 },
  statusSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 4 },
  statusCount: { fontFamily: f.semibold, fontSize: 14, color: c.text },
  statusDivider: { width: 1, height: 20, backgroundColor: c.border },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 16, paddingHorizontal: 6, paddingVertical: 4 },
  missingTint: { backgroundColor: '#F9E9E6' },
  missingRow: { backgroundColor: '#F9E9E6', borderRadius: 14 },
  doneSection: { marginVertical: 8, gap: 4 },
  doneLabel: { fontFamily: f.semibold, fontSize: 16, color: c.muted, marginLeft: 4, marginBottom: 4 },
  idBox: { backgroundColor: c.secondarySoft, borderRadius: 14, padding: 18, gap: 10 }, idLabel: { fontFamily: f.bold, color: c.secondary, fontSize: 10, letterSpacing: 1 },
  idCode: { fontFamily: f.bold, color: c.secondary, fontSize: 18, lineHeight: 28 }, shareActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  shareLoading: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorBanner: { backgroundColor: c.secondarySoft, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingVertical: 12 },
  retry: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
