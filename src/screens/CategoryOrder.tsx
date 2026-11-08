// Picking order page: drag categories into a store's route.
import { useContext, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { DraxView, DraxHandle, DraxSnapbackTargetPreset } from 'react-native-drax';
import Animated from 'react-native-reanimated';
import { actions } from '../store';
import { orderedGroups, mergeCategoryOrder, type Shop } from '../model';
import { Icon, SwipeToDelete, FloatingAddButton, ui } from '../ui';
import { colors as c, entityTone } from '../theme';
import { dragOrder } from '../interaction';
import { CATEGORY_GAP, s } from '../styles';
import { type Drag, accepts, DRAG_DELAY, useHoldDrag, ItemDragContext, trace, hoverFrame, useListDrag, useRowMotion, ListTail } from '../drag';
import { usePageBack, ShopScroll } from '../page';
import { NewCategory } from '../components/ItemEditor';

export function CategoryOrder({ shop, draft, change, close }: { shop: Shop; draft: string[]; change: (order: string[]) => void; close: () => void }) {
  const [editor, setEditor] = useState<string | null>(null);
  const order = useMemo(() => mergeCategoryOrder(orderedGroups(shop), draft), [shop.groups, shop.groupOrder, draft]);
  const dragList = useListDrag(order, chosen => { const next = dragOrder(order, chosen); if (next !== order) change(next); }, 'manual', CATEGORY_GAP);
  const page = usePageBack(close, !dragList.dragging && !editor);
  return <ItemDragContext.Provider value={dragList}><GestureDetector gesture={page.edge} touchAction="pan-y"><Animated.View style={[s.flex, s.shopPage, page.style]}>
    <GestureDetector gesture={page.header} touchAction="none"><View style={s.orderHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${shop.name}`} onPress={page.close} style={s.orderBack} hitSlop={8}>
        <Icon name="back" size={20} color={c.text} /><Text numberOfLines={1} style={s.orderBackLabel}>{shop.name}</Text>
      </Pressable>
      <Text accessibilityRole="header" style={s.orderTitle}>Picking order</Text>
      <Text style={s.orderSubtitle}>Drag categories to match your route.</Text>
      <View style={s.orderSectionRow}>
        <Text numberOfLines={1} style={s.orderSection}>For {shop.name}</Text>
        <Text numberOfLines={1} style={s.orderSectionNote}>Each store keeps its own order.</Text>
      </View>
    </View></GestureDetector>
    <GestureDetector gesture={page.body} touchAction="pan-y"><View style={s.categoryOrderPage}>
    <ShopScroll page={page} horizontalPadding={16}>
      <View style={{ gap: CATEGORY_GAP }}>{order.map((id, index) => <CategoryOrderRow key={id} shop={shop} id={id} index={index} order={order} change={change} edit={() => setEditor(id)} />)}</View>
      <ListTail shopId={shop.id} kind="group" last={order.at(-1)} />
      {!order.length && <Text style={[s.caption, { marginBottom: 12 }]}>Add your first category to organize this store.</Text>}
    </ShopScroll>
    </View></GestureDetector>
    {!editor && <FloatingAddButton label="Add category" onPress={() => setEditor('new')} />}
    {editor && (editor === 'new' || order.includes(editor)) && <NewCategory key={editor} shop={shop} editingId={editor === 'new' ? undefined : editor} created={() => {}} close={() => setEditor(null)} />}
  </Animated.View></GestureDetector></ItemDragContext.Provider>;
}

export function CategoryOrderRow({ shop, id, index, order, change, edit }: { shop: Shop; id: string; index: number; order: string[]; change: (order: string[]) => void; edit: () => void }) {
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
    <View style={s.orderNumber}><Text style={s.orderNumberText}>{index + 1}</Text></View>
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
        <Pressable style={s.categoryRowLabel} accessibilityRole="button" accessibilityLabel={`${index + 1}. Edit ${group.name} category`} accessibilityHint="Tap to edit. Hold anywhere to drag. Swipe left to delete. Alt+Up or Alt+Down also moves the category."
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
