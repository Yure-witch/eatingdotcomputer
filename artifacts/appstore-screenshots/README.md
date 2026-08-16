# App Store screenshots

**Real** captures of the live app, signed in as the App Store review account, at
**1290 × 2796** (iPhone 6.9"). App Store Connect uses this one iPhone set for
every iPhone size.

| File | Screen |
|------|--------|
| `real-01-home.png` | Home — the week's assignment + a task |
| `real-02-chat.png` | Class channel — expressive typography, emotes, code blocks |
| `real-03-todos.png` | Tasks — Gemma-kept to-dos |
| `real-04-orbit.png` | Orbit — Roadmap + Syllabus |
| `real-05-weeks.png` | Weeks timeline |
| `real-06-picker.png` | Expression picker (emoji / GIF) |
| `real-07-gemma.png` | Gemma digest with an algorithmic recommendation |

Upload 3–6, strongest first — a good default is: chat → picker → home →
orbit/syllabus → Gemma. Listing copy (name, keywords, description, privacy) is
in `../../APP_STORE_LISTING.md`. The **app icon** source is `icon-1024.html`
→ rendered to `../../resources/icon.png` (1024×1024, brand green + black e).

## Regenerate

1. Dev server up on :5175 (`npm run dev -- --port 5175`).
2. Make sure the review account exists: `node scripts/create-reviewer.js <user> <pass>`.
3. Capture (headless Chrome via Puppeteer):
   ```
   node artifacts/appstore-screenshots/_capture.mjs <user> <pass>
   ```
   The password is passed in, never stored here. The Tasks/Gemma screens read
   seeded content on the review account (a few tasks + a Gemma digest); the
   picker shot is captured by clicking the compose expression button.

> These are literal screens of the running app — not mockups. Colours, fonts,
> emotes, and the syntax highlighting are exactly what a student sees.
