// One store's list: header, menu, items, missing and done sections.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { DraxProvider } from 'react-native-drax';
import Animated, { SlideInDown, Easing, ReduceMotion, useSharedValue, useAnimatedStyle, cancelAnimation, withDelay, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { actions, getShopSnapshot, useShops } from '../store';
import { doneItems, missingItems, itemDropSlot, listItems, orderedGroups, mergeCategoryOrder, type Shop } from '../model';
import { Icon, IconButton, EditingRegion, FloatingAddButton } from '../ui';
import { colors as c, entityTone } from '../theme';
import { s } from '../styles';
import { fadeIn, ItemEditorContext, EntryAnimation, useEntryGate, ItemDragContext, useListDrag, ListTail } from '../drag';
import { usePageBack, ShopScroll } from '../page';
import { StoreBanner } from '../components/StoreBanner';
import { ItemRow } from '../components/ItemRow';
import { ShareShop } from '../components/ShareShop';
import { AddItem } from '../components/ItemEditor';
import { CategoryOrder } from './CategoryOrder';
import { AllItems } from './AllItems';

export function ItemArrival({ shop, item, close, start, end }: { shop: Shop; item: { name: string; groupId: string }; close: () => void; start: number; end: number }) {
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
export function ShoppingList({ shop, back, replaced, onBannerHeight }: { shop: Shop; back: () => void; replaced: (id: string) => void; onBannerHeight?: (height: number) => void }) {
  const { data } = useShops();
  const [sharing, setSharing] = useState(false);
  const [editingStore, setEditingStore] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [topAdding, setTopAdding] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<string[] | null>(null);
  const sortingGroups = categoryDraft !== null;
  const [allItemsOpen, setAllItemsOpen] = useState(false);
  // A full-page overlay (Picking order or All items) covers the list: keep the list inert underneath.
  const overlayOpen = sortingGroups || allItemsOpen;
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
  const [flaggedItem, setFlaggedItem] = useState<string | null>(null);
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
  const page = usePageBack(back, !itemDrag.dragging && !editingStore && !topAdding && !editingItem && !overlayOpen && !menuOpen);
  const closePage = () => { if (sortingGroups) finishSorting(); else if (allItemsOpen) setAllItemsOpen(false); else page.close(); };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closePage(); return true; });
    return () => sub.remove();
  }, [page.close, categoryDraft, shop, allItemsOpen]);
  const completed = picked;
  return <Animated.View style={s.flex} entering={SlideInDown.duration(240).easing(Easing.bezier(0.22, 1, 0.36, 1)).reduceMotion(ReduceMotion.System)}>
    <View style={s.flex} {...(Platform.OS === 'web' ? { inert: overlayOpen } : {})}
      pointerEvents={overlayOpen ? 'none' : 'auto'} accessibilityElementsHidden={overlayOpen}
      importantForAccessibility={overlayOpen ? 'no-hide-descendants' : 'auto'} aria-hidden={overlayOpen}>
    <GestureDetector gesture={page.edge} touchAction="pan-y"><Animated.View style={[s.flex, s.shopPage, page.style]}>
    <View style={s.listHeader} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
      <GestureDetector gesture={page.header} touchAction="none"><View style={s.pageHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to stores" onPress={closePage} style={s.headerBack}>
          <Icon name="back" />
        </Pressable>
        <View style={s.headerCopy}>
          {editingStore ? <TextInput accessibilityLabel="Store name" autoFocus selectTextOnFocus defaultValue={shop.name}
            style={[s.title, { padding: 0, lineHeight: undefined, height: 40 }]} maxLength={80} returnKeyType="done" submitBehavior="submit"
            onSubmitEditing={event => {
              const name = event.nativeEvent.text.trim();
              if (!name) return;
              if (name !== shop.name) actions.renameShop(shop.id, name);
              setEditingStore(false);
            }} onBlur={() => setEditingStore(false)} /> : <Text accessibilityRole="header" numberOfLines={1} style={s.title}>{shop.name}</Text>}
        </View>
        <View style={s.headerActions}>
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
      <Pressable accessibilityRole="button" accessibilityLabel="Store order, edit picking order" onPress={startSorting}
        style={({ pressed }) => [s.storeOrderBar, pressed && { opacity: 0.7 }]}>
        <Icon name="groupSort" size={20} color={c.text} />
        <Text style={[s.storeOrderLabel, s.flex]}>Store order</Text>
        <Text style={s.storeOrderEdit}>Edit</Text>
      </Pressable>
      {menuOpen && <View style={s.menuPosition}><EditingRegion onDismiss={() => setMenuOpen(false)}>
        <Animated.View entering={fadeIn} style={s.viewMenu}>
          <Pressable accessibilityRole="button" style={s.menuOption} onPress={() => { setMenuOpen(false); setEditingStore(true); }}>
            <Text style={s.link}>Rename store</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="All items" accessibilityHint="Shows every item this store has had, to add one back." style={s.menuOption}
            onPress={() => { setMenuOpen(false); setTopAdding(false); setEditingItem(null); setAllItemsOpen(true); }}>
            <Text style={[s.link, s.flex]}>All items</Text><Icon name="right" size={18} />
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
          {([['missing', 'Remove missing items', missing.length], ['done', 'Remove done items', completed.length]] as const).map(([section, label, count], index) =>
            <Pressable key={section} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="You can undo right after."
              disabled={!count} style={({ pressed }) => [s.menuOption, index === 0 && s.menuShare, pressed && { opacity: 0.7 }, !count && { opacity: 0.4 }]}
              onPress={() => { setMenuOpen(false); actions.clearItems(shop.id, section); }}>
              <Text style={[s.link, s.flex, { color: c.danger }]}>{label}</Text><Icon name={section === 'missing' ? 'missing' : 'check'} size={18} color={c.danger} />
            </Pressable>)}
          <Pressable accessibilityRole="button" accessibilityLabel="Remove all items from the list" accessibilityHint="Empties the list. You can undo right after."
            disabled={!(flatItems.length + missing.length + completed.length)} style={({ pressed }) => [s.menuOption, pressed && { opacity: 0.7 },
              !(flatItems.length + missing.length + completed.length) && { opacity: 0.4 }]}
            onPress={() => { setMenuOpen(false); actions.clearItems(shop.id); }}>
            <Text style={[s.link, s.flex, { color: c.danger }]}>Remove all items</Text><Icon name="trash" size={18} color={c.danger} />
          </Pressable>
        </Animated.View>
      </EditingRegion></View>}
    </View>
    {/* The list and Add item button share the space above the banner, so neither covers the ad. */}
    <View style={s.flex}>
    <EntryAnimation.Provider value={entryGate}><ItemEditorContext.Provider value={editItem}><ItemDragContext.Provider value={itemDrag}><GestureDetector gesture={page.body} touchAction="pan-y"><View style={s.flex}><ShopScroll page={page}>
      <View>
        <View style={flatItems.length ? s.itemPanel : undefined}>{flatItems.map(([id]) => <ItemRow key={id} shopId={shop.id} groups={shop.groups} order={groups} id={id} item={shop.items[id]} showCategory manualOrder={itemSort === 'group'} toggle={toggle} flagged={flaggedItem === id} />)}</View>
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
    </View>
    <StoreBanner onHeight={onBannerHeight} />
    {arrival && !overlayOpen && <ItemArrival key={arrival.id} shop={shop} item={arrival} start={76} end={headerHeight + 16} close={() => setArrival(null)} />}
      {(topAdding || editingItem) && <AddItem key={editingItem ?? 'new'} shop={shop} editingId={editingItem ?? undefined}
        onAdded={(id, name, groupId) => setArrival({ id, name, groupId })} onDuplicate={setFlaggedItem}
        close={() => { setTopAdding(false); setEditingItem(null); setFlaggedItem(null); }} />}
    {sharing && <ShareShop shop={shop} replaced={replaced} close={() => setSharing(false)} />}
    </Animated.View></GestureDetector></View>
    {sortingGroups && <Animated.View style={StyleSheet.absoluteFill} entering={SlideInDown.duration(240).easing(Easing.bezier(0.22, 1, 0.36, 1)).reduceMotion(ReduceMotion.System)}>
      <DraxProvider><CategoryOrder shop={shop} draft={categoryDraft!} change={setCategoryDraft} close={finishSorting} /></DraxProvider>
    </Animated.View>}
    {allItemsOpen && <Animated.View style={StyleSheet.absoluteFill} entering={SlideInDown.duration(240).easing(Easing.bezier(0.22, 1, 0.36, 1)).reduceMotion(ReduceMotion.System)}>
      <DraxProvider><AllItems shop={shop} close={() => setAllItemsOpen(false)} /></DraxProvider>
    </Animated.View>}
  </Animated.View>;
}
