// Drax 1.1 expects RNGH v2's finalize success argument. RNGH 3 instead
// calls onDeactivate once for every active pan and includes event.canceled.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('react-native-drax/package.json'));
if (require('react-native-drax/package.json').version !== '1.1.0') {
  throw new Error('Recheck the RNGH v3 end-event adapter before changing Drax versions.');
}
for (const path of ['src/compat/useDraxPanGesture.ts', 'lib/module/compat/useDraxPanGesture.js']) {
  const file = join(root, path);
  const input = readFileSync(file, 'utf8');
  const event = path.endsWith('.ts') ? 'event: DraxPanEvent & { canceled: boolean }' : 'event';
  const replacement = `onDeactivate: (${event}) => {
      'worklet';
      if (event.canceled) onFinalize(event, false);
      else onDeactivate(event);
    },`;
  if (input.includes(replacement)) continue;
  const callbacks = /onDeactivate: config\.onDeactivate,\s+onFinalize: config\.onFinalize,?/;
  const declaration = '  const panConfig';
  if (!callbacks.test(input) || !input.includes(declaration)) throw new Error('Unexpected Drax adapter in ' + path);
  writeFileSync(file, input.replace(declaration, '  const { onDeactivate, onFinalize } = config;\n' + declaration)
    .replace(callbacks, replacement));
}

// The registry also owns receiverPayload, renderHoverContent and monitor
// callbacks. Refresh them when a row changes but remains draggable.
for (const path of ['src/DraxView.tsx', 'lib/module/DraxView.js']) {
  const file = join(root, path);
  const input = readFileSync(file, 'utf8');
  const original = '[id, updateViewProps, draggable, props.receptive, props.monitoring, props.collisionAlgorithm]';
  const replacement = '[id, updateViewProps, props]';
  if (input.includes(replacement)) continue;
  if (!input.includes(original)) throw new Error('Unexpected Drax registry effect in ' + path);
  writeFileSync(file, input.replace(original, replacement));
}
