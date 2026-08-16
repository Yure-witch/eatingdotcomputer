# ✅ Native Push — do-this-then-check-it-off

The code is already done. These are the account/config steps only you can do.
Do them top to bottom. Anything with `!` you can run right in the Claude prompt.

---

## 1. Create the database table (30 seconds, safe)

- [ ] Run it:
  ```
  ! npm run migrate
  ```
  It only applies the ONE new migration (`058_apns_tokens.sql`) — a brand-new
  empty `apns_tokens` table. It skips everything already applied and never
  touches existing data. You'll see `apply 058_apns_tokens.sql` then `done`.

---

## 2. Get your APNs key from Apple (~3 minutes)

- [ ] Go to **[developer.apple.com](https://developer.apple.com/account) → Keys**.
- [ ] Click **➕**, name it `eating.computer push`, tick **Apple Push
      Notifications service (APNs)**, **Continue → Register**.
- [ ] **Download** the `.p8` file (you can only download it ONCE — keep it safe).
- [ ] Write down the **Key ID** (10 characters, shown on the key page).
- [ ] Get your **Team ID**: top-right of the Developer site → **Membership** →
      "Team ID" (10 characters).

---

## 3. Add 4 environment variables in Vercel (~2 minutes)

Vercel → your project → **Settings → Environment Variables** (Production):

- [ ] `APNS_KEY` → open the `.p8` in a text editor and paste the WHOLE contents
      (the `-----BEGIN PRIVATE KEY-----` … `-----END PRIVATE KEY-----` block).
- [ ] `APNS_KEY_ID` → the Key ID from step 2.
- [ ] `APNS_TEAM_ID` → the Team ID from step 2.
- [ ] `APNS_BUNDLE_ID` → `computer.eating.app`
- [ ] **Redeploy** (Vercel → Deployments → ⋯ → Redeploy) so the env is live.

> Until these are set, native push is simply silent — the web app is unaffected.
> **Testing tip:** if you're running a build straight from Xcode onto your phone
> (a *development* build), also add `APNS_HOST` =
> `https://api.sandbox.push.apple.com`. Remove it for the real App Store build.

---

## 4. Turn on Push in Xcode (~1 minute)

- [ ] Open the project:
  ```
  ! npm run cap:ios
  ```
- [ ] Select the **App** target → **Signing & Capabilities**.
- [ ] Click **➕ Capability** → double-click **Push Notifications**.
- [ ] Back in the terminal, sync it:
  ```
  ! npm run cap:sync
  ```

---

## 5. Test it (~2 minutes)

- [ ] Run the app on your iPhone from Xcode (**▶**). Accept the notification
      prompt when it appears.
- [ ] Sign in, then have someone (or a second account) send you a chat DM.
- [ ] You should get a banner notification. Tapping it opens that chat.

If nothing arrives: check the 4 env vars are on **Production** and you redeployed,
and that (for an Xcode build) `APNS_HOST` is set to the sandbox URL.

---

Done? Native push works for every notification the app already sends — chat,
DMs, mentions, and Gemma digests — with no further code changes.
