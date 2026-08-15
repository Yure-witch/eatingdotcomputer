# Native app (Capacitor) — build & ship guide

The iOS app is a **native shell around the live site**. It loads
`https://eating.computer` in a native web view and adds native plugins
(Keyboard, StatusBar, Haptics). No backend rewrite — every SvelteKit server
route keeps working exactly as on the web.

- Config: `capacitor.config.ts`
- Offline fallback page: `capacitor-shell/index.html`
- JS bridge (inert on web): `src/lib/native.js`
- "Get the app" web banner: `src/lib/components/GetAppBanner.svelte`

The web app is **unchanged** — nothing here affects the PWA/browser build.

---

## One-time setup (your Mac)

You need: **Xcode**, **CocoaPods**, and an **Apple Developer account** ($99/yr)
for App Store distribution.

```bash
# CocoaPods (if not installed)
sudo gem install cocoapods         # or: brew install cocoapods

# Generate the native iOS project (creates ./ios)
npx cap add ios

# Copy config + plugins into the native project
npm run cap:sync
```

> `ios/` is a generated native project. You can commit it or gitignore it —
> committing lets you track signing/Info.plist changes; ignoring keeps the
> repo clean and regenerates via `cap add ios`. Your call.

### App icon + splash

```bash
# Put a 1024×1024 PNG at resources/icon.png (and optional resources/splash.png)
npx @capacitor/assets generate --ios
```

---

## Run it on your iPhone

```bash
npm run cap:ios        # opens Xcode
```

In Xcode:
1. Select the **App** target → **Signing & Capabilities** → pick your **Team**.
2. Confirm the bundle id is `computer.eating.app` (matches `capacitor.config.ts`).
3. Plug in your iPhone, select it as the run destination, press **▶**.

The app launches and loads the live site, now with the **native keyboard** —
the compose bar rides above the real keyboard instead of the web suppression
hacks. Test the chat compose + expression picker here; this is the whole point.

### Testing an in-progress dev build (optional)

To point the shell at your local dev server instead of production, edit
`capacitor.config.ts`:

```ts
server: { url: 'http://192.168.x.x:5175', cleartext: true }   // your Mac's LAN IP
```

Then `npm run cap:sync` and re-run. Revert before shipping.

---

## Ship to the App Store

### Pre-submission checklist (do these once)

- [ ] **Apple Developer Program** membership active ($99/yr) — apple.com/developer.
- [ ] **Register the bundle id** `computer.eating.app` (Certificates, IDs &
      Profiles → Identifiers) — or let Xcode auto-register it on first signed build.
- [ ] **Signing**: Xcode → App target → Signing & Capabilities → select your Team,
      "Automatically manage signing" on.
- [ ] **Add `PrivacyInfo.xcprivacy` to the App target.** The file lives at
      `ios/App/App/PrivacyInfo.xcprivacy` but creating it isn't enough — in Xcode,
      drag it into the **App** group and tick the **App** target so it ships in the
      bundle. (Declares tracking = false + Capacitor's UserDefaults required-reason.)
- [ ] **Info.plist is ready** — already includes `ITSAppUsesNonExemptEncryption`
      (skips the export-compliance prompt) and camera/photo/mic usage strings (so
      the web view's pickers don't crash). No action needed.
- [ ] **Version/build**: bump `MARKETING_VERSION` (e.g. 1.0.0) and
      `CURRENT_PROJECT_VERSION` (build number) in the App target's build settings
      for each upload.
- [ ] **App icon** present (`npx @capacitor/assets generate --ios` from a
      1024×1024 `resources/icon.png`).
- [ ] **Screenshots**: capture in the iOS Simulator at the required sizes —
      6.7" (1290×2796) and 6.5" (1242×2688) iPhone are the two Apple requires;
      iPad only if you list iPad support.

### ⚠️ Notifications don't work in the shell yet

The web app's push (web-push/VAPID) works in **Safari and installed PWAs**, but
**NOT inside a WKWebView** — so a user running the App Store build gets **zero
push notifications**. For a chat app that's a real gap, and it also weakens the
4.2 "minimum functionality" defense. The fix is native push:
`@capacitor/push-notifications` (APNs) + an APNs key in App Store Connect + the
server routing chat notifications to APNs for native device tokens. Decide
before launch whether to ship with this or note it as a fast-follow.

### Upload + submit

1. In Xcode: **Product → Archive**.
2. **Distribute App → App Store Connect → Upload**.
3. In [App Store Connect](https://appstoreconnect.apple.com): create the app
   listing (name, subtitle, screenshots, description, keywords, support URL,
   **App Privacy questionnaire** — mirror `PrivacyInfo.xcprivacy`: email, name,
   photos, user content; all "app functionality," no tracking — and an age
   rating), attach the build, **Submit for Review**.
4. Optional but recommended: push the build to **TestFlight** first and install
   it on your own device to smoke-test before review.

> **Heads-up on App Store Review Guideline 4.2 ("minimum functionality").**
> Apple can reject thin "just a website" wrappers. Our case is helped by real
> functionality (auth, real-time chat, assignments) and the native keyboard
> integration; it's strengthened further by adding **native push**
> (`@capacitor/push-notifications` + APNs) down the line. If 4.2 comes up,
> lead with the native keyboard + push + offline fallback.

---

## After approval — light up the web banner

Once the app is live, copy its App Store URL into:

```js
// src/lib/native.js
export const APP_STORE_URL = 'https://apps.apple.com/app/idXXXXXXXXXX';
```

That's the only change needed — the `GetAppBanner` then appears for
mobile-web visitors (touch browsers only; never desktop, never inside the
native app), prompting them to install. It's dismissible and remembers the
dismissal.

---

## Updating the app later

Because the shell loads the live site, **most updates ship with a normal
Vercel deploy** — no App Store resubmission. You only rebuild/resubmit the
native app when you change native config, plugins, icons, or the iOS project
itself.
