// Every item a store has had, in store order, with a quick + to put one back on the list.
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { actions } from '../store';
import { orderedGroups, storeItems, type Shop, type StoreItem } from '../model';
import { Icon, IconButton, SwipeToDelete } from '../ui';
import { colors as c } from '../theme';
import { s } from '../styles';
import { fadeIn } from '../drag';
import { usePageBack, ShopScroll } from '../page';
import { CategoryBadge } from '../components/ItemRow';

type Note = 'added' | 'duplicate';

export function AllItems({ shop, close }: { shop: Shop; close: () => void }) {
  const items = useMemo(() => storeItems(shop), [shop]);
  const order = useMemo(() => orderedGroups(shop), [shop.groups, shop.groupOrder]);
  // Notes describe an item that is on the list now; they disappear once it leaves the list.
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const page = usePageBack(close, true);
  const add = (entry: StoreItem) => {
    const { result } = actions.quickAdd(shop.id, entry.name, entry.groupId);
    setNotes(previous => ({ ...previous, [entry.key]: result === 'duplicate' ? 'duplicate' : 'added' }));
  };
  return <GestureDetector gesture={page.edge} touchAction="pan-y"><Animated.View style={[s.flex, s.shopPage, page.style]}>
    <GestureDetector gesture={page.header} touchAction="none"><View style={s.orderHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${shop.name}`} onPress={page.close} style={s.orderBack} hitSlop={8}>
        <Icon name="back" size={20} color={c.text} /><Text numberOfLines={1} style={s.orderBackLabel}>{shop.name}</Text>
      </Pressable>
      <Text accessibilityRole="header" style={s.orderTitle}>All items</Text>
      <Text style={s.orderSubtitle}>Tap + to add an item back to your list. Swipe left to delete it from the store.</Text>
    </View></GestureDetector>
    <GestureDetector gesture={page.body} touchAction="pan-y"><View style={s.categoryOrderPage}>
      <ShopScroll page={page} horizontalPadding={16}>
        {items.length ? <View style={s.itemPanel}>{items.map((entry, index) => {
          const note = entry.status === 'list' ? notes[entry.key] : undefined;
          const erase = () => actions.eraseItem(shop.id, entry.name);
          return <SwipeToDelete key={entry.key} label={entry.name} onDelete={erase}>{action =>
          <View style={[s.allItemRow, index < items.length - 1 && s.allItemDivider]}>
            <View style={s.flex} accessible accessibilityHint="Swipe left to delete it from the store."
              accessibilityActions={[{ name: 'delete', label: `Delete ${entry.name}` }]}
              onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'delete') erase(); }}>
              <Text numberOfLines={2} style={s.itemName}>{entry.name}</Text>
              {note === 'duplicate' && <Animated.Text entering={fadeIn} accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.allItemNote}>Item is already in the list</Animated.Text>}
              {note === 'added' && <Animated.View entering={fadeIn} style={s.allItemAdded} accessibilityLiveRegion="polite">
                <Icon name="check" size={14} /><Text style={[s.allItemNote, { color: c.primary }]}>Added to the list</Text>
              </Animated.View>}
            </View>
            <View style={s.allItemCategory}><CategoryBadge groups={shop.groups} order={order} id={entry.groupId} /></View>
            {action(<IconButton icon="plus" label={`Add ${entry.name} to the list`} onPress={() => add(entry)} />)}
          </View>}</SwipeToDelete>;
        })}</View> : <View style={s.emptyList}>
          <Icon name="bag" size={28} /><Text style={s.caption}>No items yet. Items you add to this store appear here.</Text>
        </View>}
      </ShopScroll>
    </View></GestureDetector>
  </Animated.View></GestureDetector>;
}
