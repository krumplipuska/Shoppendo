# Shoppendo

A small shopping list app for Android, iOS, and a browser. The approved [Figma concept](https://www.figma.com/design/iV6O7KHnHgNp5kF6LHAkNj?node-id=3-13) is implemented with React Native and Expo SDK 58.

## Run

Use Node.js 24 LTS, then:

```sh
npm install
npm start
```

Scan the QR code with the current Expo Go app on Android or iPhone. Press `w` for a browser preview, or run `npm run web`. Windows cannot run the iOS simulator; Expo Go on an iPhone or an EAS iOS build works instead.

Installation applies `scripts/patch-drax.mjs` to Drax 1.1.0's native and web entries. Its gesture-handler v3 adapter must read `event.canceled`, and only the active row may cancel a drag. `tests/drax.test.mjs` checks the installed callbacks. Keep Drax pinned until these fixes are included upstream; restart Metro with `npx expo start --clear` after first applying the patch.

## What it does

- Use the floating **Add store** button to open create/join controls in a compact slide-up panel. Store, category, and item panels share the same dimmed backdrop, swipe-down dismissal, and keyboard-aware positioning. Store badges show their initials and distinct accents; new stores start with six standard groups. Tap anywhere on a store row to open it.
- A shop slides up from the bottom over 240 ms without bounce when opened. Swipe left on the header to slide back to Stores, swipe from the left edge toward the right for the normal back gesture, or pull down on the header to dismiss downward. A large downward pull from the list body also follows the finger and dismisses when the list was already at its top; short pulls return to place. The previous screen stays underneath during interactive gestures. Back buttons and Android hardware back also animate. Reduced-motion settings are respected.
- Each shop has one item list with category icons. There is no grouped view or view selector. Items use category/manual order by default. Done stays at the bottom, shows category icons, and keeps the newest 100 completed items per shop. Older completions are soft-deleted on local changes, loading, and incoming sync updates; their names remain available for suggestions. **⋯ → Sort items** selects group/manual order, name (A–Z), or time added (oldest first). The saved category order belongs to each shop and drives both **By group** sorting and the category buttons in the item editor. Sorting is saved on this device and does not change another person’s view.
- The bottom-right **Add item** button opens a slide-up item panel with a name field and compact tinted category buttons. Tapping an item name or its right-aligned category capsule opens the same panel for editing. Its category **+** opens a compact name-and-icon panel in the same composer and selects the category after saving. A check badge and a text label identify the selected category. The composer scrolls within the space above the keyboard. Add/Return keeps it ready for another item. The compact panel leaves space above it for tapping outside. Its backdrop fades independently while the panel slides, and its scroll area fits above the keyboard. Swipe down on the panel to dismiss it (scroll its content back to the top first). Closing the panel or tapping its backdrop discards the current draft and closes the keyboard. **⋯ → Share shop ID** opens sharing.
- The menu has separate **Sort items** and **Categories** sections. **Categories → Add group** opens a compact slide-up name/icon panel; **Group sorting** fills the screen below the header with a drag-only category list. Hold anywhere on a row, including its text, to move it. Changes stay in a draft and apply once on Done or Back; the store list stays unchanged until then.
- Typing suggests up to five names from items saved in local lists, including completed and removed items. Matching is case-insensitive; current-store history is preferred and other stores map categories by name. Removed categories are excluded. Selecting a suggestion fills its name and category for review, then hides suggestions until the text changes again. A manual category choice stays selected while typing.
- In list view, tap an item's category icon to edit its name and category together using the same slide-up panel. Save with the checkmark or Return; its icon and sorted position then update. Completed items keep their checked state when reassigned.
- Adding an item keeps the composer open and immediately slides a named “Added” card from the input down into the list area over 650 ms in a layer above the entire entry panel, then fades it after 850 ms. The actual new row also slides/fades in over 420 ms. Reduced-motion settings are respected.
- Tap an item's checkbox to animate its checkmark and cross it out in place for one second, then slide it down into **Done**. Checks save immediately, including if you navigate away during the animation. Tap the checkbox again to restore its group and position.
- Hold directly on a store or group name, to edit directly under the header. Tap an item name to edit in the slide-up panel above the keyboard. Store-list renaming scrolls its editor to the top. Save with the checkmark, Return, or a tap outside. Closing store, category, or item panels discards their current unsaved drafts. Cancel explicitly discards a name edit; empty drafts close without creating anything.
- Choose from 32 category icons. Manual category ordering is available in **⋯ → Group sorting** and applies to that shop when the panel closes. This panel does not rename, change icons, or delete categories.
- Hold outside the name on a store or group row to drag it. Hold outside the text on an active item row to drag it. Tap directly on the item text or its category icon to open the same slide-up name-and-category editor. Blank row space does not open editing. No grab icons are shown. Drop a category on another row in the category-order panel to reorder it. Drop an item on another item to place it before or after that row, or change its category in the item editor, including to an empty category. In list view, dropping on an item in another category moves it there. On the web, focus a row and use Alt+Up/Down to reorder; press F2 to edit stores and groups.
- Stores and categories use distinct, deterministic accent colors that remain consistent when names or order change. The store icon and name sit in the top bar. Hold its name to rename the store inline, including in the Stores list.
- Swipe left on a store, group, or item to change only its right-side action into a red Delete button. The original action crossfades into Delete progressively with your finger movement while the row stays stationary. Release past the threshold to keep Delete visible; shorter swipes return to the original action. Tap elsewhere or swipe right to restore the original action. Undo is available for eight seconds. Removing a store affects this device; deleting a group also hides its items, and Undo restores them.
- Short timing transitions and fades smooth list changes without spring bounce and respect reduced-motion settings. Scroll views do not bounce. A topmost drag overlay shows the lifted row at the grab position in both directions. The shop uses a gesture-aware scroll view with an explicit simultaneous relationship for top-of-list pull-to-dismiss, while held drags suspend native scrolling and retain edge auto-scrolling. Store, category, and item rows share the same lifted preview and smooth sliding gaps. Manual item dragging is available in **By group** order; name/time sorting stays automatic. The last row’s invisible hit area extends into the remaining list space; its sliding gap indicates the bottom position, without a visible zone or added list space. Edge auto-scrolling reaches the end of long lists; canceling a drag restores positions without saving changes. Dropping settles the lifted row into the exact preview slot over 180 ms, then commits the order and removes preview transforms together. Pickup uses the full original row and keeps its grab position. Stores, items, and category drafts share this lifecycle. An item keeps its original category icon for 400 ms after reassignment, then flips to the new icon.
- Share a shop ID; another person chooses **+ → Join by ID**. Everyone uses the same groups, group order, items, and completed state. Collapsed groups, store ordering, and view mode remain personal preferences on each device.

The app starts with no stores. New stores include Fruits, Bakery, Dairy, Meat & fish, Frozen, and Cleaning. Existing groups are preserved. All local lists and pending shared edits are stored on the device. There are no quantities, notes, sign-up, or account screens.

## Firebase

The supplied project is `shoppendo-1a86c`. Its public web app configuration lives in the git-ignored `.env.local`. For a different project, copy `.env.example` to `.env.local` and fill in the four values. These are client identifiers, not a service-account key. Restart Expo after changing them.

Before using live sharing:

1. In Firebase Console → Authentication → Sign-in method, enable **Anonymous**.
2. Publish the complete contents of `firestore.rules` in Firestore → Rules. Or sign in with `npx firebase login`, then run `npm run deploy:rules`. Deploy `firestore.indexes.json` with `npx firebase deploy --only firestore --project shoppendo-1a86c` to disable unnecessary indexing of the nested categories.
3. In Authentication → Settings → Authorized domains, add `localhost` if needed for the web preview.

Republish `firestore.rules` when updating to the single-document schema. Reload the updated app on all devices: older versions write subcollections and cannot sync with the new rules. Existing shared shops migrate automatically when opened, joined, or edited; their old subcollections remain read-only backups. Migration preserves shop IDs, category/item IDs, order, checked state, deletions, and unsent local edits. Local-only lists keep working unchanged.

Private lists remain local until Share is used. First sharing and joining need an internet connection. Already joined lists can be edited offline; a durable local outbox retries writes every 15 seconds while the app is active and when it returns to the foreground. The Firebase JS SDK does not provide persistent Firestore caching on React Native, so AsyncStorage owns the local copy and unsent writes.

Publishing security rules does not upload lists. To upload a local shop, open it and choose **⋯ → Share shop ID**. The Share screen verifies the server document before displaying its code. If an already-shared document is missing, the updated app restores it from the complete saved local shop when watching, syncing, or sharing again. Existing remote documents are never replaced with stale local copies during this recovery.

Each shop has a cryptographically random 100-bit ID. Knowing the ID is permission to read and edit that entire shop after anonymous authentication; new shops need no membership documents. Rules forbid listing/deleting shops, validate the document envelope and immutable creation time, and reject unrelated collections. The app validates nested categories and items before accepting snapshots or sending writes. Store IDs are invitations; share them only with people you want editing the list.

Each shared shop is one Firestore document at `shops/{shopId}`. `categories` is a nested map, and each category contains an `items` map; these are fields, not subcollections or a JSON string:

```text
shops/{shopId}
  schemaVersion: 2
  name, createdAt, groupOrder
  categories
    {categoryId}
      name, icon, createdAt, deleted
      items
        {itemId}: { name, done, deleted, createdAt, updatedAt, position }
```

One document listener receives the whole shop. Edits are saved locally immediately and collected over a 750 ms window before syncing, so quick checks and category edits share a transaction. Explicit sync, sharing, and app state transitions flush immediately. Local preferences and incoming snapshots do not trigger a send. Each sync combines all pending changes for a shop in one transaction: normally one document read and one document write, plus one document read for each listening device receiving the update. Unchanged edits are not queued; retries or batches already matching the server skip the write (the transaction still reads once). Transactions retry against the latest document to preserve concurrent edits to different items or fields; same-field edits use last-write-wins. Joining reads one document and does not write membership. Migration performs extra reads/writes once. Offline changes remain in the local outbox until the transaction can run online.

The whole shop is transferred on updates, and Firestore limits a document to 1 MiB, including retained tombstones. This design suits small shopping lists; split documents again if lists approach that size or many people edit at once. Item and category tombstones keep older offline copies from resurrecting deleted records. Keep the shared shop ID to rejoin after clearing app data.

Reference: [Expo Firebase integration](https://docs.expo.dev/guides/using-firebase/), [Firebase supported environments](https://firebase.google.com/docs/web/environments-js-sdk).

## Checks

```sh
npm run typecheck
npm test
npm run test:rules
npm run export
```

The rules check runs against `demo-shoppendo` on a local emulator, never the live database. It needs Java 21+. Tests cover access control, two users adding concurrently, realtime changes, offline snapshot merging, completed items, category ordering in flat lists, view preferences, order preservation, and durable serialization.

Run `npm run check:firebase` after enabling Anonymous and publishing the rules to verify the live project's authentication and that listing all shops is denied. This creates and removes a temporary anonymous test identity; it does not write any shop data.

For manual emulator testing, run `npm run emulators` and set these values in `.env.local`, then restart Expo:

```dotenv
EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-shoppendo
EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1
```

Use your computer's LAN IP instead of `127.0.0.1` when testing an emulator from a physical phone. Remove the emulator host and restore the real project ID before using the live backend.

## Installable builds

```sh
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile production
```

The preview Android profile creates an APK. EAS requires an Expo account; iOS device distribution also requires Apple signing credentials. Builds and store submissions are not performed automatically. Native project folders are generated by Expo when needed.

### Install on an iPhone from a Mac

To build and install an app that launches without Metro running:

```sh
npm ci
npm run ios:release
```

Select the connected iPhone when prompted. This uses Xcode's **Release** configuration and embeds the JavaScript bundle. `expo run:ios` without `--configuration Release` defaults to **Debug**. The existing `npm run ios` starts Expo Go; it does not compile a standalone app.

If building directly in Xcode, open `ios/Shoppendo.xcworkspace`, select the iPhone, then choose **Product → Scheme → Edit Scheme → Run → Info → Build Configuration → Release** and build again. Set your Apple development team in **Signing & Capabilities** if prompted.

### iOS: “No script URL provided”

This error means the native app cannot find a JavaScript bundle. A Debug build needs a reachable Metro server; for an installed app that runs independently, rebuild using Release as above. Changing `app.json`'s bundle identifier or `package.json`'s `main` does not supply the missing bundle: `index.ts` already registers the Expo root component.

If a Release build still reports this error, check the app target's **Build Phases → Bundle React Native code and images**. It must run Expo's `export:embed` bundling through `react-native-xcode.sh`. Check `ios/.xcode.env`, `ios/.xcode.env.local`, and the build environment for `SKIP_BUNDLING`; leave it unset for Release. The built `.app` should contain `main.jsbundle`. Inspect this phase's build log for skipped bundling or errors.

The `.gitignore` entries for `ios/`, `android/`, and `dist/` are intentional. Expo generates native projects and bundles during a build; these outputs do not need committing. EAS also uses `.gitignore` when `.easignore` is absent and generates the excluded native projects with Prebuild. `npm run export` checks JavaScript bundling but does not install that output into an existing Xcode app.

References: [Expo local builds](https://docs.expo.dev/guides/local-app-development/), [EAS ignore rules](https://docs.expo.dev/build-reference/easignore/).

The shop header has a Share button. Copying an existing shared ID works offline. Stop sharing replaces the remote contents with a disabled invitation and keeps a local copy under a new ID. Existing devices retain their downloaded copies. Publish the current firestore.rules before using Stop sharing; stopped IDs cannot be reactivated.

### Store sharing links

Each store row has a three-node Share icon: outlined for local stores, with filled nodes for shared stores. It opens that store's sharing panel without opening the store. The grey backdrop appears immediately and only the white panel slides up. Back navigation takes 340 ms and respects reduced-motion settings.

**Share link** sends `https://shoppendo-1a86c.web.app/join/SHOP_ID`. The website and native app accept these links, join the store, and open it once local lists finish loading. Invalid links are ignored and failed joins show a Retry button. The panel still offers Copy shop ID for manual joining.

Build the website with `npx expo export --platform web`, then publish it with `npx firebase deploy --only hosting --project shoppendo-1a86c`. The Hosting configuration serves the app for `/join/*` paths. Hosting must be published before links work for other people; sharing a link does not publish the website.

On the website, **Open app** uses `shoppendo://join/SHOP_ID`, which requires an installed standalone build containing this link handler. Automatic HTTPS-to-app opening is prepared in `app.json`, but requires hosting `/.well-known/apple-app-site-association` with the Apple Team ID and bundle identifier, and/or `/.well-known/assetlinks.json` with the Android package and signing SHA-256 fingerprint. These identifiers are not available yet, so shared links currently target the website. Rebuild the native app after configuring domain associations. See [Expo iOS Universal Links](https://docs.expo.dev/linking/ios-universal-links/) and [Android App Links](https://docs.expo.dev/linking/android-app-links/).

To change the website address later, update `SHARE_ORIGIN` in `src/links.ts` and both domain entries in `app.json`, and publish the website and association files on that domain.
