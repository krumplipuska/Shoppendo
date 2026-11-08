// Share sheet: copy the shop ID, share a link, or stop sharing.
import { useState } from 'react';
import { Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { actions, errorMessage } from '../store';
import { formatCode, type Shop } from '../model';
import { Button, IconButton, Sheet, ui } from '../ui';
import { shopLink } from '../links';
import { s } from '../styles';

export function ShareShop({ shop, close, replaced }: { shop: Shop; close: () => void; replaced: (id: string) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function share(copyOnly = false) {
    setBusy(true); setError('');
    try {
      const code = copyOnly && shop.shared ? shop.id : await actions.share(shop.id);
      if (copyOnly) {
        await Clipboard.setStringAsync(formatCode(code)); setCopied(true);
      } else {
        await Share.share({ title: `Share ${shop.name}`, message: `Join ${shop.name} in Shoppendo:\n${shopLink(code)}` });
      }
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true); setError('');
    try { replaced(await actions.stopSharing(shop.id)); close(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Sheet visible title={`Share ${shop.name}`} onClose={close}>
    <Text style={s.caption}>Anyone with this ID can edit this shop.</Text>
    <View style={s.idBox}>
      <Text style={s.idLabel}>SHOP ID</Text>
      <View style={s.shareActions}><Text selectable style={[s.idCode, s.flex]}>{formatCode(shop.id)}</Text>
        <IconButton icon={copied ? 'check' : 'copy'} label={copied ? 'ID copied' : 'Copy shop ID'} disabled={busy} onPress={() => void share(true)} />
      </View>
    </View>
    <Button label="Share link" busy={busy} onPress={() => void share()} />
    {shop.shared && <>
      <Button label="Stop sharing" secondary disabled={busy} onPress={() => void stop()} />
      <Text style={s.caption}>Stops sharing for everyone. Your list stays on this phone; the old ID will stop working.</Text>
    </>}
    {Boolean(error) && <Text accessibilityRole="alert" style={ui.errorText}>{error}</Text>}
  </Sheet>;
}
