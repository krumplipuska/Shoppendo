import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import * as geometry from '../src/reorder.ts';

// Execute the production row's gesture callbacks with synchronous UI primitives.
// Native recognition and frame rate still require the device acceptance matrix.
const compiled = ts.transpileModule(readFileSync(new URL('../src/reorder-list.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function rowHarness(inRow = true, withPage = false) {
  let gesture, hold;
  const failures = [], settlements = [];
  let starts = 0;
  const sv = value => ({ value });
  const context = {
    scrollGesture: { handlerTag: 8 }, pageGesture: withPage ? { handlerTag: 9 } : undefined,
    order: sv(['a', 'b']), original: sv([]), heights: sv({ a: 60, b: 90 }), active: sv(''), phase: sv(0),
    finger: sv(0), grab: sv(0), dragTop: sv(0), scale: sv(1), scrollY: sv(30),
    viewport: sv({ top: 0, height: 0 }), rowsOffset: sv(0),
    scroll: { bounds: { pageY: 100, height: 400 } }, rows: { bounds: { pageY: 90 } },
    begin: () => starts++,
    settle: cancelled => { if (context.phase.value !== 1) return; settlements.push(cancelled); context.phase.value = 2; },
  };
  const modules = {
    react: { createContext: () => ({ Provider: 'Provider' }), useContext: () => inRow },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'View', StyleSheet: { create: value => value } },
    'react-native-gesture-handler': { GestureDetector: 'GestureDetector', GestureStateManager: { fail: tag => failures.push(tag), activate: tag => gesture.onActivate({ handlerTag: tag, absoluteY: 120 }) }, usePanGesture: config => { gesture = config; return config; }, useLongPressGesture: config => { hold = config; return config; }, useSimultaneousGestures: (...gestures) => gestures },
    'react-native-reanimated': { __esModule: true, default: { View: 'Animated.View' },
      ReduceMotion: { System: 'system' }, useSharedValue: sv, useAnimatedReaction: () => {}, useAnimatedStyle: fn => fn(),
      measure: ref => ref.bounds, withTiming: value => value },
    'react-native-worklets': { runOnJS: fn => fn, runOnUI: fn => fn }, 'expo-haptics': {}, './reorder': geometry,
  };
  const exports = {};
  new Function('require', 'exports', `${compiled}\nexports.testRow = ReorderRow;`)(name => {
    assert.ok(modules[name], `Unexpected dependency: ${name}`); return modules[name];
  }, exports);
  const tree = exports.testRow({ id: 'a', children: null, enabled: true, context });
  return { gesture, hold, context, failures, settlements, tree, tapProps: exports.useReorderTap(), starts: () => starts };
}

test('row callbacks configure a 300ms hold and short/failed gestures never settle or commit', () => {
  const h = rowHarness();
  assert.equal(h.hold.minDuration, 300);
  assert.equal(h.hold.maxDistance, 18);
  assert.equal(h.gesture.manualActivation, true);
  assert.equal(h.gesture.activateAfterLongPress, undefined);
  assert.equal(h.gesture.cancelsJSResponder, true);
  h.gesture.onFinalize({ canceled: true });
  h.gesture.onDeactivate({ canceled: true });
  assert.equal(h.starts(), 0);
  assert.deepEqual(h.settlements, []);
});

test('the complete row rectangle accepts holds, including control and edge positions', () => {
  for (const x of [0, 1, 22, 120, 270, 319, 320]) for (const y of [90, 91, 120, 149, 150]) {
    const h = rowHarness();
    h.gesture.onTouchesDown({ handlerTag: 7, allTouches: [{ absoluteX: x, absoluteY: y }] });
    assert.deepEqual(h.failures, [], `hold at ${x}, ${y} must not be excluded`);
    h.gesture.onActivate({ handlerTag: 7, absoluteY: y });
    assert.equal(h.starts(), 1);
    const surface = h.tree.props.children.props.children;
    assert.equal(surface.props.pointerEvents, 'auto');
    assert.equal(surface.props.style[0].left, 0);
    assert.equal(surface.props.style[0].right, 0);
  }
});

test('the full-width transformed row contains a normal-flow detector and measured content', () => {
  const h = rowHarness();
  const row = h.tree.props.children.props.children;
  assert.equal(row.type, 'Animated.View');
  assert.equal(row.props.style[0].position, 'absolute');
  assert.ok(row.props.style[1].transform);
  const detector = row.props.children;
  assert.equal(detector.type, 'GestureDetector');
  assert.deepEqual(detector.props.gesture, [h.gesture, h.hold]);
  assert.equal(detector.props.children.type, 'View');
  assert.equal(detector.props.children.props.collapsable, false);
  assert.equal(detector.props.children.props.style, undefined);
  row.props.onLayout({ nativeEvent: { layout: { height: 104 } } });
  assert.equal(h.context.heights.value.a, 104, 'use the full outer height, including child spacing');
  h.gesture.onActivate({ absoluteY: 120 });
  row.props.onLayout({ nativeEvent: { layout: { height: 104 } } });
  assert.deepEqual(h.settlements, [], 'unchanged layout does not cancel the lift');
  row.props.onLayout({ nativeEvent: { layout: { height: 110 } } });
  assert.deepEqual(h.settlements, [true], 'a genuine height change cancels stale geometry');
});

test('hold and pan both block the same scroll/page gestures', () => {
  for (const withPage of [false, true]) {
    const h = rowHarness(true, withPage);
    assert.deepEqual(h.gesture.block, withPage ? [h.context.scrollGesture, h.context.pageGesture] : [h.context.scrollGesture]);
    assert.equal(h.gesture.block, h.hold.block);
  }
});

test('failed holds release pending pans; finalized tags cannot activate a later drag', () => {
  const h = rowHarness();
  h.gesture.onTouchesDown({ handlerTag: 7 });
  h.hold.onFinalize();
  assert.deepEqual(h.failures, [7]);
  h.gesture.onFinalize();
  h.hold.onActivate();
  h.hold.onFinalize();
  assert.equal(h.starts(), 0);
  assert.deepEqual(h.failures, [7]);
  h.gesture.onTouchesDown({ handlerTag: 10 });
  h.hold.onActivate();
  assert.equal(h.starts(), 1, 'a new touch can activate after the previous pan finalized');
});

test('controls suppress release taps after a row hold without replacing short-tap handlers', () => {
  const { tapProps } = rowHarness();
  assert.equal(tapProps.delayLongPress, 300);
  assert.equal(typeof tapProps.onLongPress, 'function');
  assert.equal(tapProps.onPress, undefined, 'the original control still owns short taps');
  assert.deepEqual(rowHarness(false).tapProps, {}, 'controls outside draggable rows stay unchanged');
});

test('activation has no jump; updates preserve finger offset through scrolling; drop finalizes once', () => {
  const h = rowHarness();
  h.gesture.onActivate({ handlerTag: 1, absoluteY: 120 });
  assert.equal(h.starts(), 1);
  assert.equal(h.context.dragTop.value, 0);
  assert.equal(h.context.grab.value, 30);
  assert.equal(h.context.scale.value, 1.03);
  h.gesture.onUpdate({ absoluteY: 180 });
  assert.equal(h.context.dragTop.value, 60);
  h.context.scrollY.value = 80;
  h.gesture.onUpdate({ absoluteY: 180 });
  assert.equal(h.context.dragTop.value, 110, 'scroll offset is added exactly once');
  h.gesture.onDeactivate({ canceled: false });
  h.gesture.onFinalize({ canceled: false });
  assert.deepEqual(h.settlements, [false]);
});

test('cancellation restores via the shared finalizer; neighboring gestures cannot cancel the source', () => {
  const h = rowHarness();
  h.context.active.value = 'b'; h.context.phase.value = 1;
  h.gesture.onFinalize({ canceled: true });
  assert.deepEqual(h.settlements, []);
  h.context.active.value = 'a';
  h.gesture.onDeactivate({ canceled: true });
  h.gesture.onFinalize({ canceled: true });
  assert.deepEqual(h.settlements, [true]);
});

// Exercise the installed recognizer's actual timer and distance code. Only its
// platform delegate/state delivery is replaced; activation is not called by the test.
function recognizer(h) {
  const State = { UNDETERMINED: 0, BEGAN: 2, ACTIVE: 4, END: 5, FAILED: 1, CANCELLED: 3 };
  class Base {
    state = 0;
    tracker = {
      trackedPointersCount: 0, point: { x: 0, y: 0 },
      addToTracker(e) { this.trackedPointersCount++; this.point = e; },
      track(e) { this.point = e; },
      removeFromTracker() { this.trackedPointersCount--; },
      getAbsoluteCoordsAverage() { return this.point; },
    };
    updateGestureConfig() {} onPointerDown() {} onPointerMove() {} onPointerUp() {}
    isButtonInConfig() { return true; }
    transition(next) {
      const before = this.state; this.state = next; this.onStateChange(next, before);
      if (next === State.ACTIVE) h.hold.onActivate();
      if ([State.END, State.FAILED, State.CANCELLED].includes(next)) h.hold.onFinalize();
    }
    begin() { this.transition(State.BEGAN); }
    activate() { this.transition(State.ACTIVE); }
    fail() { this.transition(State.FAILED); }
    cancel() { this.transition(State.CANCELLED); }
    end() { this.transition(State.END); }
  }
  const source = readFileSync(new URL('../node_modules/react-native-gesture-handler/src/web/handlers/LongPressGestureHandler.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', js)(name => {
    if (name.endsWith('/State')) return { State };
    if (name.endsWith('/types')) return { SingleGestureName: { LongPress: 'LongPress' } };
    if (name === './GestureHandler') return { __esModule: true, default: Base };
    throw new Error(name);
  }, exports);
  const handler = new exports.default();
  handler.updateGestureConfig({ minDurationMs: h.hold.minDuration, maxDist: h.hold.maxDistance });
  h.gesture.onTouchesDown({ handlerTag: 7 });
  return handler;
}

test('real hold timer lifts at 300ms with no further motion, including 15pt jitter', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const jitter of [0, 15]) {
    const h = rowHarness(), handler = recognizer(h);
    handler.onPointerDown({ x: 120, y: 120, pointerId: 1 });
    handler.onPointerMove({ x: 120 + jitter, y: 120, pointerId: 1 });
    t.mock.timers.tick(299); assert.equal(h.starts(), 0);
    t.mock.timers.tick(1); assert.equal(h.starts(), 1);
    handler.onPointerMove({ x: 180, y: 220, pointerId: 1 });
    assert.deepEqual(h.failures, [], 'hold distance cancellation must not cancel an active pan');
    h.gesture.onDeactivate({ canceled: false });
    assert.deepEqual(h.settlements, [false]);
  }
});

