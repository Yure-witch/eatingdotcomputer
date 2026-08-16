# App Store screenshots

Ready-to-upload iPhone screenshots for App Store Connect, **1290 × 2796**
(6.9"/6.7" portrait). App Store Connect uses this one iPhone set for every
iPhone size, so no separate 6.5" set is needed.

| File | Screen | Caption |
|------|--------|---------|
| `01-chat.png` | Chat + expression picker | Say it with your whole chest |
| `02-lab.png` | Text GIFs (the Lab) | Make 3D type in seconds |
| `03-roadmap.png` | Assignments / roadmap | Every deadline, one place |
| `04-gemma.png` | Gemma digest | Your class, quietly on track |
| `05-profile.png` | Profile | A corner of the internet that's yours |

Upload 3–6, strongest first (the order above is a good default). Description,
keywords, and privacy answers are in `../../APP_STORE_LISTING.md`.

## Regenerate
These are rendered from `screenshot.html` (one shot per `?i=1..5`) with headless
Chrome. Render each as a SEPARATE call (a tight loop races and shifts the
output), each with its own `--user-data-dir`:

```bash
CH=".../chrome-headless-shell"
SRC="file://$PWD/screenshot.html"
shoot() { local p; p=$(mktemp -d); "$CH" --headless --disable-gpu --no-sandbox \
  --user-data-dir="$p" --force-device-scale-factor=1 --window-size=1290,2796 \
  --virtual-time-budget=2500 --screenshot="$2" "${SRC}?i=$1" 2>&1 | tail -1; rm -rf "$p"; }
shoot 1 01-chat.png; shoot 2 02-lab.png; shoot 3 03-roadmap.png
shoot 4 04-gemma.png; shoot 5 05-profile.png
```

> These are polished **marketing** screenshots built from the app's real UI
> patterns. For literal captures of the live app, run it in the iOS Simulator,
> ⌘S each screen, and drop the caption from the matching frame on top.
