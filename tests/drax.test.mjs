import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

// Exercise the installed adapter and drag finalizer, rather than duplicating their logic.
for (const [entry, extension] of [['src', 'ts'], ['lib/module', 'js']]) {
  const read = path => {
    const source = readFileSync(new URL(`../node_modules/react-native-drax/${entry}/${path}.${extension}`, import.meta.url), 'utf8');
    return extension === 'ts' ? stripTypeScriptTypes(source) : source;
  };
  const adapterSource = read('compat/useDraxPanGesture');
  const start = adapterSource.indexOf('function useDraxPanGestureV3(');
  const adapter = new Function('rngh', `${adapterSource.slice(start, adapterSource.indexOf('\n/**', start))}; return useDraxPanGestureV3;`)({ usePanGesture: config => config });
  const hookSource = read('hooks/useDragGesture').replace(/^import[\s\S]*?from ['"][^'"]+['"];?/gm, '').replace('export const useDragGesture', 'const useDragGesture');

  test(`${entry}: successful drops finalize once; failed neighboring gestures cannot cancel the dragged row`, () => {
    const value = value => ({ value });
    const ends = [];
    const context = {
      draggedIdSV: value('row-a'), receiverIdSV: value('row-b'),
      rejectedReceiverIdSV: value(''), dragPhaseSV: value('dragging'),
      hoverPositionSV: value({ x: 0, y: 64 }), dragAbsolutePositionSV: value({ x: 50, y: 96 }),
      spatialIndexSV: value([{ width: 100, height: 64 }]), scrollOffsetsSV: value([]),
      grabOffsetSV: value({ x: 0, y: 0 }), startPositionSV: value({ x: 0, y: 0 }),
      rootOffsetSV: value({ x: 0, y: 0 }), handleDragStart() {}, handleReceiverChange() {},
      handleDragEnd: (...args) => ends.push(args),
    };
    const hook = new Function('useDraxContext', 'useDraxPanGesture', 'runOnJS', 'Platform', 'computeAbsolutePositionWorklet', 'hitTestWorklet', `${hookSource}\n; return useDragGesture;`)(
      () => context, adapter, callback => callback, { OS: 'ios' }, () => ({ x: 0, y: 0 }), () => ({ monitorIds: [] }),
    );
    const source = hook('row-a', value(0), value(true), value(320));
    const neighbor = hook('row-b', value(0), value(true), value(320));

    neighbor.onFinalize({ canceled: true });
    assert.equal(ends.length, 0);
    assert.equal(context.dragPhaseSV.value, 'dragging');
    assert.equal(context.receiverIdSV.value, 'row-b');

    source.onDeactivate({ canceled: false });
    source.onFinalize({ canceled: false });
    assert.deepEqual(ends.map(([id, receiver, cancelled]) => [id, receiver, cancelled]), [['row-a', 'row-b', false]]);

    ends.length = 0;
    source.onDeactivate({ canceled: true });
    source.onFinalize({ canceled: true });
    assert.equal(ends.length, 1);
    assert.equal(ends[0][2], true);
  });
}
