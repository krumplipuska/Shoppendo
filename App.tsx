import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, unstable_batchedUpdates, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureDetector, GestureHandlerRootView, GestureStateManager, ScrollView as GestureScrollView, usePanGesture } from 'react-native-gesture-handler';
import { DraxProvider, useDraxId, useDraxContext, DraxView, DraxHandle, DraxScrollView, DraxSnapbackTargetPreset, type DraxViewMeasurements } from 'react-native-drax';
import Animated, { FadeIn, FadeInUp, FadeInDown, FadeOut, FadeOutDown, ZoomIn, SlideInDown, Easing, LinearTransition, ReduceMotion, useSharedValue, useAnimatedReaction, useAnimatedStyle, cancelAnimation, withDelay, withTiming } from 'react-native-reanimated';
import { useFonts } from 'expo-font';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { actions, errorMessage, load, useShops } from './src/store';
import { activeItems, doneItems, formatCode, GROUP_ICONS, itemSuggestions, listItems, orderedGroups, mergeCategoryOrder, storeInitials, type GroupIcon, type Item, type Shop } from './src/model';
import { Button, Icon, IconButton, EditingRegion, EditingSurface, useFinishEditing, InlineInput, Sheet, SwipeToDelete, ui } from './src/ui';
import { colors as c, fonts as f, entityTone } from './src/theme';

import { runOnJS } from 'react-native-worklets';
import { backSwipeDirection, swipeAxis, itemDragLayout, shouldStartListPull } from './src/interaction';

type Drag = { kind: 'item' | 'group' | 'store'; id: string; shopId: string };
function accepts(payload: unknown, shopId: string, kind?: Drag['kind']): payload is Drag {
  const drag = payload as Drag | null;
  return Boolean(drag && drag.shopId === shopId && typeof drag.id === 'string' && (kind ? drag.kind === kind : ['item', 'group', 'store'].includes(drag.kind)));
}
function dragFeedback() {
  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
function dropGroup(shop: Shop, source: string, target: string, after: boolean) {
  if (source === target || !shop.groups[source] || !shop.groups[target]) return;
  const order = orderedGroups(shop).filter(id => id !== source);
  order.splice(order.indexOf(target) + (after ? 1 : 0), 0, source);
  actions.reorder(shop.id, order);
}

function commitDrop(change: () => void) { unstable_batchedUpdates(change, undefined); }

const DRAG_DELAY = 320;
const rowMotion = LinearTransition.duration(160).reduceMotion(ReduceMotion.System);
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
  return { held, active, start, stop, suppress };
}

// Keep the lifted card above native scrolling/header surfaces on both platforms.
function DragOverlay() {
  const { draggedIdSV, hoverReadySV, hoverPositionSV, getViewEntry } = useDraxContext();
  const [content, setContent] = useState<React.ReactNode>(null);
  const load = (id: string) => {
    const entry = getViewEntry(id);
    const render = entry?.props.renderHoverContent;
    setContent(() => render?.({ hover: true, children: null, dimensions: entry?.measurements,
      viewState: { dragStatus: 1, receiveStatus: 0 } }) ?? null);
  };
  useAnimatedReaction(() => draggedIdSV.value, (id, before) => { if (id !== before) runOnJS(load)(id); });
  const position = useAnimatedStyle(() => ({ opacity: draggedIdSV.value && hoverReadySV.value ? 1 : 0,
    transform: [{ translateX: hoverPositionSV.value.x }, { translateY: hoverPositionSV.value.y }] }));
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 10000, elevation: 100 }]}>
    <Animated.View style={[{ position: 'absolute', top: 0, left: 0 }, position]}><View style={s.dragging}>{content}</View></Animated.View>
  </View>;
}

