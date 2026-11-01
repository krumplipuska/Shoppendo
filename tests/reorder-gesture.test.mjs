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

function rowHarness(controls = []) {
  let gesture;
  const failures = [], settlements = [];
  let starts = 0;
  const sv = value => ({ value });
  const context = {
    order: sv(['a', 'b']), original: sv([]), heights: sv({ a: 60, b: 90 }), active: sv(''), phase: sv(0),
    finger: sv(0), grab: sv(0), dragTop: sv(0), scale: sv(1), scrollY: sv(30),
    viewport: sv({ top: 0, height: 0 }), rowsOffset: sv(0),
    scroll: { bounds: { pageY: 100, height: 400 } }, rows: { bounds: { pageY: 90 } },
    begin: () => starts++,
    settle: cancelled => { if (context.phase.value !== 1) return; settlements.push(cancelled); context.phase.value = 2; },
  };
  const modules = {
    react: { createContext: () => ({ Provider: 'Provider' }), useState: () => [controls, () => {}], useCallback: fn => fn },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { StyleSheet: { create: value => value } },
    'react-native-gesture-handler': { GestureStateManager: { fail: tag => failures.push(tag) }, usePanGesture: config => { gesture = config; return config; } },
    'react-native-reanimated': { __esModule: true, default: { createAnimatedComponent: x => x },
      ReduceMotion: { System: 'system' }, useSharedValue: sv, useAnimatedReaction: () => {}, useAnimatedStyle: fn => fn(),
      measure: ref => ref.bounds, withTiming: value => value },
    'react-native-worklets': { runOnJS: fn => fn }, 'expo-haptics': {}, './reorder': geometry,
  };
  const exports = {};
  new Function('require', 'exports', `${compiled}\nexports.testRow = ReorderRow;`)(name => {
    assert.ok(modules[name], `Unexpected dependency: ${name}`); return modules[name];
  }, exports);
  exports.testRow({ id: 'a', children: null, enabled: true, context });
  return { gesture, context, failures, settlements, starts: () => starts };
}

test('row callbacks configure a 300ms hold and short/failed gestures never settle or commit', () => {
  const h = rowHarness();
  assert.equal(h.gesture.activateAfterLongPress, 300);
  assert.deepEqual(h.gesture.failOffsetY, [-12, 12]);
  assert.equal(h.gesture.cancelsJSResponder, true);
  h.gesture.onFinalize({ canceled: true });
  h.gesture.onDeactivate({ canceled: true });
  assert.equal(h.starts(), 0);
  assert.deepEqual(h.settlements, []);
});

test('embedded control hit testing rejects the drag before activation', () => {
  const h = rowHarness([{ bounds: { pageX: 10, pageY: 100, width: 44, height: 60 } }]);
  h.gesture.onTouchesDown({ handlerTag: 7, allTouches: [{ absoluteX: 30, absoluteY: 120 }] });
  assert.deepEqual(h.failures, [7]);
  h.gesture.onTouchesDown({ handlerTag: 8, allTouches: [{ absoluteX: 90, absoluteY: 120 }] });
  assert.deepEqual(h.failures, [7]);
  assert.equal(h.starts(), 0);
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
