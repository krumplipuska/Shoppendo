import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Drax 1.1 assumes RNGH v2's (event, success) finalizer, but v3 sends event.canceled.
// Patch both Metro's native source and the web entry until Drax fixes its v3 adapter.
const root = new URL('../node_modules/react-native-drax/', import.meta.url);
if (JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version !== '1.1.0') {
  throw new Error('Review the Drax gesture compatibility patch for the installed version.');
}
function replace(path, before, after) {
  const file = fileURLToPath(new URL(path, root));
  const source = readFileSync(file, 'utf8');
  if (source.includes(after)) return;
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error(`Drax compatibility patch no longer matches ${path}`);
  }
  writeFileSync(file, source.replace(before, after));
}
for (const [base, extension] of [['src', 'ts'], ['lib/module', 'js']]) {
  const adapter = `${base}/compat/useDraxPanGesture.${extension}`;
  const event = extension === 'ts' ? 'event: DraxPanEvent & { canceled: boolean }' : 'event';
  replace(adapter, 'onDeactivate: config.onDeactivate,', `onDeactivate: (${event}) => {
      'worklet';
      if (!event.canceled) config.onDeactivate(event);
    },`);
  replace(adapter, 'onFinalize: config.onFinalize', `onFinalize: (${event}) => {
      'worklet';
      config.onFinalize(event, !event.canceled);
    }`);
  replace(`${base}/hooks/useDragGesture.${extension}`,
    "if (!didSucceed && draggedIdSV.value !== '')",
    'if (!didSucceed && draggedIdSV.value === id)');
}
