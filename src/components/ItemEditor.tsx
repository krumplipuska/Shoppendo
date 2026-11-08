// Item and category composer sheets.
import { useCallback, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { actions, getShopSnapshot, useShops } from '../store';
import { findListItem, GROUP_ICONS, itemSuggestions, orderedGroups, type GroupIcon, type Shop } from '../model';
import { Icon, EditingRegion, InlineInput, Sheet, ui } from '../ui';
import { colors as c, entityTone } from '../theme';
import { s } from '../styles';

export function CategoryButtons({ shop, selected, select, add }: { shop: Shop; selected: string; select: (id: string) => void; add: () => void }) {
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
export function NewCategory({ shop, created, close, embedded = false, scrollOffset, editingId }: {
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

export function AddItem({ shop, close, initialCategory, editingId, onAdded, onDuplicate }: { shop: Shop; close: () => void; initialCategory?: string; editingId?: string; onAdded?: (id: string, name: string, groupId: string) => void; onDuplicate?: (id: string | null) => void }) {
  const [duplicate, setDuplicate] = useState(false);
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
    if (duplicate) { setDuplicate(false); onDuplicate?.(null); }
  };
  const add = (name: string) => {
    if (editingId) {
      actions.renameItem(shop.id, editingId, name);
      if (category !== editing?.groupId) actions.moveItem(shop.id, editingId, category, null, true);
      Keyboard.dismiss(); close();
    } else {
      const current = getShopSnapshot().data.shops.find(entry => entry.id === shop.id) ?? shop;
      const existing = findListItem(current, name);
      if (existing && !existing[1].done && !existing[1].missing) {
        // Already on the list: keep the text, flag the input and the item instead of adding a copy.
        setDuplicate(true); onDuplicate?.(existing[0]);
        return false;
      }
      if (existing) {
        // Done or missing: put the existing item back on the list instead of adding a copy.
        actions.restoreItem(shop.id, existing[0]); onAdded?.(existing[0], existing[1].name, existing[1].groupId);
        return;
      }
      const id = actions.addItem(shop.id, category, name); onAdded?.(id, name.trim(), category);
    }
  };
  return <Sheet visible compact canSwipeDown={() => scrollY.current <= 1} title={addingCategory ? 'Add category' : editing ? 'Edit item' : 'Add item'} onShow={focusInput} onClose={() => { Keyboard.dismiss(); close(); }}><EditingRegion style={{ flexShrink: 1 }}>
    {addingCategory ? <NewCategory embedded scrollOffset={scrollY} shop={shop} created={id => { setCategory(id); }}
      close={() => { setAddingCategory(false); scrollY.current = 0; focusInput(); }} /> : <View style={s.itemComposer}><ScrollView onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} style={s.composerScroll} contentContainerStyle={s.composerScrollContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false}>
      <View style={[s.composerInput, duplicate && s.composerDuplicate]}><InlineInput inputRef={input} label={editing ? "Edit item name" : "New item name"} placeholder={editing ? "Item name" : "Add item…"} keepOpen={!editing} submitLabel={editing ? "Save item" : "Add item"} onAdd={add}
        value={query} onValueChange={type} /></View>
      {duplicate && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.duplicateText}>Item is already in the list</Text>}
      {suggestions.length > 0 && <ScrollView style={s.suggestions} keyboardShouldPersistTaps="handled" nestedScrollEnabled bounces={false}>{suggestions.map(option => <Pressable key={option.name}
        accessibilityRole="button" accessibilityLabel={`Suggest ${option.name}, ${shop.groups[option.groupId].name}`}
        onPress={() => { setQuery(option.name); setCategory(option.groupId); setSuggestionsHidden(true); if (duplicate) { setDuplicate(false); onDuplicate?.(null); } }} style={s.suggestion}>
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