test('short release or movement beyond tolerance cancels the timer and frees competing gestures', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const release of [true, false]) {
    const h = rowHarness(), handler = recognizer(h);
    handler.onPointerDown({ x: 120, y: 120, pointerId: 1 });
    t.mock.timers.tick(100);
    if (release) handler.onPointerUp({ pointerId: 1 });
    else handler.onPointerMove({ x: 139, y: 120, pointerId: 1 });
    t.mock.timers.tick(500);
    assert.equal(h.starts(), 0); assert.deepEqual(h.failures, [7]);
    assert.deepEqual(h.settlements, []);
  }
});

// Run the list's real commit/effect callbacks with deterministic hook slots and
// animation completion. This checks JS lock ownership, not native arbitration.
function listHarness() {
  const slots = [], effects = [], springs = [], commits = [];
  let cursor = 0, starts = 0, ends = 0, appState, tree;
  const slot = init => { const i = cursor++; return slots[i] ??= init(); };
  const changed = (a, b) => !a || a.length !== b.length || a.some((x, i) => x !== b[i]);
  const effect = (fn, deps) => {
    const state = slot(() => ({}));
    if (changed(state.deps, deps)) { state.deps = deps; effects.push(() => { state.cleanup?.(); state.cleanup = fn(); }); }
  };
  const callback = (fn, deps) => {
    const state = slot(() => ({}));
    if (changed(state.deps, deps)) { state.deps = deps; state.fn = fn; }
    return state.fn;
  };
  const native = { handlerTag: 8 };
  const props = {
    ids: ['a', 'b'], renderRow: id => id,
    onDragStart: () => starts++, onDragEnd: () => ends++,
    onReorder: drop => { commits.push(drop); props.ids = drop.order; },
  };
  const modules = {
    react: { createContext: () => ({ Provider: 'Provider' }), useCallback: callback,
      useRef: value => slot(() => ({ current: value })), useEffect: effect, useLayoutEffect: effect,
      useState: value => { const state = slot(() => ({ value })); return [state.value, next => { state.value = typeof next === 'function' ? next(state.value) : next; }]; } },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { StyleSheet: { create: x => x }, Platform: { OS: 'web' },
      AppState: { addEventListener: (_, fn) => { appState = fn; return { remove() {} }; } } },
    'react-native-gesture-handler': { GestureDetector: 'GestureDetector', useNativeGesture: config => { native.config = config; return native; } },
    'react-native-reanimated': { __esModule: true, default: { View: 'Animated.View', ScrollView: 'Animated.ScrollView' },
      ReduceMotion: { System: 'system' }, useSharedValue: value => slot(() => ({ value })),
      useAnimatedRef: () => slot(() => () => {}), useAnimatedScrollHandler: fn => fn,
      useAnimatedStyle: fn => fn(), useFrameCallback() {}, cancelAnimation() {},
      withTiming: value => value, withSpring: (value, _, done) => { springs.push(done); return value; } },
    'react-native-worklets': { runOnJS: fn => fn, runOnUI: fn => fn }, 'expo-haptics': {}, './reorder': geometry,
  };
  const exports = {};
  new Function('require', 'exports', compiled)(name => modules[name], exports);
  const render = () => { cursor = 0; tree = exports.ReorderList(props); while (effects.length) effects.shift()(); };
  render();
  const context = tree.props.children.props.children[1].props.children[0].props.context;
  context.heights.value = { a: 60, b: 90 };
  const unmount = () => { for (const state of slots) { state.cleanup?.(); state.cleanup = undefined; } };
  const finishAnimations = () => { while (springs.length) springs.shift()(true); };
  return { context, tree, native, commits, render, unmount,
    background: () => appState('background'), finishAnimations, finish: () => { finishAnimations(); render(); },
    begin: () => { context.original.value = ['a', 'b']; context.order.value = ['b', 'a']; context.active.value = 'a'; context.phase.value = 1; context.begin(); },
    counts: () => [starts, ends],
  };
}

