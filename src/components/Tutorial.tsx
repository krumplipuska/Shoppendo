// "How it works" popup: a short step-by-step guide opened from the info button on Stores.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Button, Icon, Sheet, type IconName } from '../ui';
import { colors as c, fonts as f, entityTone } from '../theme';
import { fadeIn } from '../drag';

// Sample categories reuse the app's deterministic accent colours, like real groups do.
const SAMPLE = [
  { id: 'fruits', name: 'Fruits', icon: 'fruit' },
  { id: 'bakery', name: 'Bakery', icon: 'bread' },
  { id: 'dairy', name: 'Dairy', icon: 'milk' },
] as const satisfies readonly { id: string; name: string; icon: IconName }[];
const SAMPLE_IDS = SAMPLE.map(group => group.id);
const tone = (id: string) => entityTone(id, SAMPLE_IDS);

function WelcomePreview() {
  return <View style={t.welcome}>
    <View style={t.welcomeBadge}><Icon name="bag" size={34} /></View>
    <View style={t.welcomeIcons}>{SAMPLE.map(group => <View key={group.id} style={[t.categoryIcon, { backgroundColor: tone(group.id).soft }]}>
      <Icon name={group.icon} color={tone(group.id).color} size={20} />
    </View>)}</View>
  </View>;
}

function StorePreview() {
  return <View style={t.gap}>
    <View style={t.storeRow}>
      <View style={t.storeBadge}><Text style={t.storeInitials}>FM</Text></View>
      <View style={t.flex}><Text style={t.storeName}>Farmers Market</Text><Text style={t.caption}>0 items</Text></View>
      <Icon name="right" />
    </View>
    <View style={t.fab}><Icon name="plus" color={c.white} size={18} /><Text style={t.fabText}>Add store</Text></View>
  </View>;
}

function ItemsPreview() {
  const rows = [{ name: 'Apples', group: SAMPLE[0], done: false }, { name: 'Sourdough', group: SAMPLE[1], done: false }, { name: 'Milk', group: SAMPLE[2], done: true }];
  return <View style={t.panel}>{rows.map((row, index) => <View key={row.name} style={[t.itemRow, index < rows.length - 1 && t.itemDivider]}>
    <View style={[t.checkbox, row.done && t.checked]}>{row.done && <Icon name="check" size={13} color={c.white} />}</View>
    <Text numberOfLines={1} style={[t.itemName, row.done && t.doneName]}>{row.name}</Text>
    <View style={[t.capsule, { backgroundColor: tone(row.group.id).soft }]}>
      <Icon name={row.group.icon} color={tone(row.group.id).color} size={14} />
      <Text style={[t.capsuleText, { color: tone(row.group.id).color }]}>{row.group.name}</Text>
    </View>
  </View>)}</View>;
}

function OrderPreview() {
  return <View style={t.gap}>
    <View style={t.orderBar}>
      <Icon name="groupSort" size={18} color={c.text} /><Text style={[t.orderBarLabel, t.flex]}>Store order</Text><Text style={t.orderBarEdit}>Edit</Text>
    </View>
    {SAMPLE.map((group, index) => <View key={group.id} style={[t.orderRow, index === 1 && t.liftedRow]}>
      <View style={t.orderNumber}><Text style={t.orderNumberText}>{index + 1}</Text></View>
      <View style={[t.categoryIcon, { backgroundColor: tone(group.id).soft }]}><Icon name={group.icon} color={tone(group.id).color} size={18} /></View>
      <Text style={[t.groupName, t.flex]}>{group.name}</Text>
      <Icon name="grip" size={18} color={c.muted} />
    </View>)}
  </View>;
}

