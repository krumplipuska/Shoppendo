# Shoppendo

A small shopping list app for Android, iOS, and a browser. The approved [Figma concept](https://www.figma.com/design/iV6O7KHnHgNp5kF6LHAkNj?node-id=3-13) is implemented with React Native and Expo SDK 58.

## Run

Use Node.js 24 LTS, then:

```sh
npm install
npm start
```

Scan the QR code with the current Expo Go app on Android or iPhone. Press `w` for a browser preview, or run `npm run web`. Windows cannot run the iOS simulator; Expo Go on an iPhone or an EAS iOS build works instead.

## What it does

- Use the Stores **+** button to reveal inline create/join controls near the top. Store badges show their initials and distinct accents; new stores start with six standard groups. Tap anywhere on a store row to open it.
- A shop slides up from the bottom over 240 ms without bounce when opened. Swipe left on the header to slide back to Stores, swipe from the left edge toward the right for the normal back gesture, or pull down on the header to dismiss downward. A large downward pull from the list body also follows the finger and dismisses when the list was already at its top; short pulls return to place. The previous screen stays underneath during interactive gestures. Back buttons and Android hardware back also animate. Reduced-motion settings are respected.
- Each shop has one item list with category icons. There is no grouped view or view selector. Items use category/manual order by default. Done stays at the bottom, shows category icons, and always puts the newest completed item first. **⋯ → Sort items** selects group/manual order, name (A–Z), or time added (oldest first). The saved category order belongs to each shop and drives both **By group** sorting and the category buttons in the item editor. Sorting is saved on this device and does not change another person’s view.
- The top **+** opens an inline item-name field and solid-color category buttons with white icons and black names underneath in either view. Its category **+** opens a compact name-and-icon panel in the same composer and selects the category after saving. A check badge and a text label identify the selected category. The composer scrolls within the space above the keyboard. Add/Return keeps it ready for another item. Tapping outside accepts a non-empty draft and closes the keyboard. **⋯ → Share shop ID** opens sharing.
- The menu has separate **Sort items** and **Categories** sections. **Categories → Add group** opens name/icon setup; **Group sorting** fills the screen below the header with a drag-only category list. Hold anywhere on a row, including its text, to move it. Changes stay in a draft and apply once on Done or Back; the store list stays unchanged until then.
- Typing suggests up to five names from items saved in local lists, including completed and removed items. Matching is case-insensitive; current-store history is preferred and other stores map categories by name. Removed categories are excluded. Selecting a suggestion fills its name and category for review, then hides suggestions until the text changes again. A manual category choice stays selected while typing.
- In list view, tap an item's category icon to edit its name and category together using the same composer. Save with the checkmark, Return, or an outside tap; its icon and sorted position then update. Completed items keep their checked state when reassigned.
- Adding an item keeps the composer open and immediately slides a named “Added” card from the input down into the list area over 650 ms in a layer above the entire entry panel, then fades it after 850 ms. The actual new row also slides/fades in over 420 ms. Reduced-motion settings are respected.
- Tap an item's checkbox to animate its checkmark and cross it out in place for one second, then slide it down into **Done**. Checks save immediately, including if you navigate away during the animation. Tap the checkbox again to restore its group and position.
- Hold directly on a store or group name, or tap an item name, to edit directly under the header; editors stay at the top of the visible panel above the keyboard. Store-list renaming scrolls its editor to the top. Save with the checkmark, Return, or a tap outside. Outside taps also accept non-empty new stores, groups, and items. Cancel explicitly discards a name edit; empty drafts close without creating anything.
- Choose from 32 category icons. Manual category ordering is available in **⋯ → Group sorting** and applies to that shop when the panel closes. This panel does not rename, change icons, or delete categories.
- Hold outside the name on a store or group row to drag it. Hold outside the text on an active item row to drag it. Tap directly on the item text or its category icon to open the same inline name-and-category editor. Blank row space does not open editing. No grab icons are shown. Drop a category on another row in the category-order panel to reorder it. Drop an item on another item to place it before or after that row, or change its category in the item editor, including to an empty category. In list view, dropping on an item in another category moves it there. On the web, focus a row and use Alt+Up/Down to reorder; press F2 to edit stores and groups.
- Stores and categories use distinct, deterministic accent colors that remain consistent when names or order change. The store icon and name sit in the top bar. Hold its name to rename the store inline, including in the Stores list.
- Swipe left on a store, group, or item to change only its right-side action into a red Delete button. The original action crossfades into Delete progressively with your finger movement while the row stays stationary. Release past the threshold to keep Delete visible; shorter swipes return to the original action. Tap elsewhere or swipe right to restore the original action. Undo is available for eight seconds. Removing a store affects this device; deleting a group also hides its items, and Undo restores them.
- Short timing transitions and fades smooth list changes without spring bounce and respect reduced-motion settings. Scroll views do not bounce. A topmost drag overlay shows the lifted row at the grab position in both directions. The shop uses a gesture-aware scroll view with an explicit simultaneous relationship for top-of-list pull-to-dismiss, while held drags suspend native scrolling and retain edge auto-scrolling. Nearby item rows shift smoothly to leave a gap at the proposed drop location; canceling a drag restores their positions without saving changes.
- Share a shop ID; another person chooses **+ → Join by ID**. Everyone uses the same groups, group order, items, and completed state. Collapsed groups, store ordering, and view mode remain personal preferences on each device.

The app starts with no stores. New stores include Fruits, Bakery, Dairy, Meat & fish, Frozen, and Cleaning. Existing groups are preserved. All local lists and pending shared edits are stored on the device. There are no quantities, notes, sign-up, or account screens.

## Firebase

The supplied project is `shoppendo-1a86c`. Its public web app configuration lives in the git-ignored `.env.local`. For a different project, copy `.env.example` to `.env.local` and fill in the four values. These are client identifiers, not a service-account key. Restart Expo after changing them.

Before using live sharing:

1. In Firebase Console → Authentication → Sign-in method, enable **Anonymous**.
2. Replace the temporary open Firestore rules with the complete contents of `firestore.rules`, and publish. Or sign in with `npx firebase login`, then run `npm run deploy:rules`.
3. In Authentication → Settings → Authorized domains, add `localhost` if needed for the web preview.

Republish `firestore.rules` after updating from the original app: the schema allows group icons, item positions, moves between existing groups, and group deletion tombstones. Old lists remain compatible. View preferences stay local and need no rule changes.

Private lists remain local until Share is used. First sharing and joining need an internet connection. Already joined lists can be edited offline; a durable local outbox retries writes every 15 seconds while the app is active and when it returns to the foreground. The Firebase JS SDK does not provide persistent Firestore caching on React Native, so AsyncStorage owns the local copy and unsent writes.

Each shop has a cryptographically random 100-bit ID. Knowing the ID is permission to join and edit that shop. Rules forbid listing shops, require anonymous authentication, restrict item/group access to members, validate records, and reject unrelated collections. Do not replace these rules with public read/write rules. Store IDs are invitations; share them only with people you want editing the list.

Items are separate Firestore documents, so concurrent additions do not replace the entire list. Partial writes avoid overwriting unrelated fields; simultaneous changes to the same field or group order use last-write-wins. Item and group deletes use tombstones so older cached lists cannot resurrect deleted records. With no registered account, clearing app data loses device membership; keep a shared shop ID to rejoin it.

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