test('one native gesture owns the core animated scroll view', () => {
  const h = listHarness();
  assert.equal(h.tree.type, 'GestureDetector');
  assert.equal(h.tree.props.gesture, h.native);
  assert.equal(h.tree.props.children.type, 'Animated.ScrollView');
  assert.equal(h.context.scrollGesture, h.native);
  assert.equal(h.tree.props.children.props.onGestureUpdate_CAN_CAUSE_INFINITE_RERENDER, undefined);
  h.unmount();
});

test('a successful drop commits once and releases synchronization once, including later unmount', () => {
  const h = listHarness();
  h.begin(); h.context.begin();
  h.context.settle(false); h.context.settle(false); h.finish();
  assert.deepEqual(h.commits, [{ id: 'a', order: ['b', 'a'], from: 0, to: 1 }]);
  assert.deepEqual(h.counts(), [1, 1]);
  h.unmount(); assert.deepEqual(h.counts(), [1, 1]);
});

test('cancellation/background restore order; unmount and late completion cannot leak a lock or commit', () => {
  for (const reason of ['cancel', 'background', 'unmount']) {
    const h = listHarness(); h.begin();
    if (reason === 'background') h.background();
    else h.context.settle(reason === 'cancel');
    if (reason === 'unmount') { h.unmount(); h.finishAnimations(); }
    else {
      assert.deepEqual(h.context.order.value, ['a', 'b']);
      h.finish();
    }
    h.unmount();
    assert.deepEqual(h.counts(), [1, 1]);
    assert.deepEqual(h.commits, []);
  }
});
