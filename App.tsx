import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureDetector, GestureHandlerRootView, GestureStateManager, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, FadeOut, SlideInDown, Easing, ReduceMotion, useSharedValue, useAnimatedStyle, cancelAnimation, withDelay, withTiming } from 'react-native-reanimated';
import { useFonts } from 'expo-font';
import * as Clipboard from 'expo-clipboard';
import { actions, errorMessage, load, useShops } from './src/store';
import { activeItems, doneItems, formatCode, GROUP_ICONS, itemSuggestions, listItems, orderedGroups, mergeCategoryOrder, storeInitials, type GroupIcon, type Item, type Shop } from './src/model';
import { Button, Icon, IconButton, EditingRegion, EditingSurface, useFinishEditing, InlineInput, Sheet, SwipeToDelete, FloatingAddButton, ui } from './src/ui';
import { colors as c, fonts as f, entityTone } from './src/theme';

import { runOnJS } from 'react-native-worklets';
import { backSwipeDirection, swipeAxis, shouldStartListPull } from './src/interaction';
import { ReorderList, useReorderTap } from './src/reorder-list';
import { HOLD_MS as DRAG_DELAY } from './src/reorder';
import { shopLink, shopCodeFromLink } from './src/links';

const fadeIn = FadeIn.duration(150).reduceMotion(ReduceMotion.System);
const fadeOut = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
const ItemEditorContext = createContext<(id: string) => void>(() => {});

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
  return <Animated.View style={[s.itemCategoryCapsule, { backgroundColor: tone.soft, backfaceVisibility: 'hidden' }, flip]}>
    <Icon name={shop.groups[shown]?.icon ?? 'bag'} color={tone.color} size={16} />
    <Text numberOfLines={1} ellipsizeMode="tail" style={[s.itemCategoryName, { color: tone.color }]}>{shop.groups[shown]?.name ?? 'Unknown'}</Text>
  </Animated.View>;
}

