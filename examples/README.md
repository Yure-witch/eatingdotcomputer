# Telegram animated emoji — refresh workflow

When Telegram adds or changes animated emoji, re-run these in order to refresh
your local pull + R2 assets + manifest.

## One-time setup

1. Telegram API creds at <https://my.telegram.org/apps> (app name doesn't matter).
   ```bash
   export TG_API_ID=…
   export TG_API_HASH=…
   ```
2. R2 creds in `.env` (already set: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL`).
3. Python deps: `pip install telethon emoji`. Node deps already in `package.json`.
4. (Only first time) Apply R2 CORS so the browser can fetch JSON cross-origin:
   ```bash
   node examples/set_r2_cors.mjs
   ```

## Refresh from Telegram → R2

```bash
# 1. Pull every official sticker set + unpack TGS → Lottie JSON.
#    Interactive first run: prompts phone + Telegram-sent code.
python3 examples/telegram_animated_emoji.py \
    --out ./telegram_official_emoji --unpack-tgs

# 2. Probe the AnimatedEmojiAnimations set for TRUE per-doc emoji mapping
#    (Sticker.alt, not the buggy 1⃣ mega-pool packs). Writes /tmp/anim_mapping.json.
python3 examples/probe_animations.py

# 3. Build the cp→category map (Smileys, People, …) from the Tarikul repo
#    folder structure. Refetch the repo file list first:
gh api "repos/Tarikul-Islam-Anik/Telegram-Animated-Emojis/git/trees/main?recursive=1" \
    --jq '.tree[] | select(.path|endswith(".webp")) | .path' \
    > /tmp/repo_webp_paths.txt
python3 examples/gen_categories.py

# 4. Upload the standard animated set + flags + initial (buggy-keyed)
#    animations + manifest. Idempotent — overwrites.
node examples/upload_telegram_emoji.mjs

# 5. Re-key the animations under TRUE cp_index keys, fix manifest `av` counts,
#    and delete the old bad keys. Reads /tmp/anim_mapping.json from step 2.
node examples/rekey_animations.mjs
```

The client picks up the new manifest automatically on next page load (it's
served with `Cache-Control: max-age=60`).

## What each script does

| script | language | purpose |
|---|---|---|
| `telegram_animated_emoji.py`  | Python | pull all official sticker sets via MTProto, unpack `.tgs` → Lottie JSON |
| `probe_animations.py`         | Python | dump `doc_id → real-emoji` for the AnimatedEmojiAnimations set |
| `gen_categories.py`           | Python | derive `cp → category` from Tarikul repo folder names |
| `upload_telegram_emoji.mjs`   | Node   | gzip + upload animated/animations/flags + master `manifest.json` to R2 |
| `rekey_animations.mjs`        | Node   | re-key the animations with the true mapping + patch manifest `av` counts |
| `set_r2_cors.mjs`             | Node   | one-time R2 bucket CORS (`Allowed-Origin: *`, GET/HEAD) |

## How to check whether anything actually changed

After step 5 the script prints how many emoji entries it patched. If everything
is `0`, Telegram hasn't changed anything since your last refresh.
