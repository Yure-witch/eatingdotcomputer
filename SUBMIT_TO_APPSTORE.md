# Ship eating.computer to the App Store

Do these top to bottom. Steps marked **YOU** need your Apple account and only
you can do them. Steps marked **CLAUDE** I can run.

Repo-side native work is already done and verified (see NATIVE_PUSH_TODO.md §4).

---

## ⚠️ Read this first: the one real rejection risk

The app loads the live site via `server.url` in `capacitor.config.ts` — it is a
native shell around a remote web app. Apple **Guideline 4.2 (Minimum
Functionality)** rejects apps that are "just a website in a wrapper."

You are not defenceless here — the app genuinely does native things:
push notifications (APNs), the keyboard-aware compose bar, haptics, status bar
integration, and the in-app creative tools. But you must *say so*, in the App
Review notes, or a reviewer may not notice.

The review notes in `APP_STORE_LISTING.md` are written for exactly this. Use
them verbatim. This is the single most likely reason for a first rejection.

---

## 1. ✅ Apply migration 058 — DONE (2026-08-18)

- [x] `npm run migrate` run against production. `apns_tokens` table +
      `idx_apns_tokens_user` index confirmed created, 0 rows. All prior
      migrations skipped, no existing data touched.

---

## 2. Get your APNs key — **YOU** (~3 min)

- [ ] [developer.apple.com](https://developer.apple.com/account) → **Keys** → **➕**
- [ ] Name `eating.computer push`, tick **Apple Push Notifications service (APNs)**
- [ ] **Continue → Register → Download** the `.p8` — you get ONE download, keep it safe
- [ ] Note the **Key ID** (10 chars). Your **Team ID** is `2DA4GWZYAS`.

---

## 3. Set Vercel env vars — **YOU** (~2 min)

Vercel → project → **Settings → Environment Variables** (Production):

- [ ] `APNS_KEY` — the whole `.p8` contents, including BEGIN/END lines
- [ ] `APNS_KEY_ID` — `89L54FU472`  *(key "eatingdotcomputer push", created 2026-08-18)*
- [ ] `APNS_TEAM_ID` — `2DA4GWZYAS`
- [ ] `APNS_BUNDLE_ID` — `computer.eating.app`
- [ ] **Redeploy** so the env goes live

> For testing from Xcode onto your own phone, also add
> `APNS_HOST` = `https://api.sandbox.push.apple.com`.
> **Remove it before you archive for the Store** — a production build talks to
> the real APNs host and will fail silently against sandbox.

---

## 3b. Add the Google iOS client ID to Vercel — **YOU**

Native Google sign-in needs this in **Production** (it's a public client ID, not
a secret):

- [ ] `PUBLIC_GOOGLE_IOS_CLIENT_ID` =
      `442315561548-coa0c20jk7vh6e75arof838u9ve4msgp.apps.googleusercontent.com`

> ⚠️ **The web changes must be DEPLOYED for native Google sign-in to work.**
> The shell loads the live site (`server.url`), so the login page the app runs
> is whatever is on Vercel — not what's in this repo. Deploy before testing.

---

## 3c. Enable Sign in with Apple on the App ID — **YOU** (~1 min)

Sign in with Apple is BUILT (Guideline 4.8 cover). The code, entitlement and
button are done; the App ID needs the capability switched on:

- [ ] [developer.apple.com](https://developer.apple.com/account) → **Identifiers**
      → `computer.eating.app` → tick **Sign In with Apple** → **Save**

Xcode's automatic signing usually adds this on the first device build, but if
you see a provisioning error about `com.apple.developer.applesignin`, this is
the fix.

> **Known gap:** Apple sign-in is native-only. Someone who creates their account
> with Apple in the iOS app has no way to log in on the web (there's no Apple
> flow configured there — that needs an Apple Services ID, a key, and domain
> verification). Fine for review; worth closing later if anyone actually uses it.

---

## 4. Create the App Store Connect record — **YOU** (~5 min)

[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps → ➕**

- [ ] Platform **iOS**, Name **eating.computer**, Primary language **English (U.S.)**
- [ ] Bundle ID — pick `computer.eating.app` from the dropdown
- [ ] SKU — anything unique, e.g. `eatingcomputer001`
- [ ] Full access

---

## 5. Test push on a real device — **YOU** (~10 min)

- [ ] `npm run cap:ios`, pick your iPhone, hit ▶
- [ ] Accept the notification permission prompt
- [ ] Sign in, then have a second account DM you
- [ ] Banner should arrive; tapping it should open that chat

If nothing arrives: confirm step 1 ran, the 4 env vars are on **Production**,
you redeployed, and `APNS_HOST` is set to sandbox for this build.

**Do not skip this.** It is the only way to know the whole chain works before
you submit.

---

## 6. Pre-archive checklist — **CLAUDE can verify**

- [ ] `capacitor.config.ts` `server.url` is `https://www.eating.computer`
      (NOT a local `192.168.x.x` — that ships a broken app)
- [ ] `APNS_HOST` sandbox override removed from Vercel
- [x] ✅ `isInspectable` in `AppDelegate.swift` now wrapped in `#if DEBUG`
      (2026-08-18) — the shipping build no longer exposes the web view to
      Safari's Web Inspector. Both Debug and Release verified building.
- [ ] Bump `CURRENT_PROJECT_VERSION` if you upload more than once (each upload
      needs a unique build number; `MARKETING_VERSION` stays `1.0`)

---

## 7. Archive and upload — **YOU** (~15 min)

- [ ] In Xcode, set the destination to **Any iOS Device (arm64)** — not a simulator
- [ ] **Product → Archive**
- [ ] When the Organizer opens: **Distribute App → App Store Connect → Upload**
- [ ] Let it auto-manage signing; accept the defaults
- [ ] Wait for the "processing complete" email (usually 5–30 min)

---

## 8. Fill in the listing — **YOU** (~20 min)

Everything you need is written in `APP_STORE_LISTING.md` — copy/paste it.

- [ ] Name, subtitle, promo text, keywords, description
- [ ] **Screenshots** — `artifacts/appstore-screenshots/real-01..07-*.png`,
      already at the required 1290×2796. Upload 3–6, strongest first.
- [ ] Category: Education (primary), Social Networking (secondary)
- [ ] Age rating questionnaire — answer honestly, expect 12+ (user-generated content)
- [ ] **App Privacy** — must match `PrivacyInfo.xcprivacy`: Email, Name, Photos/Videos,
      Other User Content; all linked to user, all App Functionality, none for tracking
- [ ] Support URL: `https://www.eating.computer`

---

## 9. App Review information — **YOU** — don't rush this

- [ ] **Demo account** — username + password for an account already approved into
      a class, so the reviewer lands straight in the app. Without this they hit
      the enrollment gate and reject for incomplete functionality. Verify it
      works in a private window before submitting.
- [ ] **Notes** — paste the review notes from `APP_STORE_LISTING.md`. This is
      your Guideline 4.2 defence. Do not leave it blank.

---

## 10. Submit — **YOU**

- [ ] Select the build, **Add for Review → Submit**
- [ ] Typical review time is 24–48 hours

If rejected, it will most likely be 4.2. The answer is to point at push, the
native tools, and the keyboard handling — not to argue. Reply in Resolution
Center and it usually goes through on the second pass.
