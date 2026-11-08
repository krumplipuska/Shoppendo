// Home screen: the list of stores and the Add store sheet.
import { memo, useContext, useCallback, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DraxView, DraxHandle, DraxScrollView } from 'react-native-drax';
import Animated from 'react-native-reanimated';
import { actions, errorMessage, getShopSnapshot, useShops } from '../store';
import { storeInitials, type Shop } from '../model';
import { Button, Icon, IconButton, EditingRegion, Sheet, SwipeToDelete, FloatingAddButton, ui } from '../ui';
import { colors as c } from '../theme';
import { dragOrder } from '../interaction';
import { STORE_GAP, s } from '../styles';
import { type Drag, accepts, DRAG_DELAY, fadeIn, fadeOut, useHoldDrag, EntryAnimation, useEntryGate, ItemDragContext, trace, hoverFrame, useListDrag, useRowMotion, ListTail } from '../drag';
import { ShareShop } from '../components/ShareShop';
import { Tutorial } from '../components/Tutorial';

export function AddStore({ open, close }: { open: (id: string) => void; close: () => void }) {
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
export const StoreRow = memo(function StoreRow({ shop, open, share }: { shop: Shop; open: (id: string) => void; share: (id: string) => void }) {
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

export const ShopList = memo(function ShopList({ open }: { open: (id: string) => void }) {
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
  const [tutorial, setTutorial] = useState(false);
  return <EntryAnimation.Provider value={entryGate}><ItemDragContext.Provider value={dragList}><View style={s.storesPage}>
    <View style={s.homeHeader}><View style={s.titleRow}><View style={s.flex}><Text accessibilityRole="header" style={s.title}>Stores</Text><Text style={s.homeSubtitle}>A picking order for every store.</Text></View>
      <IconButton icon="info" label="How Shoppendo works" onPress={() => setTutorial(true)} style={s.infoButton} />
    </View></View>
    <DraxView style={s.flex} draggable={false} receptive={false} onMeasure={dragList.measureViewport}><DraxScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" bounces={false} contentContainerStyle={s.storesContent} style={s.flex}>
      <View style={s.storeRows}>{data.shops.map(shop => <StoreRow key={shop.id} shop={shop} open={open} share={setSharing} />)}</View>
      <ListTail shopId="" kind="store" last={order.at(-1)} />
      {!data.shops.length && <View style={s.emptyStores}><Icon name="bag" size={32} /><Text style={s.emptyTitle}>Your first store</Text><Text style={s.caption}>Tap + to create a store or join by ID.</Text></View>}
    </DraxScrollView></DraxView>
    {!adding && <FloatingAddButton label="Add store" accessibilityLabel="Add or join a store" onPress={() => setAdding(true)} />}
    {adding && <AddStore open={open} close={() => setAdding(false)} />}
    {sharedShop && <ShareShop shop={sharedShop} replaced={setSharing} close={() => setSharing(null)} />}
    {tutorial && <Tutorial close={() => setTutorial(false)} />}
  </View></ItemDragContext.Provider></EntryAnimation.Provider>;
});