function ShopScroll({ page, children }: { page: ReturnType<typeof usePageBack>; children: React.ReactNode }) {
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const offset = useSharedValue({ x: 0, y: 0 });
  const size = useRef({ viewport: 0, content: 0, y: 0 });
  const autoDirection = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const stop = () => { clearInterval(autoTimer.current); autoTimer.current = undefined; autoDirection.current = 0; setDragging(false); };
  useEffect(() => () => clearInterval(autoTimer.current), []);
  return <DraxView isParent style={s.flex} scrollPosition={offset} draggable={false}
    onMonitorDragStart={() => setDragging(true)} onMonitorDragEnter={() => setDragging(true)} onMonitorDragExit={stop} onMonitorDragEnd={stop} onMonitorDragDrop={stop}
    onMonitorDragOver={event => {
      autoDirection.current = event.monitorOffsetRatio.y < 0.1 ? -1 : event.monitorOffsetRatio.y > 0.9 ? 1 : 0;
      if (!autoTimer.current) autoTimer.current = setInterval(() => {
        const next = Math.max(0, Math.min(size.current.content - size.current.viewport, size.current.y + autoDirection.current * 12));
        if (next !== size.current.y) ref.current?.scrollTo({ y: next, animated: false });
      }, 32);
    }}>
    <GestureScrollView ref={ref} simultaneousWith={page.body} disallowInterruption={false} style={s.flex}
      contentContainerStyle={s.listContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" bounces={false}
      scrollEnabled={!dragging} scrollEventThrottle={16} onLayout={event => { size.current.viewport = event.nativeEvent.layout.height; }}
      onContentSizeChange={(_, height) => { size.current.content = height; }}
      onScroll={event => { const y = event.nativeEvent.contentOffset.y; size.current.y = y; offset.value = { x: 0, y }; page.scrollY.value = y; }}>
      {children}
    </GestureScrollView>
  </DraxView>;
}
const ItemEditorContext = createContext<(id: string) => void>(() => {});

type ItemPreview = { source: string; target: string; after: boolean; height: number };
const ItemDragContext = createContext<{
  preview: ItemPreview | null; shifts: Record<string, number>;
  start: (id: string, height: number) => void; over: (id: string, after: boolean) => void; stop: () => void;
} | null>(null);

function useListDrag(ids: string[]) {
  const [preview, setPreview] = useState<ItemPreview | null>(null);
  const current = useRef<ItemPreview | null>(null);
  const update = (next: ItemPreview | null) => { current.current = next; setPreview(next); };
  return { preview, shifts: preview ? itemDragLayout(ids, preview).shifts : {},
    start: (id: string, height: number) => update({ source: id, target: id, after: false, height }),
    over: (target: string, after: boolean) => { const previous = current.current; if (previous && (previous.target !== target || previous.after !== after)) update({ ...previous, target, after }); },
    stop: () => update(null),
  };
}

// Extend the last row's hit area into unused space without a surface or layout gap.
function ListTail({ shopId, kind, last, drop }: { shopId: string; kind: Drag['kind']; last?: string; drop: (id: string) => void }) {
  const preview = useContext(ItemDragContext);
  const height = useWindowDimensions().height;
  const id = useDraxId();
  const { updateMeasurements } = useDraxContext();
  const extendHitArea = useCallback((bounds: DraxViewMeasurements | undefined) => { if (bounds) updateMeasurements(id, { ...bounds, height }); }, [id, height, updateMeasurements]);
  const latest = useRef({ last, drop }); latest.current = { last, drop };
  return <DraxView id={id} onMeasure={extendHitArea} pointerEvents="none" draggable={false}
    style={{ height: 0 }} acceptsDrag={payload => accepts(payload, shopId, kind)}
    onReceiveDragOver={() => { if (latest.current.last) preview?.over(latest.current.last, true); }}
    onReceiveDragDrop={({ dragged }) => {
      const payload = dragged.payload;
      if (accepts(payload, shopId, kind)) commitDrop(() => { latest.current.drop(payload.id); preview?.stop(); });
      return DraxSnapbackTargetPreset.None;
    }} />;
}

function ItemCategory({ shop, groupId }: { shop: Shop; groupId: string }) {
  const [shown, setShown] = useState(groupId);
  const angle = useSharedValue(0);
  const tone = entityTone(shown, orderedGroups(shop));
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
  return <Animated.View style={[s.itemCategory, { backgroundColor: tone.soft, backfaceVisibility: 'hidden' }, flip]}>
    <Icon name={shop.groups[shown]?.icon ?? 'bag'} color={tone.color} size={20} />
  </Animated.View>;
}

function ItemStack({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  const drag = useContext(ItemDragContext);
  const [height, setHeight] = useState(0);
  const delta = drag?.preview ? itemDragLayout(ids, drag.preview).delta : 0;
  const style = useAnimatedStyle(() => height ? { height: withTiming(Math.max(0, height + delta), { duration: 160, reduceMotion: ReduceMotion.System }) } : {});
  return <Animated.View style={style}><View onLayout={event => setHeight(event.nativeEvent.layout.height)}>{children}</View></Animated.View>;
}

function ItemRow({ shop, id, item, toggle, showCategory = false }: { shop: Shop; id: string; item: Item; toggle: () => void; showCategory?: boolean }) {
  const current = useRef({ shop, item }); current.current = { shop, item };
  const tone = entityTone(item.groupId, orderedGroups(shop));
  const editItem = useContext(ItemEditorContext);
  const preview = useContext(ItemDragContext);
  const shift = preview?.shifts[id] ?? 0;
  const activePreview = Boolean(preview?.preview);
  const motion = useAnimatedStyle(() => ({ transform: [{ translateY: activePreview ? withTiming(shift, { duration: 160, reduceMotion: ReduceMotion.System }) : 0 }] }));
  const drag = useHoldDrag();
  const move = (direction: number) => {
    const ids = activeItems(shop, item.groupId).map(([key]) => key);
    const index = ids.indexOf(id); const to = index + direction;
    if (to < 0 || to >= ids.length) return;
    ids.splice(index, 1); ids.splice(to, 0, id);
    actions.moveItem(shop.id, id, item.groupId, ids[to + 1] ?? null);
  };
  return <Animated.View entering={FadeInUp.duration(420).withInitialValues({ opacity: 0, transform: [{ translateY: -56 }] }).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.System)} exiting={item.done ? FadeOutDown.duration(220).reduceMotion(ReduceMotion.System) : fadeOut} collapsable={false}>
    <DraxView dragHandle animateSnap={false} draggable={!item.done} receptive={!item.done} longPressDelay={DRAG_DELAY} dragActivationFailOffset={12}
      dragPayload={{ kind: 'item', id, shopId: shop.id } satisfies Drag}
      renderHoverContent={({ dimensions }) => <View style={[s.item, { width: dimensions?.width, height: dimensions?.height }]}>
        <View style={s.checkboxTarget}><View style={s.checkbox} /></View>
        {showCategory && <View style={[s.itemCategory, { backgroundColor: tone.soft }]}><Icon name={shop.groups[item.groupId]?.icon ?? 'bag'} color={tone.color} size={20} /></View>}
        <Text style={s.itemName}>{item.name}</Text>
      </View>}
      acceptsDrag={payload => accepts(payload, shop.id) && (payload.kind === 'item' ? payload.id !== id : payload.kind === 'group' && payload.id !== item.groupId)}
      onDragStart={event => { actions.setItemSort('group'); drag.start(); preview?.start(id, event.dragged.measurements?.height ?? 52); }}
      onDrag={() => preview?.over(id, false)}
      onDragEnd={() => { drag.stop(); preview?.stop(); }} onDragDrop={drag.stop}
      onReceiveDragOver={({ receiver, dragged }) => {
        const after = receiver.receiveOffsetRatio.y >= 0.5;
        if (accepts(dragged.payload, shop.id, 'item')) preview?.over(id, after);
      }}
      onReceiveDragDrop={({ dragged, receiver }) => {
        const payload = dragged.payload;
        if (!accepts(payload, shop.id)) return;
        if (payload.kind === 'group') dropGroup(shop, payload.id, item.groupId, receiver.receiveOffsetRatio.y >= 0.5);
        else if (payload.kind === 'item') {
          const { shop: latestShop, item: latestItem } = current.current;
          const ids = activeItems(latestShop, latestItem.groupId).map(([key]) => key).filter(key => key !== payload.id);
          const before = receiver.receiveOffsetRatio.y < 0.5 ? id : ids[ids.indexOf(id) + 1] ?? null;
          commitDrop(() => { actions.moveItem(shop.id, payload.id, current.current.item.groupId, before); preview?.stop(); });
        }
        return DraxSnapbackTargetPreset.None;
      }}
      style={s.itemDrop} draggingStyle={s.itemDragOrigin} hoverDraggingStyle={s.dragging}
     >
      <SwipeToDelete label={item.name} onDelete={() => actions.deleteItem(shop.id, id)} disabled={drag.active} onSwipeStart={drag.suppress} onSwipeEnd={drag.stop}>{action =>
        <Animated.View style={motion}><View style={s.item}>
          <DraxHandle style={StyleSheet.absoluteFill}><View style={s.item}>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.name}, ${item.done ? 'picked up' : 'to get'}`} accessibilityState={{ checked: item.done }}
            onPress={() => { if (!drag.held.current) toggle(); }} onLongPress={() => {}} delayLongPress={DRAG_DELAY} style={s.checkboxTarget}>
            <View style={[s.checkbox, item.done && s.checked]}>{item.done && <Animated.View entering={ZoomIn.duration(160).reduceMotion(ReduceMotion.System)}><Icon name="check" size={15} color={c.white} /></Animated.View>}</View>
          </Pressable>
          {showCategory && <Pressable accessibilityRole="button" accessibilityLabel={`Change category for ${item.name}`}
            accessibilityHint={`Current category: ${shop.groups[item.groupId]?.name ?? 'Unknown'}`} style={s.itemCategoryTouch}
            onPress={() => { if (!drag.held.current) editItem(id); }} onLongPress={() => {}} delayLongPress={DRAG_DELAY}>
            <ItemCategory shop={shop} groupId={item.groupId} />
          </Pressable>}
          <View style={s.flex} pointerEvents="none" />
          <View style={s.itemAction}>{action()}</View>
          </View></DraxHandle>
          <View pointerEvents="box-none" style={[s.itemTextOverlay, { marginLeft: showCategory ? 88 : 44 }]}>
          <Pressable style={s.itemNameTarget} accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`}
            accessibilityHint={item.done ? 'Tap to rename. Swipe left to delete.' : 'Tap the text to edit. Hold elsewhere on the row to move. Swipe left to delete.'}
            accessibilityActions={[{ name: 'delete', label: 'Delete item' }, { name: 'increment', label: 'Move item later' }, { name: 'decrement', label: 'Move item earlier' }]}
            onAccessibilityAction={event => { const name = event.nativeEvent.actionName; if (name === 'delete') actions.deleteItem(shop.id, id); else move(name === 'increment' ? 1 : -1); }}
            onKeyDown={event => { const key = event.nativeEvent as unknown as { altKey?: boolean; key?: string }; if (key.altKey && ['ArrowUp', 'ArrowDown'].includes(key.key ?? '')) { event.preventDefault(); move(key.key === 'ArrowUp' ? -1 : 1); } }}
            onPress={() => { if (!drag.held.current) editItem(id); }} onLongPress={() => {}} delayLongPress={DRAG_DELAY}>
            <Text style={[s.itemName, item.done && s.doneName]}>{item.name}</Text>
          </Pressable>
          </View>
        </View></Animated.View>}
      </SwipeToDelete>
    </DraxView>
  </Animated.View>;
}

