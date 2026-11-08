// Shared hold-to-drag machinery for store, category, and item lists.
import { createContext, useContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { DraxView, DraxSnapbackTargetPreset, type DraxRenderHoverContentProps, type DraxViewMeasurements, type DraxDragEventData, type DraxDragWithReceiverEventData } from 'react-native-drax';
import { FadeIn, FadeOut, ReduceMotion, useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { dragSession, insertionSide, itemDragLayout, dragSlotTop } from './interaction';
import { ITEM_PANEL_BORDER } from './styles';

export type Drag = { kind: 'item' | 'group' | 'store'; id: string; shopId: string };
export function accepts(payload: unknown, shopId: string, kind?: Drag['kind']): payload is Drag {
  const drag = payload as Drag | null;
  return Boolean(drag && drag.shopId === shopId && typeof drag.id === 'string' && (kind ? drag.kind === kind : ['item', 'group', 'store'].includes(drag.kind)));
}
export function dragFeedback() {
  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
export const DRAG_DELAY = 320;
export const fadeIn = FadeIn.duration(150).reduceMotion(ReduceMotion.System);
export const fadeOut = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

export function useHoldDrag() {
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
export const ItemEditorContext = createContext<(id: string) => void>(() => {});
// Rows rendered with a list's first frame skip their entry animation, so opening a store doesn't
// start one layout animation per row on top of the page slide. Rows added later still animate.
export const EntryAnimation = createContext<{ current: boolean }>({ current: true });
export function useEntryGate() {
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);
  return mounted;
}

export type ItemPreview = { source: string; target: string; after: boolean };
export const ItemDragContext = createContext<ReturnType<typeof useListDrag> | null>(null);
export const DEBUG_DRAG = false;
export function trace(session: number, phase: string, details?: unknown) {
  if (__DEV__ && DEBUG_DRAG) console.debug('[drag]', session, phase, details);
}
export function hoverSize(dimensions?: { width: number; height: number }) {
  return dimensions && [dimensions.width, dimensions.height].every(n => Number.isFinite(n) && n > 0)
    ? { width: dimensions.width, minHeight: dimensions.height } : undefined;
}

export function hoverFrame({ dimensions, viewState }: DraxRenderHoverContentProps) {
  const grab = viewState?.grabOffset;
  return { ...hoverSize(dimensions), transformOrigin: grab ? `${grab.x}px ${grab.y}px` : 'center' };
}

export function useListDrag(ids: string[], commit: (preview: ItemPreview) => void, sort = 'manual', gap = 0) {
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
export function useRowMotion(id: string, scaleLift = true) {
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
export function ListTail({ shopId, kind, last }: { shopId: string; kind: Drag['kind']; last?: string }) {
  const preview = useContext(ItemDragContext);
  if (!last) return null;
  return <DraxView draggable={false} style={{ height: 28 }} receiverPayload={{ kind, shopId, id: last, tail: true }}
    acceptsDrag={payload => accepts(payload, shopId, kind)}
    onReceiveDragEnter={preview?.over} onReceiveDragOver={preview?.over} onReceiveDragExit={preview?.exit} />;
}
