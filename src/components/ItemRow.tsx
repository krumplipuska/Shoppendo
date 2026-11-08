// A single shopping list row with its category capsule.
import { memo, useContext, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { DraxView, DraxHandle } from 'react-native-drax';
import Animated, { FadeInUp, FadeOutDown, ZoomIn, Easing, ReduceMotion, useSharedValue, useAnimatedStyle, cancelAnimation, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';
import { actions, getShopSnapshot } from '../store';
import { activeItems, type Item, type Shop } from '../model';
import { Icon, SwipeToDelete } from '../ui';
import { colors as c, entityTone } from '../theme';
import { s } from '../styles';
import { type Drag, accepts, DRAG_DELAY, fadeOut, useHoldDrag, ItemEditorContext, EntryAnimation, ItemDragContext, trace, hoverFrame, useRowMotion } from '../drag';

export type GroupInfo = { groups: Shop['groups']; order: string[] };
export function CategoryBadge({ groups, order, id }: GroupInfo & { id: string }) {
  const tone = entityTone(id, order);
  return <View style={[s.itemCategoryCapsule, { backgroundColor: tone.soft }]}>
    <Icon name={groups[id]?.icon ?? 'bag'} color={tone.color} size={16} />
    <Text numberOfLines={1} ellipsizeMode="tail" style={[s.itemCategoryName, { color: tone.color }]}>{groups[id]?.name ?? 'Unknown'}</Text>
  </View>;
}

export function ItemDragPreview({ groups, order, item }: GroupInfo & { item: Item }) {
  return <View style={s.item}>
    <View style={[StyleSheet.absoluteFill, s.item]}><View style={s.checkboxTarget}><View style={s.checkbox} /></View></View>
    <View style={s.itemTextOverlay}><View style={s.itemNameTarget}><Text style={s.itemName}>{item.name}</Text></View>
      <View style={[s.itemCategoryAction, { justifyContent: 'center' }]}><CategoryBadge groups={groups} order={order} id={item.groupId} /></View>
    </View>
    <View style={s.itemDivider} />
  </View>;
}

export function ItemCategory({ groups, order, groupId }: GroupInfo & { groupId: string }) {
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
export const ItemRow = memo(function ItemRow({ shopId, groups, order, id, item, toggle, showCategory = false, manualOrder = true, flagged = false }: GroupInfo & {
  shopId: string; id: string; item: Item; toggle: (id: string) => void; showCategory?: boolean; manualOrder?: boolean; flagged?: boolean;
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
        <View style={[s.item, item.missing && s.missingRow, flagged && s.flaggedRow]}>
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
            <Text style={[s.itemName, item.done && s.doneName, flagged && { color: c.danger }]}>{item.name}</Text>
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