function NameEditor({ name, label, save, close, icon, changeIcon, maxLength = 80 }: {
  name: string; label: string; save: (name: string) => void; close: () => void;
  icon?: GroupIcon; changeIcon?: (icon: GroupIcon) => void; maxLength?: number;
}) {
  const draft = useRef(name);
  const [error, setError] = useState('');
  const dismiss = () => { Keyboard.dismiss(); close(); };
  const acceptOutside = () => {
    try { if (draft.current.trim()) save(draft.current); dismiss(); }
    catch (error) { setError((error as Error).message); return false; }
  };
  return <EditingRegion onDismiss={acceptOutside}>
    <View style={s.inlineEditor}>
      <InlineInput initial={name} label={label} placeholder="Name" autoFocus maxLength={maxLength} keepOpen={false} submitLabel="Save name"
        onValueChange={value => { draft.current = value; }} onAdd={value => { save(value); dismiss(); }} />
      {changeIcon && <View style={s.iconGrid}>{GROUP_ICONS.map(option => <Pressable key={option} accessibilityRole="radio"
        accessibilityLabel={`${option} icon`} accessibilityState={{ checked: icon === option }}
        onPress={() => changeIcon(option)} style={[s.iconChoice, icon === option && s.selectedIcon]}>
        <Icon name={option} size={24} />
      </Pressable>)}</View>}
      {Boolean(error) && <Text accessibilityRole="alert" style={ui.errorText}>{error}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel editing" onPress={dismiss} style={s.textButton}><Text style={s.link}>Cancel</Text></Pressable>
    </View>
  </EditingRegion>;
}

function AddStore({ open, close }: { open: (id: string) => void; close: () => void }) {
  const [mode, setMode] = useState<'new' | 'join'>('new');
  const newName = useRef('');
  const create = (name: string) => { const id = actions.addShop(name); Keyboard.dismiss(); close(); open(id); };
  const [joinId, setJoinId] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  async function join() {
    setJoining(true); setError('');
    try { const id = await actions.join(joinId); Keyboard.dismiss(); close(); open(id); }
    catch (error) { setError(errorMessage(error)); }
    finally { setJoining(false); }
  }
  return <EditingRegion onDismiss={() => {
    try { if (mode === 'new' && newName.current.trim()) create(newName.current); else { Keyboard.dismiss(); close(); } }
    catch (error) { setError((error as Error).message); return false; }
  }}><View style={s.addStoreInline}>
    <View style={s.addModes}>
      {(['new', 'join'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={value === 'new' ? 'New store' : 'Join by ID'}
        accessibilityState={{ selected: mode === value }} onPress={() => { setMode(value); setError(''); }} style={[s.addMode, mode === value && s.addModeSelected]}>
        <Icon name={value === 'new' ? 'bag' : 'share'} size={20} /><Text style={s.link}>{value === 'new' ? 'New store' : 'Join by ID'}</Text>
      </Pressable>)}
    </View>
    {mode === 'new' ? <>
      <Text style={s.caption}>Start a list with your usual store groups.</Text>
      <InlineInput label="New store name" placeholder="Store name" autoFocus maxLength={80} keepOpen={false} submitLabel="Create store" onValueChange={name => { newName.current = name; }} onAdd={create} />
    </> : <>
      <Text style={s.caption}>Paste the shop ID someone shared with you.</Text>
      <TextInput accessibilityLabel="Shop ID" placeholder="Shop ID" placeholderTextColor={c.muted} value={joinId} onChangeText={setJoinId}
        style={[ui.input, s.editStoreInput]} autoFocus autoCapitalize="characters" autoCorrect={false} maxLength={40} returnKeyType="go"
        onSubmitEditing={() => { if (joinId.trim() && !joining) void join(); }} />
      <Button label="Join store" busy={joining} disabled={!joinId.trim()} onPress={() => void join()} />
    </>}
    {Boolean(error) && <Text accessibilityRole="alert" style={ui.errorText}>{error}</Text>}
  </View></EditingRegion>;
}

function StoreRow({ shop, shops, open, edit, editing, close }: { shop: Shop; shops: Shop[]; open: (id: string) => void; edit: () => void; editing: boolean; close: () => void }) {
  const drag = useHoldDrag();
  const preview = useContext(ItemDragContext);
  const latestShops = useRef(shops); latestShops.current = shops;
  const shift = preview?.shifts[shop.id] ?? 0;
  const activePreview = Boolean(preview?.preview);
  const motion = useAnimatedStyle(() => ({ transform: [{ translateY: activePreview ? withTiming(shift, { duration: 160, reduceMotion: ReduceMotion.System }) : 0 }] }));
  const tone = entityTone(shop.id, shops.map(shop => shop.id));
  const pending = useShops().data.outbox.some(w => w.shopId === shop.id && w.target === 'shop' && w.data.createdAt);
  const move = (direction: number) => {
    const order = shops.map(s => s.id); const from = order.indexOf(shop.id); const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]]; actions.reorderShops(order);
  };
  return <Animated.View entering={fadeIn} exiting={fadeOut} collapsable={false}>
    {editing ? <NameEditor name={shop.name} label="Edit store name" save={name => actions.renameShop(shop.id, name)} close={close} /> : <DraxView dragHandle style={s.dropTarget} animateSnap={false} longPressDelay={DRAG_DELAY} dragActivationFailOffset={12}
      dragPayload={{ kind: 'store', id: shop.id, shopId: '' } satisfies Drag}
      renderHoverContent={({ dimensions }) => <View style={[s.storeRow, { width: dimensions?.width, height: dimensions?.height }]}>
        <View style={[s.storeBadge, { backgroundColor: tone.soft }]}><Text style={[s.storeInitials, { color: tone.color }]}>{storeInitials(shop.name)}</Text></View><Text style={[s.storeName, { color: tone.color }]}>{shop.name}</Text>
      </View>}
      acceptsDrag={payload => accepts(payload, '', 'store') && payload.id !== shop.id}
      onDragStart={event => { drag.start(); preview?.start(shop.id, event.dragged.measurements?.height ?? 70); }} onDrag={() => preview?.over(shop.id, false)}
      onDragEnd={() => { drag.stop(); preview?.stop(); }} onDragDrop={drag.stop}
      onReceiveDragOver={({ receiver }) => preview?.over(shop.id, receiver.receiveOffsetRatio.y >= 0.5)}
      onReceiveDragDrop={({ dragged, receiver }) => {
        if (!accepts(dragged.payload, '', 'store')) return;
        const source = dragged.payload.id;
        const order = latestShops.current.map(s => s.id).filter(id => id !== source);
        order.splice(order.indexOf(shop.id) + (receiver.receiveOffsetRatio.y >= 0.5 ? 1 : 0), 0, source);
        commitDrop(() => { actions.reorderShops(order); preview?.stop(); }); return DraxSnapbackTargetPreset.None;
      }} draggingStyle={s.itemDragOrigin} hoverDraggingStyle={s.dragging}>
      <SwipeToDelete label={shop.name} onDelete={() => actions.removeShop(shop.id)} disabled={drag.active} onSwipeStart={drag.suppress} onSwipeEnd={drag.stop}>{action =>
        <Animated.View style={motion}><View style={s.storeRow}>
          <DraxHandle style={StyleSheet.absoluteFill}><View style={s.storeDragArea} pointerEvents="box-none">
            <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={`Open ${shop.name} row`}
              onPress={() => { if (!drag.held.current) open(shop.id); }} onLongPress={() => {}} delayLongPress={DRAG_DELAY} />
            <View pointerEvents="none" style={[s.storeBadge, { backgroundColor: tone.soft }]}><Text style={[s.storeInitials, { color: tone.color }]}>{storeInitials(shop.name)}</Text></View>
            <View pointerEvents="none" style={s.flex} />
            {action(<IconButton icon="right" color={tone.color} label={`Open ${shop.name}`} onPress={() => { if (!drag.held.current) open(shop.id); }} />)}
          </View></DraxHandle>
          <View pointerEvents="box-none" style={s.storeTextOverlay}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${shop.name} store`} style={s.nameTouch}
              onPress={() => { if (!drag.held.current) open(shop.id); }} onLongPress={() => { if (!drag.held.current) edit(); }} delayLongPress={DRAG_DELAY}
              accessibilityHint="Hold the name to rename. Hold elsewhere on the row to drag. Swipe left to remove."
              accessibilityActions={[{ name: 'edit', label: 'Rename store' }, { name: 'delete', label: 'Remove store' }, { name: 'increment', label: 'Move store later' }, { name: 'decrement', label: 'Move store earlier' }]}
              onAccessibilityAction={event => { const name = event.nativeEvent.actionName; if (name === 'edit') edit(); else if (name === 'delete') actions.removeShop(shop.id); else move(name === 'increment' ? 1 : -1); }}
              onKeyDown={event => { const key = event.nativeEvent as unknown as { altKey?: boolean; key?: string }; if (key.key === 'F2') edit(); else if (key.altKey && ['ArrowUp', 'ArrowDown'].includes(key.key ?? '')) { event.preventDefault(); move(key.key === 'ArrowUp' ? -1 : 1); } }}>
              <Text numberOfLines={1} style={[s.storeName, { color: tone.color }]}>{shop.name}</Text>
            </Pressable>
            {shop.shared && <Text pointerEvents="none" style={s.sharedLabel}>{pending ? 'Waiting to share' : 'Shared'}</Text>}
          </View>
        </View></Animated.View>}
      </SwipeToDelete>
    </DraxView>}
  </Animated.View>;
}

function ShopList({ open }: { open: (id: string) => void }) {
  const { data } = useShops();
  const [adding, setAdding] = useState(false);
  const order = data.shops.map(shop => shop.id);
  const dragList = useListDrag(order);
  const latestOrder = useRef(order); latestOrder.current = order;
  const [editing, setEditing] = useState<string | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { if (editing) requestAnimationFrame(() => scroll.current?.scrollTo({ y: 0, animated: true })); }, [editing]);
  return <ItemDragContext.Provider value={dragList}><View style={s.flex}>
    <DraxScrollView ref={instance => { scroll.current = instance as unknown as React.ComponentRef<typeof ScrollView>; }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" bounces={false} contentContainerStyle={s.storesContent} style={s.flex}>
      <View style={s.titleRow}><Text accessibilityRole="header" style={s.title}>Stores</Text><IconButton icon="plus" label="Add or join a store" onPress={() => setAdding(true)} filled /></View>
      {adding && <AddStore open={open} close={() => setAdding(false)} />}
      {editing && data.shops.some(shop => shop.id === editing) && <NameEditor name={data.shops.find(shop => shop.id === editing)!.name} label="Edit store name" save={name => actions.renameShop(editing, name)} close={() => setEditing(null)} />}
      <View style={s.storeRows}><ItemStack ids={order}>{data.shops.map(shop => <StoreRow key={shop.id} shop={shop} shops={data.shops} open={open}
        editing={false} edit={() => setEditing(shop.id)} close={() => setEditing(null)} />)}</ItemStack></View>
      <ListTail shopId="" kind="store" last={order.at(-1)} drop={id => actions.reorderShops([...latestOrder.current.filter(key => key !== id), id])} />
      {!data.shops.length && <View style={s.emptyStores}><Icon name="bag" size={32} /><Text style={s.emptyTitle}>Your first store</Text><Text style={s.caption}>Tap + to create a store or join by ID.</Text></View>}
    </DraxScrollView>
  </View></ItemDragContext.Provider>;
}

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
        await Share.share({ title: `Share ${shop.name}`, message: `Join ${shop.name} in Shoppendo.\nShop ID: ${formatCode(code)}` });
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
    <Button label="Share ID" busy={busy} onPress={() => void share()} />
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
      accessibilityState={{ checked: selected === id, selected: selected === id }} onPress={() => select(id)} style={s.categoryTile}>
      <View style={[s.categoryButton, { borderColor: selected === id ? c.text : tone.color, borderWidth: selected === id ? 3 : 1, backgroundColor: tone.color }]}>
        <Icon name={shop.groups[id].icon ?? 'bag'} color={c.white} size={24} />
        {selected === id && <View style={s.selectionBadge}><Icon name="check" color={c.white} size={13} /></View>}
      </View>
      <Text numberOfLines={2} style={[s.categoryTileName, { color: '#171717', fontFamily: selected === id ? f.bold : f.medium }]}>{shop.groups[id].name}</Text>
    </Pressable>;
  })}
    <Pressable accessibilityRole="button" accessibilityLabel="Add category" onPress={add} style={s.categoryTile}>
      <View style={[s.categoryButton, { backgroundColor: c.primary, borderColor: c.primary }]}><Icon name="plus" color={c.white} size={24} /></View>
      <Text numberOfLines={2} style={[s.categoryTileName, { color: '#171717' }]}>Add category</Text>
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
  const order = mergeCategoryOrder(orderedGroups(shop), draft);
  const dragList = useListDrag(order);
  const latest = useRef(order); latest.current = order;
  return <ItemDragContext.Provider value={dragList}><View style={s.categoryOrderPage}>
    <Text style={s.editorHeading}>Category order</Text>
    <Text style={s.caption}>Hold anywhere on a row and drag. Changes apply when you close this panel.</Text>
    <DraxScrollView style={s.flex} contentContainerStyle={{ paddingTop: 12, paddingBottom: 20, flexGrow: 1 }} bounces={false}>
      <ItemStack ids={order}>{order.map(id => <CategoryOrderRow key={id} shop={shop} id={id} order={order} change={change} />)}</ItemStack>
      <ListTail shopId={shop.id} kind="group" last={order.at(-1)} drop={id => change([...latest.current.filter(key => key !== id), id])} />
    </DraxScrollView>
    <Button label="Done sorting categories" onPress={close} />
  </View></ItemDragContext.Provider>;
}

function CategoryOrderRow({ shop, id, order, change }: { shop: Shop; id: string; order: string[]; change: (order: string[]) => void }) {
  const drag = useHoldDrag();
  const preview = useContext(ItemDragContext);
  const shift = preview?.shifts[id] ?? 0;
  const activePreview = Boolean(preview?.preview);
  const motion = useAnimatedStyle(() => ({ transform: [{ translateY: activePreview ? withTiming(shift, { duration: 160, reduceMotion: ReduceMotion.System }) : 0 }] }));
  const latestOrder = useRef(order); latestOrder.current = order;
  const tone = entityTone(id, orderedGroups(shop));
  const group = shop.groups[id];
  const move = (direction: number) => {
    const index = order.indexOf(id); const to = index + direction;
    if (to < 0 || to >= order.length) return;
    const next = [...order]; [next[index], next[to]] = [next[to], next[index]]; change(next);
  };
  const content = <><View style={[s.itemCategory, { backgroundColor: tone.soft }]}><Icon name={group.icon ?? 'bag'} color={tone.color} /></View><Text style={[s.groupName, { color: tone.color }]}>{group.name}</Text></>;
  return <Animated.View><DraxView animateSnap={false} style={s.dropTarget} longPressDelay={DRAG_DELAY} dragActivationFailOffset={12}
    dragPayload={{ kind: 'group', id, shopId: shop.id } satisfies Drag} acceptsDrag={payload => accepts(payload, shop.id, 'group') && payload.id !== id}
    renderHoverContent={({ dimensions }) => <View style={[s.categoryOrderRow, { width: dimensions?.width, height: dimensions?.height }]}>{content}</View>}
    onDragStart={event => { drag.start(); preview?.start(id, event.dragged.measurements?.height ?? 54); }} onDrag={() => preview?.over(id, false)}
    onDragEnd={() => { drag.stop(); preview?.stop(); }} onDragDrop={drag.stop}
    onReceiveDragOver={({ receiver }) => preview?.over(id, receiver.receiveOffsetRatio.y >= 0.5)} draggingStyle={s.itemDragOrigin} hoverDraggingStyle={s.dragging}
    onReceiveDragDrop={({ dragged, receiver }) => {
      const payload = dragged.payload;
      if (accepts(payload, shop.id, 'group')) {
        const next = latestOrder.current.filter(key => key !== payload.id);
        next.splice(next.indexOf(id) + (receiver.receiveOffsetRatio.y >= 0.5 ? 1 : 0), 0, payload.id); commitDrop(() => { change(next); preview?.stop(); });
      }
      return DraxSnapbackTargetPreset.None;
    }}>
    <Animated.View style={motion}><Pressable style={s.categoryOrderRow} accessibilityRole="button" accessibilityLabel={`${group.name} category order`} accessibilityHint="Hold anywhere to drag. Alt+Up or Alt+Down also moves the category."
      accessibilityActions={[{ name: 'increment', label: 'Move later' }, { name: 'decrement', label: 'Move earlier' }]}
      onAccessibilityAction={event => move(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      onKeyDown={event => { const key = event.nativeEvent as unknown as { altKey?: boolean; key?: string }; if (key.altKey && ['ArrowUp','ArrowDown'].includes(key.key ?? '')) { event.preventDefault(); move(key.key === 'ArrowUp' ? -1 : 1); } }}
      onLongPress={() => {}} delayLongPress={DRAG_DELAY}>{content}</Pressable></Animated.View>
  </DraxView></Animated.View>;
}

function useComposerHeight() {
  const dimensions = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', event => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return keyboardHeight ? Math.max(160, dimensions.height - keyboardHeight - 180) : Math.min(380, dimensions.height * 0.55);
}

function NewCategory({ shop, created, close }: { shop: Shop; created: (id: string) => void; close: () => void }) {
  const panelHeight = useComposerHeight();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<GroupIcon>('bag');
  const [error, setError] = useState('');
  const save = (value: string) => {
    const id = actions.addGroup(shop.id, value); actions.editGroup(shop.id, id, value, icon); created(id); close();
  };
  return <EditingRegion onDismiss={() => { try { if (name.trim()) save(name); else close(); } catch (error) { setError((error as Error).message); return false; } }}>
    <ScrollView style={{ maxHeight: panelHeight }} keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false}>
    <Text style={s.editorHeading}>New category</Text>
    {Boolean(error) && <Text accessibilityRole="alert" style={ui.errorText}>{error}</Text>}
    <InlineInput label="New category name" placeholder="Category name" value={name} onValueChange={setName} onAdd={save} autoFocus keepOpen={false} submitLabel="Create category" maxLength={80} />
    <View style={s.iconGrid}>{GROUP_ICONS.map(option => <Pressable key={option} accessibilityRole="radio" accessibilityLabel={`${option} icon`} accessibilityState={{ checked: icon === option, selected: icon === option }} onPress={() => setIcon(option)} style={[s.iconChoice, icon === option && s.selectedIcon]}>
      <Icon name={option} size={24} />{icon === option && <View style={s.selectionBadge}><Icon name="check" color={c.white} size={13} /></View>}
    </Pressable>)}</View>
    <Pressable accessibilityRole="button" accessibilityLabel="Cancel creating category" onPress={close} style={s.textButton}><Text style={s.link}>Cancel</Text></Pressable>
    </ScrollView>
  </EditingRegion>;
}

function AddItem({ shop, close, initialCategory, editingId, onAdded }: { shop: Shop; close: () => void; initialCategory?: string; editingId?: string; onAdded?: (id: string, name: string, groupId: string) => void }) {
  const [addingCategory, setAddingCategory] = useState(false);
  const editing = editingId ? shop.items[editingId] : undefined;
  const { data } = useShops();
  const composerHeight = useComposerHeight();
  const groups = orderedGroups(shop);
  const [category, setCategory] = useState(editing?.groupId ?? initialCategory ?? groups[0] ?? '');
  const [query, setQuery] = useState(editing?.name ?? '');
  const [suggestionsHidden, setSuggestionsHidden] = useState(false);
  const [error, setError] = useState('');
  const draft = useRef(editing?.name ?? '');
  const manualCategory = useRef(Boolean(initialCategory || editing));
  const suggestions = editing || suggestionsHidden ? [] : itemSuggestions(data.shops, shop, query);
  const type = (value: string) => {
    draft.current = value; setQuery(value); setSuggestionsHidden(false); setError('');
    if (!value.trim()) manualCategory.current = Boolean(initialCategory);
    const match = itemSuggestions(data.shops, shop, value)[0];
    if (match && !manualCategory.current) setCategory(match.groupId);
  };
  const add = (name: string) => {
    if (editingId) {
      actions.renameItem(shop.id, editingId, name);
      if (category !== editing?.groupId) actions.moveItem(shop.id, editingId, category, null, true);
      Keyboard.dismiss(); close();
    } else { const id = actions.addItem(shop.id, category, name); onAdded?.(id, name.trim(), category); }
  };
  const acceptOutside = () => {
    if (addingCategory) return false;
    try { if (draft.current.trim()) add(draft.current); Keyboard.dismiss(); close(); }
    catch (error) { setError((error as Error).message); return false; }
  };
  return <EditingRegion onDismiss={acceptOutside}>
    <View style={s.topComposer}><ScrollView style={{ maxHeight: composerHeight }} keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false}>
      {addingCategory ? <NewCategory shop={shop} created={id => { setCategory(id); manualCategory.current = true; }} close={() => setAddingCategory(false)} /> : <>
      <InlineInput label={editing ? "Edit item name" : "New item name"} placeholder="Item name" autoFocus keepOpen={!editing} submitLabel={editing ? "Save item" : "Add item"} onAdd={add}
        value={query} onValueChange={type} />
      {suggestions.length > 0 && <ScrollView style={s.suggestions} keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false}>{suggestions.map(option => <Pressable key={option.name}
        accessibilityRole="button" accessibilityLabel={`Suggest ${option.name}, ${shop.groups[option.groupId].name}`}
        onPress={() => { draft.current = option.name; setQuery(option.name); setCategory(option.groupId); setSuggestionsHidden(true); manualCategory.current = false; }} style={s.suggestion}>
        <Icon name={shop.groups[option.groupId].icon ?? 'bag'} color={entityTone(option.groupId, groups).color} size={19} />
        <Text style={[s.link, s.flex]}>{option.name}</Text><Text style={s.caption}>{shop.groups[option.groupId].name}</Text>
      </Pressable>)}</ScrollView>}
      <Text style={s.selectedCategoryLabel}>Category: {shop.groups[category]?.name ?? 'Choose a category'}</Text>
      <CategoryButtons shop={shop} selected={category} add={() => setAddingCategory(true)} select={id => { manualCategory.current = true; setCategory(id); setError(''); }} />
      <Pressable accessibilityRole="button" accessibilityLabel={editing ? "Cancel editing item" : "Cancel adding item"} style={s.textButton} onPress={() => { Keyboard.dismiss(); close(); }}><Text style={s.link}>Cancel</Text></Pressable>
      {Boolean(error) && <Text accessibilityRole="alert" style={ui.errorText}>{error}</Text>}
    </>} </ScrollView></View>
  </EditingRegion>;
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
    if (direction === 'down') y.value = withTiming(height, { duration: 190, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }, complete);
    else x.value = withTiming(direction === 'left' ? -width : width, { duration: 190, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }, complete);
  };
  const header = usePanGesture({
    enabled, minDistance: 18, maxPointers: 1,
    onActivate: event => { 'worklet'; headerActive.value = true; axis.value = 0; },
    onUpdate: event => { 'worklet'; if (closing.value) return; if (axis.value === 0) axis.value = swipeAxis(event.translationX, event.translationY); if (axis.value === 0) return; if (axis.value === 1) x.value = event.translationX; else y.value = Math.max(0, event.translationY); },
    onDeactivate: event => { 'worklet'; headerActive.value = false; const direction = backSwipeDirection(axis.value === 1 ? event.translationX : 0, axis.value === 2 ? event.translationY : 0, event.velocityX, event.velocityY); if (direction) exit(direction); else reset(); },
    onFinalize: () => { 'worklet'; if (headerActive.value) { headerActive.value = false; reset(); } },
  });
  const edge = usePanGesture({
    enabled, hitSlop: { left: 0, width: 24 }, activeOffsetX: 18, failOffsetY: [-12, 12], maxPointers: 1,
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
  const { data, syncing } = useShops();
  const [newGroup, setNewGroup] = useState(false);
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
  const [arrival, setArrival] = useState<{ id: string; name: string; groupId: string } | null>(null);
  const itemSort = data.itemSort ?? 'group';
  const [itemPreview, setItemPreview] = useState<ItemPreview | null>(null);
  const previewRef = useRef<ItemPreview | null>(null);
  const updatePreview = (next: ItemPreview | null) => { previewRef.current = next; setItemPreview(next); };
  const shifts = itemPreview ? itemDragLayout(listItems(shop, itemSort).map(([id]) => id), itemPreview).shifts : {};
  const itemDrag = { preview: itemPreview, shifts,
    start: (id: string, height: number) => updatePreview({ source: id, target: id, after: false, height }),
    over: (target: string, after: boolean) => { const current = previewRef.current; if (current && (current.target !== target || current.after !== after)) updatePreview({ ...current, target, after }); },
    stop: () => updatePreview(null),
  };
  const shopTone = entityTone(shop.id, data.shops.map(shop => shop.id));
  const page = usePageBack(back, !editingStore && !topAdding && !editingItem && !newGroup && !sortingGroups && !menuOpen);
  const closePage = () => { if (sortingGroups) finishSorting(); else page.close(); };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closePage(); return true; });
    return () => sub.remove();
  }, [page.close, categoryDraft, shop]);
  const [checking, setChecking] = useState<Set<string>>(() => new Set());
  const checkTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => { for (const timer of checkTimers.current.values()) clearTimeout(timer); }, []);
  const toggle = (id: string) => {
    const done = shop.items[id]?.done;
    clearTimeout(checkTimers.current.get(id)); checkTimers.current.delete(id);
    actions.toggleItem(shop.id, id);
    setChecking(previous => { const next = new Set(previous); if (done) next.delete(id); else next.add(id); return next; });
    if (!done) checkTimers.current.set(id, setTimeout(() => {
      checkTimers.current.delete(id);
      setChecking(previous => { const next = new Set(previous); next.delete(id); return next; });
    }, 1000));
  };
  // Persist checks immediately; delay only their visual move so navigating away cannot lose one.
  const displayShop = checking.size ? { ...shop, items: Object.fromEntries(Object.entries(shop.items).map(([id, item]) => [id, checking.has(id) ? { ...item, done: false } : item])) } : shop;
  const groups = orderedGroups(shop);
  const picked = doneItems(shop).filter(([id]) => !checking.has(id));
  const flatItems = listItems(displayShop, itemSort);
  const completed = picked;
  const pending = data.outbox.some(w => w.shopId === shop.id);
  return <Animated.View style={s.flex} entering={SlideInDown.duration(240).easing(Easing.bezier(0.22, 1, 0.36, 1)).reduceMotion(ReduceMotion.System)}><GestureDetector gesture={page.edge} touchAction="pan-y"><Animated.View style={[s.flex, s.shopPage, page.style]}>
    <View style={s.listHeader} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
      <GestureDetector gesture={page.header} touchAction="none"><View style={s.navigation}>
        <IconButton icon="back" label={sortingGroups ? "Back to shop" : "Back to stores"} onPress={closePage} />
        {editingStore ? <View style={s.flex}><NameEditor name={shop.name} label="Edit store name" save={name => actions.renameShop(shop.id, name)} close={() => setEditingStore(false)} /></View> : <View style={s.currentStore}>
          <View style={[s.storeBadge, { backgroundColor: shopTone.soft }]}><Text style={[s.storeInitials, { color: shopTone.color }]}>{storeInitials(shop.name)}</Text></View>
          <Pressable style={s.storeTitleTouch} accessibilityRole="button" accessibilityLabel={`${shop.name} store name`} accessibilityHint="Hold the name to rename"
            onLongPress={() => setEditingStore(true)} delayLongPress={DRAG_DELAY}>
            <Text accessibilityRole="header" numberOfLines={1} style={[s.currentStoreName, { color: shopTone.color }]}>{shop.name}</Text>
          </Pressable>
        </View>}
        {!editingStore && !sortingGroups && <>
          <IconButton icon="plus" label="Add item" color={shopTone.color} filled disabled={!groups.length} onPress={() => setTopAdding(true)} />
          <IconButton icon="share" label="Share shop" onPress={() => { setMenuOpen(false); setSharing(true); }} />
          <IconButton icon="more" label="Shop menu" onPress={() => setMenuOpen(!menuOpen)} />
        </>}
      </View></GestureDetector>
      {menuOpen && <View style={s.menuPosition}><EditingRegion onDismiss={() => setMenuOpen(false)}>
        <Animated.View entering={fadeIn} style={s.viewMenu}>
          <Text style={[s.menuCaption, s.menuShare]}>Sort items</Text>
          {([['group', 'By group'], ['name', 'By name (A–Z)'], ['added', 'By time added (oldest first)']] as const).map(([sort, label]) => <Pressable key={sort} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: itemSort === sort }} style={s.menuOption}
            onPress={() => { actions.setItemSort(sort); setMenuOpen(false); }}>
            <Text style={[s.link, s.flex]}>{label}</Text>{itemSort === sort && <Icon name="check" size={18} />}
          </Pressable>)}
          <Text style={[s.menuCaption, s.menuShare]}>Categories</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Add group" style={s.menuOption} onPress={() => { setMenuOpen(false); setNewGroup(true); }}>
            <Text style={[s.link, s.flex]}>Add group</Text><Icon name="plus" size={18} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Group sorting" style={s.menuOption} onPress={() => { setMenuOpen(false); setCategoryDraft(orderedGroups(shop)); setTopAdding(false); setEditingItem(null); setNewGroup(false); }}>
            <Text style={[s.link, s.flex]}>Group sorting</Text><Icon name="down" size={18} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Share shop ID" style={[s.menuOption, s.menuShare]} onPress={() => { setMenuOpen(false); setSharing(true); }}>
            <Text style={[s.link, s.flex]}>Share shop ID</Text><Icon name="share" size={18} />
          </Pressable>
        </Animated.View>
      </EditingRegion></View>}
      {newGroup && <View style={s.topComposer}><NewCategory shop={shop} created={() => {}} close={() => setNewGroup(false)} /></View>}
      {(topAdding || editingItem) && <AddItem key={editingItem ?? 'new'} shop={shop} editingId={editingItem ?? undefined}
        onAdded={(id, name, groupId) => setArrival({ id, name, groupId })} close={() => { setTopAdding(false); setEditingItem(null); }} />}
      {shop.shared && !sortingGroups && <Text accessibilityLiveRegion="polite" style={s.syncStatus}>{syncing ? 'Syncing…' : pending ? 'Saved here · waiting to sync' : 'Shared list'}</Text>}
    </View>
    {sortingGroups ? <CategoryOrder shop={shop} draft={categoryDraft} change={setCategoryDraft} close={finishSorting} /> : <ItemEditorContext.Provider value={id => { setEditingItem(id); setTopAdding(false); }}><ItemDragContext.Provider value={itemDrag}><GestureDetector gesture={page.body} touchAction="pan-y"><View style={s.flex}><ShopScroll page={page}>
      <View>
        <ItemStack ids={flatItems.map(([id]) => id)}>{flatItems.map(([id]) => <ItemRow key={id} shop={shop} id={id} item={shop.items[id]} showCategory toggle={() => toggle(id)} />)}</ItemStack>
        {!flatItems.length && groups.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Add an item to the list" style={s.emptyList} onPress={() => setTopAdding(true)}>
          <Icon name="bag" size={28} /><Text style={s.caption}>{picked.length ? 'Nothing left to pick up' : 'Add your first item'}</Text>
        </Pressable>}
      </View>
      {!groups.length && <View style={s.noGroups}><Text style={s.emptyTitle}>Start with a group</Text><Text style={s.caption}>Use ⋯ → Add group to create your first category.</Text></View>}
      <ListTail shopId={shop.id} kind="item" last={flatItems.at(-1)?.[0]} drop={id => {
        const groupId = flatItems.at(-1)?.[1].groupId ?? shop.items[id]?.groupId;
        if (groupId) actions.moveItem(shop.id, id, groupId);
      }} />
      <View>
        {completed.length > 0 && <View style={s.doneSection}><Text style={s.doneLabel}>Done</Text>{completed.map(([id]) => <ItemRow key={id} shop={shop} id={id} item={shop.items[id]} showCategory toggle={() => toggle(id)} />)}</View>}
      </View>
    </ShopScroll></View></GestureDetector></ItemDragContext.Provider></ItemEditorContext.Provider>}
    {arrival && !sortingGroups && <ItemArrival key={arrival.id} shop={shop} item={arrival} start={76} end={headerHeight + 16} close={() => setArrival(null)} />}
    {sharing && <ShareShop shop={shop} replaced={replaced} close={() => setSharing(false)} />}
  </Animated.View></GestureDetector></Animated.View>;
}

function Main() {
  const { data, ready, error, undo } = useShops();
  const [selected, setSelected] = useState<string | null>(null);
  const shop = data.shops.find(s => s.id === selected);
  useEffect(() => { void load(); }, []);
  if (!ready) return <View style={s.loading}><Icon name="bag" size={36} />{error ? <><Text style={s.caption}>{error}</Text><Button label="Try again" onPress={() => void load()} /></> : <ActivityIndicator color={c.primary} />}</View>;
  return <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
    {Boolean(error) && <View accessibilityRole="alert" style={s.errorBanner}><Text style={[s.caption, s.flex]}>{error}</Text><Pressable accessibilityRole="button" onPress={() => { actions.clearError(); void actions.retry().catch(() => {}); }} style={s.retry}><Text style={s.link}>Retry</Text></Pressable></View>}
    <View style={s.flex}>
      <View {...(Platform.OS === 'web' ? { inert: Boolean(shop) } : {})} style={s.flex} pointerEvents={shop ? 'none' : 'auto'} accessibilityElementsHidden={Boolean(shop)} importantForAccessibility={shop ? 'no-hide-descendants' : 'auto'} aria-hidden={Boolean(shop)}><ShopList open={setSelected} /></View>
      {shop && <View style={StyleSheet.absoluteFill}><ShoppingList key={shop.id} shop={shop} replaced={setSelected} back={() => setSelected(null)} /></View>}
    </View>
    {undo && <Animated.View entering={fadeIn} exiting={fadeOut} style={s.undoBanner} accessibilityLiveRegion="polite">
      <Text numberOfLines={1} style={s.undoLabel}>{undo.label}</Text><Pressable accessibilityRole="button" accessibilityLabel="Undo deletion" onPress={actions.undo} style={s.undoButton}><Text style={s.undoText}>Undo</Text></Pressable>
    </Animated.View>}
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
      {fontsLoaded || fontError || Platform.OS === 'web' ? <EditingSurface><Main /></EditingSurface> : <View style={s.loading}><ActivityIndicator color={c.primary} /></View>}
    </SafeAreaView><DragOverlay />
  </DraxProvider></SafeAreaProvider></GestureHandlerRootView>;
}

const s = StyleSheet.create({
  categoryOrderPage: { flex: 1, backgroundColor: c.white, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, gap: 8 },
  itemArrival: { position: 'absolute', left: 12, right: 12, top: 0, zIndex: 1000, elevation: 40, backgroundColor: c.white, borderRadius: 12, borderWidth: 1, borderColor: c.border, minHeight: 54, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: c.text, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  categoryOrderRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  selectedCategoryLabel: { fontFamily: f.semibold, fontSize: 12, color: c.text, paddingTop: 8 },
  editorHeading: { fontFamily: f.semibold, fontSize: 17, color: c.text, marginBottom: 6 },
  selectionBadge: { position: 'absolute', right: -5, top: -5, width: 21, height: 21, borderRadius: 11, borderWidth: 2, borderColor: c.white, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center' },
  shopPage: { backgroundColor: c.white },
  categoryTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  categoryTile: { width: 64, alignItems: 'center', gap: 5, paddingBottom: 4 },
  categoryTileName: { fontFamily: f.medium, fontSize: 10, lineHeight: 13, minHeight: 26, textAlign: 'center', width: '100%' },
  root: { flex: 1, backgroundColor: c.background }, flex: { flex: 1 },
  safe: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', backgroundColor: c.white },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 },
  currentStore: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  storeTitleTouch: { flexShrink: 1, justifyContent: 'center' },
  currentStoreName: { fontFamily: f.bold, fontSize: 22, lineHeight: 28, includeFontPadding: false, color: c.text },
  itemAction: { width: 44, minHeight: 48, justifyContent: 'center' },
  nameTouch: { alignSelf: 'flex-start', maxWidth: '100%' },
  storeTextOverlay: { position: 'absolute', left: 50, right: 52, top: 0, bottom: 0, justifyContent: 'center' },
  groupTextOverlay: { position: 'absolute', left: 44, right: 104, top: 0, bottom: 0, justifyContent: 'center' },
  storeDragArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  storeOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  addModes: { flexDirection: 'row', gap: 10 }, addMode: { flex: 1, minHeight: 62, borderWidth: 1, borderColor: c.border, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addModeSelected: { backgroundColor: c.primarySoft, borderColor: c.primary },
  dropTarget: { borderWidth: 1, borderColor: 'transparent', borderRadius: 12 },
  undoBanner: { position: 'absolute', bottom: 16, left: 16, right: 16, borderRadius: 14, backgroundColor: c.text, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, gap: 12, elevation: 6 },
  undoLabel: { flex: 1, fontFamily: f.medium, fontSize: 13, color: c.white }, undoButton: { minHeight: 50, minWidth: 62, alignItems: 'center', justifyContent: 'center' }, undoText: { fontFamily: f.bold, fontSize: 14, color: '#B9E0C5' },
  storesContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 38, paddingBottom: 48 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  title: { fontFamily: f.bold, fontSize: 29, lineHeight: 38, color: c.text, flexShrink: 1 },
  storeRows: { marginTop: 28 }, storeRow: { minHeight: 68, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: c.border },
  storeNameWrap: { flex: 1, gap: 4 }, storeName: { fontFamily: f.medium, color: c.text, fontSize: 18 }, sharedLabel: { fontFamily: f.medium, color: c.secondary, fontSize: 11 },
  storeBadge: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  storeInitials: { fontFamily: f.bold, fontSize: 14, color: c.primary },
  emptyStores: { alignItems: 'center', paddingVertical: 32, gap: 10 }, emptyTitle: { fontFamily: f.semibold, fontSize: 18, color: c.text },
  caption: { fontFamily: f.regular, fontSize: 13, color: c.muted, lineHeight: 20 },
  textButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  dangerText: { color: c.danger, fontFamily: f.medium, fontSize: 15 }, link: { color: c.primary, fontFamily: f.medium, fontSize: 14 },
  editStoreInput: { flex: undefined, borderWidth: 1, borderColor: c.border, borderRadius: 10 },
  listHeader: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, zIndex: 10 },
  menuPosition: { position: 'absolute', top: 62, right: 12, zIndex: 20 },
  viewMenu: { width: 208, padding: 8, backgroundColor: c.white, borderRadius: 14, borderWidth: 1, borderColor: c.border, elevation: 8, shadowColor: c.text, shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
  menuCaption: { fontFamily: f.medium, color: c.muted, fontSize: 12, paddingHorizontal: 10, paddingVertical: 6 },
  menuOption: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 },
  menuShare: { borderTopWidth: 1, borderTopColor: c.border, marginTop: 4 },
  topComposer: { marginTop: 8, padding: 10, backgroundColor: c.primarySoft, borderRadius: 12 },
  itemCategory: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySoft, borderRadius: 9, marginRight: 10 },
  itemCategoryTouch: { minWidth: 44, minHeight: 48, justifyContent: 'center' },
  itemCategoryPicker: { paddingHorizontal: 10, paddingBottom: 4, backgroundColor: c.primarySoft, borderRadius: 12 },
  categoryButton: { width: 44, height: 44, borderWidth: 1, borderColor: c.border, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: c.white },
  categoryCaption: { fontFamily: f.medium, fontSize: 12, color: c.primary, paddingTop: 6 },
  suggestions: { maxHeight: 96, borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 4 },
  suggestion: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 },
  emptyList: { alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 160 },
  navigation: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 52 },
  shareLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }, shareText: { fontFamily: f.medium, fontSize: 14, color: c.secondary },
  syncStatus: { fontFamily: f.regular, fontSize: 11, color: c.muted, marginTop: 4 }, listContent: { flexGrow: 1, paddingHorizontal: 12, paddingBottom: 40 },
  group: { paddingBottom: 16, backgroundColor: c.white, borderRadius: 12 },
  dragging: { backgroundColor: c.white, borderRadius: 12, zIndex: 1000, borderWidth: 1, borderColor: c.border, elevation: 24, shadowColor: c.text, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  itemDragOrigin: { opacity: 0 },
  dragOrigin: { opacity: 0.25 }, groupReceiving: { backgroundColor: c.primarySoft, borderColor: c.primary },
  itemDrop: { borderTopWidth: 2, borderBottomWidth: 2, borderColor: 'transparent', borderRadius: 5 },
  dropBefore: { borderTopColor: c.primary, borderBottomColor: 'transparent', backgroundColor: c.primarySoft }, dropAfter: { borderTopColor: 'transparent', borderBottomColor: c.primary, backgroundColor: c.primarySoft },
  groupIcon: { backgroundColor: c.primarySoft, width: 36, height: 36, borderRadius: 10 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  inlineEditor: { paddingHorizontal: 4, backgroundColor: c.white }, addStoreInline: { paddingTop: 16, gap: 12 },
  iconChoice: { width: 44, minHeight: 44, borderWidth: 1.5, borderColor: c.border, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4 },
  selectedIcon: { borderColor: c.primary, backgroundColor: c.primarySoft }, iconLabel: { fontFamily: f.medium, fontSize: 10, color: c.muted, textTransform: 'capitalize' },
  editActions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  groupHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52 }, groupHeaderTarget: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 5 },
  groupName: { flexShrink: 1, fontFamily: f.semibold, fontSize: 17, color: c.text }, item: { flexDirection: 'row', minHeight: 48, alignItems: 'center' },
  checkboxTarget: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, checkbox: { width: 19, height: 19, borderWidth: 1.8, borderColor: c.muted, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: c.primary, borderColor: c.primary }, itemTextOverlay: { flex: 1, marginRight: 44, justifyContent: 'center', minHeight: 48 }, itemNameTarget: { alignSelf: 'flex-start', maxWidth: '100%' },
  itemName: { fontFamily: f.regular, fontSize: 16, color: c.text, lineHeight: 23 }, doneName: { color: c.muted, textDecorationLine: 'line-through' },
  emptyGroup: { minHeight: 44, justifyContent: 'center', paddingLeft: 25 }, noGroups: { gap: 10, paddingVertical: 26 },
  addGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, marginTop: 2 },
  doneSection: { marginTop: 14, paddingTop: 16, borderTopWidth: 1, borderColor: c.border }, doneLabel: { fontFamily: f.medium, fontSize: 13, color: c.muted, marginBottom: 4 },
  idBox: { backgroundColor: c.secondarySoft, borderRadius: 14, padding: 18, gap: 10 }, idLabel: { fontFamily: f.bold, color: c.secondary, fontSize: 10, letterSpacing: 1 },
  idCode: { fontFamily: f.bold, color: c.secondary, fontSize: 18, lineHeight: 28 }, shareActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  shareLoading: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorBanner: { backgroundColor: c.secondarySoft, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingVertical: 12 },
  retry: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