function ItemRow({ shop, id, item, toggle, showCategory = false, manualOrder = true }: { shop: Shop; id: string; item: Item; toggle: () => void; showCategory?: boolean; manualOrder?: boolean }) {
  const editItem = useContext(ItemEditorContext);
  const reorderTap = useReorderTap();
  const move = (direction: number) => {
    if (!manualOrder) return;
    const ids = activeItems(shop, item.groupId).map(([key]) => key);
    const index = ids.indexOf(id); const to = index + direction;
    if (to < 0 || to >= ids.length) return;
    ids.splice(index, 1); ids.splice(to, 0, id);
    actions.moveItem(shop.id, id, item.groupId, ids[to + 1] ?? null);
  };
  return <SwipeToDelete label={item.name} onDelete={() => actions.deleteItem(shop.id, id)}>{action =>
    <View style={s.item}>
      <Pressable {...reorderTap} accessibilityRole="checkbox" accessibilityLabel={`${item.name}, ${item.done ? 'picked up' : 'to get'}`} accessibilityState={{ checked: item.done }}
        onPress={toggle} style={s.checkboxTarget}>
        <View style={[s.checkbox, item.done && s.checked]}>{item.done && <Icon name="check" size={15} color={c.white} />}</View>
      </Pressable>
      <Pressable style={[s.flex, s.itemNameTarget]} accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`}
        accessibilityHint={manualOrder && !item.done ? 'Tap to edit. Hold to move. Swipe left to delete.' : 'Tap to edit. Swipe left to delete.'}
        accessibilityActions={[{ name: 'delete', label: 'Delete item' }, { name: 'increment', label: 'Move item later' }, { name: 'decrement', label: 'Move item earlier' }]}
        onAccessibilityAction={event => { const name = event.nativeEvent.actionName; if (name === 'delete') actions.deleteItem(shop.id, id); else move(name === 'increment' ? 1 : -1); }}
        onKeyDown={event => { const key = event.nativeEvent as unknown as { altKey?: boolean; key?: string }; if (key.altKey && ['ArrowUp', 'ArrowDown'].includes(key.key ?? '')) { event.preventDefault(); move(key.key === 'ArrowUp' ? -1 : 1); } }}
        onPress={() => editItem(id)} onLongPress={() => {}} delayLongPress={DRAG_DELAY}>
        <Text style={[s.itemName, item.done && s.doneName]}>{item.name}</Text>
      </Pressable>
      {action(showCategory && <Pressable {...reorderTap} accessibilityRole="button" accessibilityLabel={`Change category for ${item.name}`}
        accessibilityHint={`Current category: ${shop.groups[item.groupId]?.name ?? 'Unknown'}`} style={{ minHeight: 60, justifyContent: 'center' }} onPress={() => editItem(id)}>
        <ItemCategory shop={shop} groupId={item.groupId} />
      </Pressable>, s.itemCategoryAction)}
    </View>}
  </SwipeToDelete>;
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
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const focusInput = useCallback(() => { requestAnimationFrame(() => input.current?.focus()); }, []);
  const scrollY = useRef(0);
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
  return <Sheet visible compact title="Add store" canSwipeDown={() => scrollY.current <= 1} onShow={focusInput} onClose={() => { Keyboard.dismiss(); close(); }}>
    <EditingRegion style={{ flexShrink: 1 }}><ScrollView style={{ maxHeight: 260, flexShrink: 1 }} keyboardShouldPersistTaps="handled" bounces={false}
      onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} contentContainerStyle={s.addStoreForm}>
    <View style={s.addModes}>
      {(['new', 'join'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={value === 'new' ? 'New store' : 'Join by ID'}
        accessibilityState={{ selected: mode === value }} onPress={() => { setMode(value); setError(''); focusInput(); }} style={[s.addMode, mode === value && s.addModeSelected]}>
        <Icon name={value === 'new' ? 'bag' : 'share'} size={20} /><Text style={s.link}>{value === 'new' ? 'New store' : 'Join by ID'}</Text>
      </Pressable>)}
    </View>
    {mode === 'new' ? <>
      <Text style={s.caption}>Start a list with your usual store groups.</Text>
      <View style={s.composerInput}><InlineInput inputRef={input} label="New store name" placeholder="Store name" maxLength={80} keepOpen={false} submitLabel="Create store" onAdd={create} /></View>
    </> : <>
      <Text style={s.caption}>Paste the shop ID someone shared with you.</Text>
      <TextInput ref={input} accessibilityLabel="Shop ID" placeholder="Shop ID" placeholderTextColor={c.muted} value={joinId} onChangeText={setJoinId}
        style={[ui.input, s.editStoreInput]} autoCapitalize="characters" autoCorrect={false} maxLength={40} returnKeyType="go"
        onSubmitEditing={() => { if (joinId.trim() && !joining) void join(); }} />
      <Button label="Join store" busy={joining} disabled={!joinId.trim()} onPress={() => void join()} />
    </>}
    {Boolean(error) && <Text accessibilityRole="alert" style={ui.errorText}>{error}</Text>}
  </ScrollView></EditingRegion></Sheet>;
}

function StoreRow({ shop, shops, open, share, edit, editing, close }: { shop: Shop; shops: Shop[]; open: (id: string) => void; share: () => void; edit: () => void; editing: boolean; close: () => void }) {
  const tone = entityTone(shop.id, shops.map(shop => shop.id));
  const move = (direction: number) => {
    const order = shops.map(s => s.id); const from = order.indexOf(shop.id); const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]]; actions.reorderShops(order);
  };
  return editing ? <NameEditor name={shop.name} label="Edit store name" save={name => actions.renameShop(shop.id, name)} close={close} /> :
    <SwipeToDelete label={shop.name} onDelete={() => actions.removeShop(shop.id)}>{action =>
      <View style={s.storeRow}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={`Open ${shop.name} row`} onPress={() => open(shop.id)} onLongPress={() => {}} delayLongPress={DRAG_DELAY} />
        <View pointerEvents="none" style={[s.storeBadge, { backgroundColor: tone.soft }]}><Text style={[s.storeInitials, { color: tone.color }]}>{storeInitials(shop.name)}</Text></View>
        <Pressable style={s.flex} accessibilityRole="button" accessibilityLabel={`Open ${shop.name} store`} onPress={() => open(shop.id)} onLongPress={() => {}} delayLongPress={DRAG_DELAY}
          accessibilityHint="Tap to open. Hold to move. Swipe left to remove. Open the shop menu to rename."
          accessibilityActions={[{ name: 'edit', label: 'Rename store' }, { name: 'delete', label: 'Remove store' }, { name: 'increment', label: 'Move store later' }, { name: 'decrement', label: 'Move store earlier' }]}
          onAccessibilityAction={event => { const name = event.nativeEvent.actionName; if (name === 'edit') edit(); else if (name === 'delete') actions.removeShop(shop.id); else move(name === 'increment' ? 1 : -1); }}
          onKeyDown={event => { const key = event.nativeEvent as unknown as { altKey?: boolean; key?: string }; if (key.key === 'F2') edit(); else if (key.altKey && ['ArrowUp', 'ArrowDown'].includes(key.key ?? '')) { event.preventDefault(); move(key.key === 'ArrowUp' ? -1 : 1); } }}>
          <Text numberOfLines={1} style={s.storeName}>{shop.name}</Text>
        </Pressable>
        <IconButton icon="share" color={tone.color} solid={shop.shared} label={`Share ${shop.name}${shop.shared ? ', shared store' : ''}`} onPress={share} />
        {action(<IconButton icon="right" color={tone.color} label={`Open ${shop.name}`} onPress={() => open(shop.id)} />)}
      </View>}
    </SwipeToDelete>;
}

function ShopList({ open }: { open: (id: string) => void }) {
  const { data } = useShops();
  const [adding, setAdding] = useState(false);
  const order = data.shops.map(shop => shop.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const sharedShop = data.shops.find(shop => shop.id === sharing);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { if (editing) requestAnimationFrame(() => scroll.current?.scrollTo({ y: 0, animated: true })); }, [editing]);
  return <View style={s.flex}>
    <View style={s.homeHeader}><View style={s.titleRow}><View style={s.flex}><Text accessibilityRole="header" style={s.title}>Stores</Text></View></View></View>
    <ReorderList ids={order} scrollRef={scroll} contentContainerStyle={s.storesContent}
      onDragStart={actions.beginDrag} onDragEnd={actions.endDrag} onReorder={({ order }) => actions.reorderShops(order)}
      header={editing && data.shops.some(shop => shop.id === editing) && <NameEditor name={data.shops.find(shop => shop.id === editing)!.name} label="Edit store name" save={name => actions.renameShop(editing, name)} close={() => setEditing(null)} />}
      renderRow={id => { const shop = data.shops.find(shop => shop.id === id)!; return <StoreRow shop={shop} shops={data.shops} open={open} share={() => setSharing(shop.id)} editing={false} edit={() => setEditing(shop.id)} close={() => setEditing(null)} />; }}
      footer={!data.shops.length && <View style={s.emptyStores}><Icon name="bag" size={32} /><Text style={s.emptyTitle}>Your first store</Text><Text style={s.caption}>Tap + to create a store or join by ID.</Text></View>} />
    {!adding && <FloatingAddButton label="Add store" accessibilityLabel="Add or join a store" onPress={() => setAdding(true)} />}
    {adding && <AddStore open={open} close={() => setAdding(false)} />}
    {sharedShop && <ShareShop shop={sharedShop} replaced={setSharing} close={() => setSharing(null)} />}
  </View>;
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
    <Button icon="share" label="Share link" busy={busy} onPress={() => void share()} />
    {shop.shared && <>
      <Button icon="stop" label="Stop sharing" secondary disabled={busy} onPress={() => void stop()} />
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
      <View style={[s.categoryButton, { borderColor: selected === id ? tone.color : 'transparent', borderWidth: selected === id ? 2 : 1, backgroundColor: tone.soft }]}>
        <Icon name={shop.groups[id].icon ?? 'bag'} color={tone.color} size={24} />
        {selected === id && <View style={s.selectionBadge}><Icon name="check" color={c.white} size={13} /></View>}
      </View>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[s.categoryTileName, { color: c.text, fontFamily: selected === id ? f.bold : f.medium }]}>{shop.groups[id].name}</Text>
    </Pressable>;
  })}
    <Pressable accessibilityRole="button" accessibilityLabel="Add category" onPress={add} style={s.categoryTile}>
      <View style={[s.categoryButton, { backgroundColor: c.primary, borderColor: c.primary }]}><Icon name="plus" color={c.white} size={24} /></View>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[s.categoryTileName, { color: c.text }]}>Add category</Text>
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
  const changeOrder = (next: string[]) => { actions.reorder(shop.id, next); change(next); };
  return <View style={s.categoryOrderPage}>
    <Text style={s.editorHeading}>Category order</Text>
    <Text style={s.caption}>Hold anywhere on a row and drag to change the order.</Text>
    <ReorderList ids={order} contentContainerStyle={{ paddingTop: 12, paddingBottom: 20, flexGrow: 1 }}
      onDragStart={actions.beginDrag} onDragEnd={actions.endDrag} onReorder={({ order }) => changeOrder(order)}
      renderRow={id => <CategoryOrderRow shop={shop} id={id} order={order} change={changeOrder} />} />
    <Button label="Done sorting categories" onPress={close} />
  </View>;
}

function CategoryOrderRow({ shop, id, order, change }: { shop: Shop; id: string; order: string[]; change: (order: string[]) => void }) {
  const tone = entityTone(id, orderedGroups(shop));
  const group = shop.groups[id];
  const move = (direction: number) => {
    const index = order.indexOf(id); const to = index + direction;
    if (to < 0 || to >= order.length) return;
    const next = [...order]; [next[index], next[to]] = [next[to], next[index]]; change(next);
  };
  const mark = <><View style={[s.itemCategory, { backgroundColor: tone.soft }]}><Icon name={group.icon ?? 'bag'} color={tone.color} /></View><Text style={[s.groupName, { color: tone.color }]}>{group.name}</Text></>;
  return <Pressable style={s.categoryOrderRow} accessibilityRole="button" accessibilityLabel={`${group.name} category order`} accessibilityHint="Hold anywhere to drag. Alt+Up or Alt+Down also moves the category."
      accessibilityActions={[{ name: 'increment', label: 'Move later' }, { name: 'decrement', label: 'Move earlier' }]}
      onAccessibilityAction={event => move(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      onKeyDown={event => { const key = event.nativeEvent as unknown as { altKey?: boolean; key?: string }; if (key.altKey && ['ArrowUp','ArrowDown'].includes(key.key ?? '')) { event.preventDefault(); move(key.key === 'ArrowUp' ? -1 : 1); } }}
      onLongPress={() => {}} delayLongPress={DRAG_DELAY}>{mark}</Pressable>;
}

function NewCategory({ shop, created, close, embedded = false, scrollOffset }: {
  shop: Shop; created: (id: string) => void; close: () => void; embedded?: boolean; scrollOffset?: React.RefObject<number>;
}) {
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const focusInput = useCallback(() => { requestAnimationFrame(() => input.current?.focus()); }, []);
  const ownScroll = useRef(0); const scrollY = scrollOffset ?? ownScroll;
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<GroupIcon>('bag');
  const finish = () => { if (!embedded) Keyboard.dismiss(); close(); };
  const save = (value: string) => {
    const id = actions.addGroup(shop.id, value); actions.editGroup(shop.id, id, value, icon); created(id); finish();
  };
  const form = <EditingRegion style={{ flexShrink: 1 }}>
    <ScrollView style={{ maxHeight: 260, flexShrink: 1 }} keyboardShouldPersistTaps="handled" bounces={false}
      onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
      <View style={s.composerInput}><InlineInput inputRef={input} label="New category name" placeholder="Category name" value={name} onValueChange={setName} onAdd={save}
        autoFocus={embedded} keepOpen={false} submitLabel="Create category" maxLength={80} /></View>
      <View style={s.iconGrid}>{GROUP_ICONS.map(option => <Pressable key={option} accessibilityRole="radio" accessibilityLabel={`${option} icon`}
        accessibilityState={{ checked: icon === option, selected: icon === option }} onPress={() => setIcon(option)} style={[s.iconChoice, icon === option && s.selectedIcon]}>
        <Icon name={option} size={24} />{icon === option && <View style={s.selectionBadge}><Icon name="check" color={c.white} size={13} /></View>}
      </Pressable>)}</View>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel creating category" onPress={finish} style={s.textButton}><Text style={s.link}>Cancel</Text></Pressable>
    </ScrollView>
  </EditingRegion>;
  return embedded ? form : <Sheet visible compact title="Add category" canSwipeDown={() => scrollY.current <= 1} onShow={focusInput}
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
  const manualCategory = useRef(Boolean(initialCategory || editing));
  const suggestions = editing || suggestionsHidden ? [] : itemSuggestions(data.shops, shop, query);
  const type = (value: string) => {
    setQuery(value); setSuggestionsHidden(false); setError('');
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
  return <Sheet visible compact canSwipeDown={() => scrollY.current <= 1} title={addingCategory ? 'Add category' : editing ? 'Edit item' : 'Add item'} onShow={focusInput} onClose={() => { Keyboard.dismiss(); close(); }}><EditingRegion style={{ flexShrink: 1 }}>
    {addingCategory ? <NewCategory embedded scrollOffset={scrollY} shop={shop} created={id => { setCategory(id); manualCategory.current = true; }}
      close={() => { setAddingCategory(false); scrollY.current = 0; focusInput(); }} /> : <View style={s.itemComposer}><ScrollView onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} style={{ maxHeight: 260, flexShrink: 1 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false}>
      <View style={s.composerInput}><InlineInput inputRef={input} label={editing ? "Edit item name" : "New item name"} placeholder={editing ? "Item name" : "Add item…"} keepOpen={!editing} submitLabel={editing ? "Save item" : "Add item"} onAdd={add}
        value={query} onValueChange={type} /></View>
      {suggestions.length > 0 && <ScrollView style={s.suggestions} keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false}>{suggestions.map(option => <Pressable key={option.name}
        accessibilityRole="button" accessibilityLabel={`Suggest ${option.name}, ${shop.groups[option.groupId].name}`}
        onPress={() => { setQuery(option.name); setCategory(option.groupId); setSuggestionsHidden(true); manualCategory.current = false; }} style={s.suggestion}>
        <Icon name={shop.groups[option.groupId].icon ?? 'bag'} color={entityTone(option.groupId, groups).color} size={19} />
        <Text style={[s.link, s.flex]}>{option.name}</Text><Text style={s.caption}>{shop.groups[option.groupId].name}</Text>
      </Pressable>)}</ScrollView>}
      <Text style={s.selectedCategoryLabel}>Category: {shop.groups[category]?.name ?? 'Choose a category'}</Text>
      <CategoryButtons shop={shop} selected={category} add={() => { scrollY.current = 0; setAddingCategory(true); }} select={id => { manualCategory.current = true; setCategory(id); setError(''); }} />
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
  const { data } = useShops();
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
  const startSorting = () => { setMenuOpen(false); setCategoryDraft(orderedGroups(shop)); setTopAdding(false); setEditingItem(null); setNewGroup(false); };
  const [arrival, setArrival] = useState<{ id: string; name: string; groupId: string } | null>(null);
  const itemSort = data.itemSort ?? 'group';
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
    clearTimeout(checkTimers.current.get(id)); checkTimers.current.delete(id);
    const done = actions.toggleItem(shop.id, id);
    setChecking(previous => { const next = new Set(previous); if (done) next.add(id); else next.delete(id); return next; });
    if (done) checkTimers.current.set(id, setTimeout(() => {
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
  return <Animated.View style={s.flex} entering={SlideInDown.duration(240).easing(Easing.bezier(0.22, 1, 0.36, 1)).reduceMotion(ReduceMotion.System)}><GestureDetector gesture={page.edge} touchAction="pan-y"><Animated.View style={[s.flex, s.shopPage, page.style]}>
    <View style={s.listHeader} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
      <GestureDetector gesture={page.header} touchAction="none"><View style={s.navigation}>
        <IconButton icon="back" label={sortingGroups ? "Back to shop" : "Back to stores"} onPress={closePage} />
        {editingStore ? <View style={s.flex}><NameEditor name={shop.name} label="Edit store name" save={name => actions.renameShop(shop.id, name)} close={() => setEditingStore(false)} /></View> : <View style={s.currentStore}>
          <Pressable style={s.storeTitleTouch} accessibilityRole="button" accessibilityLabel={`${shop.name} store name`} accessibilityHint="Hold the name to rename"
            onLongPress={() => setEditingStore(true)} delayLongPress={DRAG_DELAY}>
            <Text accessibilityRole="header" numberOfLines={1} style={s.currentStoreName}>{shop.name}</Text>
          </Pressable>
        </View>}
        {!editingStore && !sortingGroups && <View style={s.headerActions}>
          <IconButton icon="groupSort" label="Sort groups" disabled={groups.length < 2} onPress={startSorting} />
          <IconButton icon="share" solid={shop.shared} label="Share shop" onPress={() => { setMenuOpen(false); setSharing(true); }} />
          <IconButton icon="more" label="Shop menu" onPress={() => setMenuOpen(!menuOpen)} />
        </View>}
      </View></GestureDetector>
      {menuOpen && <View style={s.menuPosition}><EditingRegion onDismiss={() => setMenuOpen(false)}>
        <Animated.View entering={fadeIn} style={s.viewMenu}>
          <Text style={[s.menuCaption, s.menuShare]}>Sort items</Text>
          <Text style={s.menuCaption}>Choose By group to drag items.</Text>
          {([['group', 'By group'], ['name', 'By name (A–Z)'], ['added', 'By time added (oldest first)']] as const).map(([sort, label]) => <Pressable key={sort} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: itemSort === sort }} style={s.menuOption}
            onPress={() => { actions.setItemSort(sort); setMenuOpen(false); }}>
            <Text style={[s.link, s.flex]}>{label}</Text>{itemSort === sort && <Icon name="check" size={18} />}
          </Pressable>)}
          <Pressable accessibilityRole="button" accessibilityLabel="Rename store" style={s.menuOption} onPress={() => { setMenuOpen(false); setEditingStore(true); }}>
            <Text style={s.link}>Rename store</Text>
          </Pressable>
          <Text style={[s.menuCaption, s.menuShare]}>Categories</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Add group" style={s.menuOption} onPress={() => { setMenuOpen(false); setNewGroup(true); }}>
            <Text style={[s.link, s.flex]}>Add group</Text><Icon name="plus" size={18} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Group sorting" style={s.menuOption} onPress={startSorting}>
            <Text style={[s.link, s.flex]}>Group sorting</Text><Icon name="groupSort" size={18} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Share shop ID" style={[s.menuOption, s.menuShare]} onPress={() => { setMenuOpen(false); setSharing(true); }}>
            <Text style={[s.link, s.flex]}>Share shop ID</Text><Icon name="share" size={18} />
          </Pressable>
        </Animated.View>
      </EditingRegion></View>}
    </View>
    {sortingGroups ? <CategoryOrder shop={shop} draft={categoryDraft} change={setCategoryDraft} close={finishSorting} /> : <ItemEditorContext.Provider value={id => { setEditingItem(id); setTopAdding(false); }}><GestureDetector gesture={page.body} touchAction="pan-y"><View style={s.flex}>
      <ReorderList ids={flatItems.map(([id]) => id)} enabled={itemSort === 'group' && checking.size === 0}
        scrollY={page.scrollY} simultaneousWith={page.body} contentContainerStyle={s.listContent}
        onDragStart={actions.beginDrag} onDragEnd={actions.endDrag}
        onReorder={({ id, order, from, to }) => {
          const neighbor = order[to > from ? to - 1 : to + 1];
          const target = shop.items[neighbor];
          if (!target || target.deleted) return;
          const group = activeItems(shop, target.groupId).map(([key]) => key).filter(key => key !== id);
          const before = to > from ? group[group.indexOf(neighbor) + 1] ?? null : neighbor;
          actions.moveItem(shop.id, id, target.groupId, before);
        }}
        renderRow={id => <ItemRow shop={shop} id={id} item={shop.items[id]} showCategory manualOrder={itemSort === 'group'} toggle={() => toggle(id)} />}
        footer={<>
          {!flatItems.length && groups.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Add an item to the list" style={s.emptyList} onPress={() => setTopAdding(true)}>
            <Icon name="bag" size={28} /><Text style={s.caption}>{picked.length ? 'Nothing left to pick up' : 'Add your first item'}</Text>
          </Pressable>}
          {!groups.length && <View style={s.noGroups}><Text style={s.emptyTitle}>Start with a group</Text><Text style={s.caption}>Use the shop menu to create your first category.</Text></View>}
          {completed.length > 0 && <View style={s.doneSection}><Text style={s.doneLabel}>Done</Text>{completed.map(([id]) => <ItemRow key={id} shop={shop} id={id} item={shop.items[id]} showCategory manualOrder={false} toggle={() => toggle(id)} />)}</View>}
        </>} />
    </View></GestureDetector></ItemEditorContext.Provider>}
    {!sortingGroups && !topAdding && !editingItem && <FloatingAddButton label="Add item" disabled={!groups.length} onPress={() => setTopAdding(true)} />}
    {arrival && !sortingGroups && <ItemArrival key={arrival.id} shop={shop} item={arrival} start={76} end={headerHeight + 16} close={() => setArrival(null)} />}
      {(topAdding || editingItem) && <AddItem key={editingItem ?? 'new'} shop={shop} editingId={editingItem ?? undefined}
        onAdded={(id, name, groupId) => setArrival({ id, name, groupId })} close={() => { setTopAdding(false); setEditingItem(null); }} />}
    {newGroup && <NewCategory shop={shop} created={() => {}} close={() => setNewGroup(false)} />}
    {sharing && <ShareShop shop={shop} replaced={replaced} close={() => setSharing(false)} />}
  </Animated.View></GestureDetector></Animated.View>;
}

function Main() {
  const { data, ready, error, undo } = useShops();
  const [selected, setSelected] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string } | null>(null);
  const [joining, setJoining] = useState(false);
  const [linkError, setLinkError] = useState('');
  const shop = data.shops.find(s => s.id === selected);
  useEffect(() => { void load(); }, []);
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
  if (!ready) return <View style={s.loading}><Icon name="bag" size={36} />{error ? <><Text style={s.caption}>{error}</Text><Button label="Try again" onPress={() => void load()} /></> : <ActivityIndicator color={c.primary} />}</View>;
  return <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
    {joining && <View style={s.errorBanner}><ActivityIndicator color={c.primary} /><Text accessibilityLiveRegion="polite" style={s.caption}>Opening shared store…</Text></View>}
    {Boolean(linkError) && <View accessibilityRole="alert" style={s.errorBanner}><Text style={[s.caption, s.flex]}>{linkError}</Text>{invite && <Pressable accessibilityRole="button" style={s.retry} onPress={() => setInvite({ ...invite })}><Text style={s.link}>Retry</Text></Pressable>}</View>}
    {Platform.OS === 'web' && invite && <View style={s.errorBanner}><Text style={[s.caption, s.flex]}>Have Shoppendo installed?</Text><Pressable accessibilityRole="link" style={s.retry} onPress={() => { void Linking.openURL(`shoppendo://join/${invite.code}`).catch(() => setLinkError('Could not open the app. You can use this store in your browser.')); }}><Text style={s.link}>Open app</Text></Pressable></View>}
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
  return <GestureHandlerRootView style={s.root}><SafeAreaProvider><StatusBar style="dark" />
    <SafeAreaView style={s.safe} edges={['top']}><SafeAreaView style={s.content} edges={['bottom']}>
      {fontsLoaded || fontError || Platform.OS === 'web' ? <EditingSurface><Main /></EditingSurface> : <View style={s.loading}><ActivityIndicator color={c.primary} /></View>}
    </SafeAreaView></SafeAreaView>
  </SafeAreaProvider></GestureHandlerRootView>;
}

const s = StyleSheet.create({
  categoryOrderPage: { flex: 1, backgroundColor: c.white, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, gap: 8 },
  itemArrival: { position: 'absolute', left: 12, right: 12, top: 0, zIndex: 1000, elevation: 40, backgroundColor: c.white, borderRadius: 12, borderWidth: 1, borderColor: c.border, minHeight: 54, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: c.text, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  categoryOrderRow: { backgroundColor: c.white, minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  selectedCategoryLabel: { fontFamily: f.semibold, fontSize: 12, color: c.text, paddingTop: 8 },
  editorHeading: { fontFamily: f.semibold, fontSize: 17, color: c.text, marginBottom: 6 },
  selectionBadge: { position: 'absolute', right: -5, top: -5, width: 21, height: 21, borderRadius: 11, borderWidth: 2, borderColor: c.white, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center' },
  shopPage: { backgroundColor: c.white },
  categoryTiles: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 4, rowGap: 8, paddingTop: 8 },
  categoryTile: { width: 44, alignItems: 'center', gap: 5, paddingBottom: 4 },
  categoryTileName: { fontFamily: f.medium, fontSize: 10, lineHeight: 13, minHeight: 13, textAlign: 'center', width: '100%' },
  root: { flex: 1, backgroundColor: c.background }, flex: { flex: 1 },
  safe: { flex: 1, width: '100%', maxWidth: 520, alignSelf: 'center', backgroundColor: c.header },
  content: { flex: 1, backgroundColor: c.white },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 },
  currentStore: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  storeTitleTouch: { flexShrink: 1, justifyContent: 'center' },
  currentStoreName: { fontFamily: f.bold, fontSize: 22, lineHeight: 28, includeFontPadding: false, color: c.text },
  nameTouch: { alignSelf: 'flex-start', maxWidth: '100%' },
  groupTextOverlay: { position: 'absolute', left: 44, right: 104, top: 0, bottom: 0, justifyContent: 'center' },
  storeOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  addModes: { flexDirection: 'row', gap: 10 }, addMode: { flex: 1, minHeight: 62, borderWidth: 1, borderColor: c.border, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addModeSelected: { backgroundColor: c.primarySoft, borderColor: c.primary },
  undoBanner: { position: 'absolute', bottom: 16, left: 16, right: 16, borderRadius: 14, backgroundColor: c.text, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, gap: 12, elevation: 6 },
  undoLabel: { flex: 1, fontFamily: f.medium, fontSize: 13, color: c.white }, undoButton: { minHeight: 50, minWidth: 62, alignItems: 'center', justifyContent: 'center' }, undoText: { fontFamily: f.bold, fontSize: 14, color: '#B9E0C5' },
  storesContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 112 },
  homeHeader: { backgroundColor: c.header, borderBottomWidth: 1, borderBottomColor: c.border, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  title: { fontFamily: f.bold, fontSize: 32, lineHeight: 40, color: c.text, flexShrink: 1 },
  storeRows: { gap: 12 }, storeRow: { minHeight: 92, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: '#F0F5EE', borderRadius: 20 },
  storeNameWrap: { flex: 1, gap: 4 }, storeName: { fontFamily: f.bold, color: c.text, fontSize: 18 },
  storeBadge: { width: 52, height: 52, borderRadius: 16, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  storeInitials: { fontFamily: f.bold, fontSize: 20, color: c.primary },
  emptyStores: { alignItems: 'center', paddingVertical: 32, gap: 10 }, emptyTitle: { fontFamily: f.semibold, fontSize: 18, color: c.text },
  caption: { fontFamily: f.regular, fontSize: 13, color: c.muted, lineHeight: 20 },
  textButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  dangerText: { color: c.danger, fontFamily: f.medium, fontSize: 15 }, link: { color: c.primary, fontFamily: f.medium, fontSize: 14 },
  editStoreInput: { flex: undefined, borderWidth: 1, borderColor: c.border, borderRadius: 10 },
  listHeader: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 8, zIndex: 10, backgroundColor: c.header, borderBottomWidth: 1, borderBottomColor: c.border },
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
  groupIcon: { backgroundColor: c.primarySoft, width: 36, height: 36, borderRadius: 10 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  inlineEditor: { paddingHorizontal: 4, backgroundColor: c.white }, addStoreForm: { gap: 12 },
  iconChoice: { width: 44, minHeight: 44, borderWidth: 1.5, borderColor: c.border, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4 },
  selectedIcon: { borderColor: c.primary, backgroundColor: c.primarySoft }, iconLabel: { fontFamily: f.medium, fontSize: 10, color: c.muted, textTransform: 'capitalize' },
  editActions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  groupHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52 }, groupHeaderTarget: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 5 },
  groupName: { flexShrink: 1, fontFamily: f.semibold, fontSize: 17, color: c.text }, item: { backgroundColor: c.white, flexDirection: 'row', minHeight: 64, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.border },
  checkboxTarget: { width: 44, minHeight: 64, alignItems: 'center', justifyContent: 'center' }, checkbox: { width: 22, height: 22, borderWidth: 1.8, borderColor: c.muted, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: c.primary, borderColor: c.primary }, itemNameTarget: { justifyContent: 'center', minHeight: 64, maxWidth: '100%', paddingVertical: 10 },
  itemName: { fontFamily: f.medium, fontSize: 18, color: c.text, lineHeight: 23 }, doneName: { color: c.muted, textDecorationLine: 'line-through' },
  emptyGroup: { minHeight: 44, justifyContent: 'center', paddingLeft: 25 }, noGroups: { gap: 10, paddingVertical: 26 },
  addGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, marginTop: 2 },
  doneSection: { marginTop: 14, paddingTop: 16, borderTopWidth: 1, borderColor: c.border }, doneLabel: { fontFamily: f.medium, fontSize: 13, color: c.muted, marginBottom: 4 },
  idBox: { backgroundColor: c.secondarySoft, borderRadius: 14, padding: 18, gap: 10 }, idLabel: { fontFamily: f.bold, color: c.secondary, fontSize: 10, letterSpacing: 1 },
  idCode: { fontFamily: f.bold, color: c.secondary, fontSize: 18, lineHeight: 28 }, shareActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  shareLoading: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorBanner: { backgroundColor: c.secondarySoft, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingVertical: 12 },
  retry: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