const STEPS = [
  { title: 'Welcome to Shoppendo', Preview: WelcomePreview,
    body: 'Keep one list for each store, sorted in the order you walk through it. Your lists are saved on this phone.' },
  { title: 'Create a store', Preview: StorePreview,
    body: 'Tap Add store, type a name, and choose Create store. New stores start with six categories. To use a list someone shared with you, choose Join by ID.' },
  { title: 'Add list items', Preview: ItemsPreview,
    body: 'Open a store and tap Add item, pick a category, and press Return to add the next one. Tick items as they go in your basket: Shoppendo learns your usual order and places items to match next time.' },
  { title: 'Set the store order', Preview: OrderPreview,
    body: 'In a store, tap Store order, then hold and drag categories into the order of your route. Each store keeps its own order, and your list follows it.' },
];

export function Tutorial({ close }: { close: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const { title, body, Preview } = STEPS[step];
  return <Sheet visible title="How it works" onClose={close}>
    <Animated.View key={step} entering={fadeIn} style={t.step} accessibilityLiveRegion="polite">
      <View style={t.preview} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden><Preview /></View>
      <Text style={t.stepCount}>Step {step + 1} of {STEPS.length}</Text>
      <Text accessibilityRole="header" style={t.title}>{title}</Text>
      <Text style={t.body}>{body}</Text>
    </Animated.View>
    <View style={t.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      {STEPS.map((_, index) => <View key={index} style={[t.dot, index === step && t.activeDot]} />)}
    </View>
    <View style={t.actions}>
      {step > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Previous step" onPress={() => setStep(step - 1)} style={t.back} hitSlop={4}>
        <Text style={t.backText}>Back</Text>
      </Pressable>}
      <View style={t.flex}><Button label={last ? 'Finish' : 'Next'} onPress={() => last ? close() : setStep(step + 1)} /></View>
    </View>
  </Sheet>;
}

const t = StyleSheet.create({
  flex: { flex: 1 }, gap: { gap: 10 },
  step: { gap: 6 },
  // Fixed minimum heights keep the sheet from jumping as steps change.
  preview: { minHeight: 206, justifyContent: 'center', padding: 14, marginBottom: 10, borderRadius: 16, backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  stepCount: { fontFamily: f.medium, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: c.muted },
  title: { fontFamily: f.bold, fontSize: 20, lineHeight: 26, color: c.text },
  body: { minHeight: 110, fontFamily: f.regular, fontSize: 15, lineHeight: 22, color: c.muted },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.border },
  activeDot: { width: 18, backgroundColor: c.primary },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minHeight: 50, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  backText: { fontFamily: f.semibold, fontSize: 15, color: c.primary },
  // Miniatures mirror the real screens' cards, rows and capsules.
  welcome: { alignItems: 'center', gap: 16 },
  welcomeBadge: { width: 72, height: 72, borderRadius: 20, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  welcomeIcons: { flexDirection: 'row', gap: 10 },
  categoryIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 14 },
  storeBadge: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  storeInitials: { fontFamily: f.bold, fontSize: 19, color: c.primary },
  storeName: { fontFamily: f.bold, fontSize: 16, color: c.text },
  caption: { fontFamily: f.regular, fontSize: 12, color: c.muted },
  fab: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: c.primary },
  fabText: { fontFamily: f.bold, fontSize: 13, color: c.white },
  panel: { backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 },
  itemDivider: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: c.border },
  checkbox: { width: 20, height: 20, borderWidth: 1.8, borderColor: c.muted, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: c.primary, borderColor: c.primary },
  itemName: { flex: 1, fontFamily: f.medium, fontSize: 15, color: c.text },
  doneName: { color: c.muted, textDecorationLine: 'line-through' },
  capsule: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  capsuleText: { fontFamily: f.medium, fontSize: 11 },
  orderBar: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.primarySoft },
  orderBarLabel: { fontFamily: f.medium, fontSize: 14, color: c.text },
  orderBarEdit: { fontFamily: f.semibold, fontSize: 14, color: c.primary },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 10, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 12 },
  liftedRow: { borderColor: '#85A67D', marginLeft: 8, marginRight: -4, shadowColor: c.text, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  orderNumber: { width: 24, height: 24, borderRadius: 7, backgroundColor: c.header, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  orderNumberText: { fontFamily: f.medium, fontSize: 12, color: c.muted },
  groupName: { fontFamily: f.semibold, fontSize: 15, color: c.text },
});
