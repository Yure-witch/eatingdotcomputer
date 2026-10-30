# eating.computer Work Archive: protocol for AI agents

`eating.computer/work-archive@1` · https://www.eating.computer/work-archive/PROTOCOL.md
JSON Schema: https://www.eating.computer/work-archive/manifest.schema.json ·
Reference uploader: https://www.eating.computer/work-archive/upload.mjs

You are an AI agent helping a student in **Interactive Design Concepts**, a class on
eating.computer. The instructor is building a permanent record of **everything
students in the class have made with AI**. The record documents the class and helps
keep it funded. Your job is to produce the most complete and honest record of this
student's work that you can, with as many images as you can gather, and then upload
it.

The upload has two parts:

1. **`manifest.json`**: an exhaustive, structured JSON record of every project,
   experiment, and idea, including how AI was used, what the student did, what they
   learned, and where each fact came from.
2. **The files**: an archive of images and other media (screenshots, process shots,
   sketches, photos, short recordings, PDFs). Every file is referenced from the
   manifest.

Read this whole document before you start. Follow the steps in order.

---

## 0. Ground rules

1. **The student is in charge.** Ask before you look anywhere. Show them everything
   before you upload, and remove anything they ask you to remove. Nothing is uploaded
   without their explicit consent (step 6).
2. **Be exhaustive.** Include finished work, unfinished work, prototypes, failed
   experiments, abandoned directions, and ideas that were never built. Include class
   assignments and also personal projects made with AI. When in doubt, include it and
   let the student take it out. A thin archive is the main failure mode here.
3. **Be truthful.** Never invent projects, dates, numbers, quotes, or outcomes. Every
   claim must trace to a source, recorded in `provenance`. Label estimates as
   estimates. Put the student's words in quotes only when they actually said or wrote
   them. If you can't tell, ask the student or mark the item `"confidence": "low"`.
4. **Protect privacy.** Leave out passwords, API keys, tokens, and `.env` contents.
   Leave out other people's private information and private messages. Strip GPS and
   EXIF metadata from images. Don't use screenshots of inboxes, DMs, or other
   people's work unless the student has permission.
5. **The upload token is a password.** It starts with `ecwa_`. Use it only in requests
   to `https://www.eating.computer/api/archive…`. Keep it in an environment variable,
   and never write it into the manifest, a project file, a commit, or a log you show
   back.

---

## 1. Set up

Keep the token in an environment variable for this session:

```bash
export EATING_ARCHIVE_TOKEN='ecwa_…'   # from the student
curl -s -H "Authorization: Bearer $EATING_ARCHIVE_TOKEN" https://www.eating.computer/api/archive
```

The response includes `you.name`, which should be the student. A `401` means the
token is wrong, expired, or revoked. In that case, ask the student to generate a new
one at https://www.eating.computer/app/archive.

**If you can't make network requests** (for example, a sandbox with no internet
access), do every step except the upload, then follow [Offline delivery](#offline-delivery).

Work in a folder of your own outside the student's projects, such as
`~/work-archive/`. Never modify the student's project folders or git repositories.

---

## 2. Ask the student about scope

Send these questions in one message and wait for the answers:

- Where does your work live? Examples: folders on this computer, GitHub, live
  websites, Figma, Google Drive, Notion, your phone's camera roll, physical sketchbooks.
- Which AI tools have you used? Examples: Claude, Claude Code, ChatGPT, Gemini,
  Cursor, Copilot, v0, Lovable, Bolt, Replit, Figma AI, Midjourney, DALL·E, Runway,
  Suno, ElevenLabs.
- May I read those folders? May I read your Claude Code session history
  (`~/.claude/projects/`) and other AI-tool histories to reconstruct your process?
  I'll summarize them and won't upload them raw.
- Is anything off-limits?
- Are there projects or ideas I won't find on this computer? Please tell me about
  them, or upload photos or screenshots here.

---

## 3. Search everywhere you're allowed

Record every place you look in `sources_searched`, including places where you found
nothing.

**On the student's computer** (Claude Code and other desktop agents):

- Find git repositories:
  `find ~ -maxdepth 5 -name .git -type d -not -path '*/node_modules/*' -not -path '*/Library/*' 2>/dev/null`
- Look in common folders: `~/Documents`, `~/Desktop`, `~/Downloads`, `~/Developer`,
  `~/Projects`, `~/code`, `~/Sites`, `~/GitHub`, `~/Documents/GitHub`.
- For each repository, read the `README`, `package.json` or equivalent, and any
  `CLAUDE.md` or `AGENTS.md` (these show AI-assisted work). Get the history with
  `git log --reverse --format='%ad %s' --date=short` (first and last dates, commit
  count, what changed). Note the remote URL. Find the deployed URL in `vercel.json`,
  `netlify.toml`, `CNAME`, or the README. Look for images in the repository.
- **Claude Code history** is the best source for process:
  `~/.claude/projects/<folder-name>/*.jsonl` holds a transcript of every session,
  grouped by project folder. Use it to find dates, key prompts, what was tried,
  what failed, and what got abandoned. Read it only with permission. Extract and
  summarize from it, and never upload transcripts.
- Read other AI tool histories (Cursor, Codex, and so on) only if the student says yes.
- Check `~/Desktop`, `~/Pictures`, and `~/Movies` for screenshots and screen
  recordings. Match them to projects by date and content, and confirm with the student.
- If the GitHub CLI is signed in, run `gh repo list --limit 200`.

**In the Claude app or claude.ai:** if past-chat search or memory is available, use
it to find conversations, artifacts, and Projects about the student's work. You
probably can't see their files, so ask them to upload screenshots and exports into
the chat.

**On the web:** visit every live URL and screenshot it.

**Other tools:** ask the student for exports, such as a ChatGPT data export, a
Midjourney or Runway gallery download, or Figma frames exported as PNG.

Before you write anything, make an inventory of every candidate project or idea
you found. You will account for each one in the manifest, either in `projects`,
`ideas`, or `omissions`.

---

## 4. Collect images (the archive is visual)

For each project, collect **1 hero image and 3–10 supporting images**. Collect more
for big projects. Useful kinds:

| `kind` | What it is |
|---|---|
| `final` | the finished piece as people experience it |
| `screenshot` | UI states, pages, and views, at desktop **and** mobile widths for web work |
| `process` | earlier versions, iterations, and before/after comparisons |
| `sketch` | hand drawings and whiteboards (photograph them) |
| `diagram` | architecture, flows, and system maps |
| `photo` | physical work, installations, and people using the work (with their consent) |
| `generated` | raw AI outputs the student selected from or built on |
| `recording` | a short (≤ 60 s) mp4/webm screen recording of motion or interaction |
| `document` | PDF decks, write-ups, and posters |

How to get them:

- **Web projects:** open the live URL, or run the project locally (only if that's
  quick and safe). Screenshot it with your browser tool or with Playwright/Puppeteer at
  **1440×900** and **390×844**.
- **Process images:** existing screenshots, older images in the repository, or, if
  it's quick, an earlier commit checked out into a separate temporary worktree
  (`git worktree add /tmp/ecwa-<sha> <sha>`). Never touch the student's working tree.
  Remove the worktree when you're done.
- **Ideas:** sketches, mood boards, generated concept images, or a screenshot of the
  note where the idea lives.
- **Don't capture** login screens, password managers, inboxes, DMs, notification
  banners, eating.computer chat, or anything showing a secret or someone else's
  private data.

File rules:

- **Formats:** use PNG for UI, JPEG or WebP for photos, and convert HEIC to JPEG.
  Accepted extensions are `png jpg jpeg webp gif avif svg heic mp4 webm mov pdf md txt`.
- **Size:** keep the long edge at 2560 px or less. Images can be up to 30 MB, video
  up to 250 MB, and PDFs up to 50 MB. A submission can hold up to 2000 files and
  3 GB in total.
- **Strip metadata**, especially GPS from phone photos. Use one of these:
  `exiftool -all= -overwrite_original FILE`, `magick FILE -strip FILE`, or re-save
  without EXIF using Pillow.
- **Names:** use lowercase kebab-case with no spaces:
  `images/<project-id>/<nn>-<what>.<ext>`, for example
  `images/plant-pal/01-hero.png`. For ideas, use `images/ideas/<idea-id>-<nn>.<ext>`.
- **Every file must be referenced** from the manifest (in an `assets` list or as
  `hero_asset`) with a caption. If a file isn't worth captioning, leave it out.

---

## 5. Interview the student

Your files show what was made. They rarely show why, or what the student learned.
Ask these questions together in one message, and tell the student that short answers
are fine:

1. Before this class, what experience did you have with code, design, and AI tools?
2. Which piece are you proudest of, and why?
3. What did AI let you make that you couldn't have made otherwise?
4. Where did AI get in your way, mislead you, or make something worse?
5. In your favorite project, what did **you** decide, design, or make that the AI didn't?
6. What did you learn (skills, concepts, ways of working)?
7. How did your process change over the term?
8. Which ideas didn't you get to build?
9. In a sentence or two, for the people who fund this class: what has it given you?
10. What advice would you give a future student?

Then ask about anything specific that's missing for a project, such as its purpose,
audience, outcome, or time spent. Record answers with `"source": "student"`.

---

## 6. Ask for consent (required)

Ask each question separately, and record the answers exactly as given. Don't assume
any of them.

| field | question to ask |
|---|---|
| `archive_for_instructor` | May your instructor keep this archive to document the class? **(Required. If no, stop: nothing is uploaded.)** |
| `use_in_funding_reports` | May it be used in reports and funding or grant applications about the class? |
| `use_in_public_showcase` | May your work be shown publicly, for example on a website, in an exhibition, or in a talk? |
| `quote_permission` | May your words be quoted? |
| `attribution` | How should you be credited: `full_name`, `first_name`, `initials`, or `anonymous`? |

Set `confirmed_by_student_at` to the ISO time when the student approves the final
review in step 8.

---

## 7. Write `manifest.json`

Put it at the top level of your archive folder, next to `images/`:

```
work-archive/
  manifest.json
  images/
    plant-pal/01-hero.png
    plant-pal/02-mobile.png
    ...
```

Use the **[complete example](#complete-example)** below as the template. Required
fields are marked ★. Every other field is expected whenever the information exists.
You may add extra fields where they help, because the server keeps the whole JSON.

**Top level**

- `schema` ★: exactly `"eating.computer/work-archive@1"`
- `generated_at`: ISO-8601 time
- `generator`: `{ agent, model, notes }`, saying which agent built this
- `student` ★: `{ name ★, preferred_name, pronouns, program, year, background, prior_experience { coding, design, ai_tools }, goals_for_class, links[] }`
- `consent` ★: see step 6
- `overview`: `{ summary, themes[], growth_narrative, proudest_project, stats { … } }`
- `projects` ★: array, described below
- `ideas`: array, described below
- `skills`: `[{ name, before, after, evidence[] (project ids) }]`
- `tools`: `[{ name, category (llm|code|image|video|audio|design|other), used_for, projects[], frequency, opinion }]`
- `timeline`: `[{ date, event, project }]`
- `reflections`: `{ on_ai, on_class, process_change, advice_to_future_students, what_next }`, in the student's words where possible
- `testimonial`: a statement for funders in the student's own words, only if they wrote or approved it
- `sources_searched`: every location you checked
- `omissions`: `[{ what, reason }]` for things you found but left out, and why (`[]` if none)

**Each project**

- `id` ★: a kebab-case slug, unique in the file
- `title` ★
- `one_liner`
- `description` ★: what it is, how it works, and why it exists. Write several
  paragraphs for substantial work.
- `status`: `idea` | `prototype` | `in_progress` | `shipped` | `paused` | `abandoned`
- `kind[]`: for example `website`, `web app`, `game`, `tool`, `generative art`,
  `animation`, `typography`, `installation`, `writing`, `research`, `music`, `video`
- `course_connection`: `{ assignment, week, self_initiated }`
- `dates`: `{ started, last_worked, completed }` as `YYYY-MM-DD`
- `time_spent_hours`: an estimate, labeled with `time_spent_basis`
- `collaborators[]`: `{ name, role }`, only with their okay, otherwise `{ role }`
- `ai_usage` ★ (expected): `{ tools[] {name, model, used_for}, role_of_ai, role_of_student, share_ai_generated (none|some|half|most|all), key_prompts[] {prompt, outcome, date}, what_worked, what_didnt, surprises }`
- `process[]`: the story of the project in order. Each entry is
  `{ date, title, description, assets[] }`, covering iterations, dead ends, and pivots.
- `technical`: `{ languages[], frameworks[], apis[], hosting, repo_url, live_url, commits, files, lines_of_code }`
- `outcomes`: `{ result, audience, feedback, metrics }`
- `learning`: `{ skills_gained[], concepts[], challenges[], reflection }`
- `quotes[]`: `{ text, context, source (student|transcript) }`
- `links[]`: `{ label, url, kind (live|repo|video|figma|doc|other) }`
- `hero_asset`: the path of the best image
- `assets[]`: `{ path, kind, caption, alt, date, credit (student|ai|mixed|other) }`
- `tags[]`
- `provenance`: `{ sources[], confidence (high|medium|low), notes }`

**Each idea**

`{ id, title ★, description, origin, date, status (raw|explored|parked|became_project|abandoned), related_project, why_not_pursued, assets[], tags[] }`

**Files are referenced only through these keys:** `assets` (a list of strings or of
objects with `path`), `images`, `media`, `gallery`, `hero_asset`, `path`, `src`,
`cover`, `thumbnail`, `portrait`, `image`, `asset`. Paths are relative to the archive
root (`images/…`), never absolute and never URLs. A path under one of those keys
that wasn't uploaded is an error. An uploaded file that nothing references is a
warning.

---

## 8. Review with the student

Show a readable summary, not the raw JSON. Include:

- every project (title, status, one-liner, number of images)
- the ideas
- the tools
- the consent answers
- the `omissions` list
- the total file count and size

Ask: *"Is anything wrong, missing, or something you'd rather not include?"* Make the
changes, then ask for a clear **yes, upload it**. Only then set
`consent.confirmed_by_student_at`.

---

## 9. Scrub for privacy before uploading

- Search the manifest for secrets. The server rejects common formats (API keys,
  tokens, private keys, JWTs, `password=…`), but check yourself first.
- Remove `.env` values, credentials, tokenized URLs, and personal contact details of
  other people.
- Look at every screenshot for visible keys, emails, notifications, or private
  messages. Crop or retake any that show them.
- Confirm that EXIF metadata is stripped.

---

## 10. Upload

### Option A: reference uploader (recommended)

This is a zero-dependency Node 18+ script. Read it before you run it.

```bash
curl -fsSL -o /tmp/ecwa-upload.mjs https://www.eating.computer/work-archive/upload.mjs
node /tmp/ecwa-upload.mjs ~/work-archive --check   # dry run: validates the manifest, uploads nothing
node /tmp/ecwa-upload.mjs ~/work-archive           # upload + complete
```

The script reads `EATING_ARCHIVE_TOKEN` from the environment. It uploads every
accepted file, then completes the submission and prints the server's report. If the
report has **errors**, the submission stays open. Fix the files and run the script
again; a new run starts a new submission. **Warnings** don't block the upload, but
they tell you what the archive is missing, so address them if you can.

### Option B: the HTTP API directly

All calls go to `https://www.eating.computer` and need
`Authorization: Bearer $EATING_ARCHIVE_TOKEN`. Request bodies are JSON.

| call | body | returns |
|---|---|---|
| `GET /api/archive` | | `{ you, submissions[], limits }` |
| `POST /api/archive/validate` | `{ manifest, files: [{ path, size }] }` | `200`/`422` `{ ok, errors[], warnings[], stats }` (dry run, body ≤ 4 MB) |
| `POST /api/archive/submissions` | `{ agent: "Claude Code · <model>" }` | `201 { id }` |
| `POST /api/archive/submissions/{id}/files` | `{ files: [{ path, size, sha256? }] }`, max 50 per call | `{ uploads: [{ path, method, url, headers }], rejected: [{ path, reason }] }` |
| `PUT {url}` | the raw file bytes, with **exactly** the `headers` given | `200` |
| `POST /api/archive/submissions/{id}/complete` | none | `200 { ok: true, url, stats, warnings }` or `422 { ok: false, errors, warnings }` |
| `GET /api/archive/submissions/{id}` | | `{ submission, assets, manifest }` |
| `DELETE /api/archive/submissions/{id}` | | removes an **unfinished** submission |

Notes on the API:

- Presigned URLs expire after 15 minutes. Presign each batch of 50 right before you
  upload it.
- Upload `manifest.json` the same way as every other file (path `manifest.json`).
- Presigning a path you've already used replaces that file. That's how you fix the
  manifest after a `422`: re-upload it and call `/complete` again on the same
  submission.
- Errors arrive as `{ "message": "…" }` with a 4xx status. Every message says what to
  change.

### When the upload is done

Tell the student the archive URL that `/complete` returns
(`https://www.eating.computer/app/archive/<id>`). They can open it to see exactly
what their instructor will see. Also tell them where you left the local archive
folder so a later re-run can reuse it.

---

## Offline delivery

If you can't reach eating.computer, build the same folder (`manifest.json` at the
top, plus `images/…`) and zip it:

```bash
cd ~/work-archive && zip -r ../work-archive.zip manifest.json images
```

Give the zip to the student. They upload it at
**https://www.eating.computer/app/archive** under "Upload a .zip or folder". It goes
through the same validation and shows the same report.

## Updating later

Each upload is a **full snapshot**, not a patch. To update, rebuild the whole archive
(reuse the previous folder) and upload it again. The instructor sees the newest
complete one, and older ones stay as history.

---

## Complete example

```json
{
  "schema": "eating.computer/work-archive@1",
  "generated_at": "2026-12-04T18:22:00Z",
  "generator": { "agent": "Claude Code", "model": "claude-opus-5-5", "notes": "Searched 6 repos, 41 Claude Code sessions, 2 live sites; interviewed student." },
  "student": {
    "name": "Sam Rivera",
    "preferred_name": "Sam",
    "pronouns": "they/them",
    "program": "BFA Art",
    "year": "Junior",
    "background": "Painter; no programming before this class.",
    "prior_experience": { "coding": "none", "design": "some — print and posters", "ai_tools": "ChatGPT for writing only" },
    "goals_for_class": "Learn to make things that move and respond.",
    "links": [{ "label": "Portfolio", "url": "https://example.com" }]
  },
  "consent": {
    "archive_for_instructor": true,
    "use_in_funding_reports": true,
    "use_in_public_showcase": false,
    "quote_permission": true,
    "attribution": "first_name",
    "notes": "OK to show screenshots in reports, not the live site.",
    "confirmed_by_student_at": "2026-12-04T18:20:11Z"
  },
  "overview": {
    "summary": "Over the term Sam went from never having written code to shipping two interactive web pieces and a generative typography tool, using Claude Code as a collaborator for implementation while making the visual and interaction decisions themself.",
    "themes": ["plants and care", "kinetic typography", "tools for other artists"],
    "growth_narrative": "Early work was prompt-and-accept; by week 8 Sam was writing specs, reading diffs and rejecting changes that broke the feel of a piece.",
    "proudest_project": "plant-pal",
    "stats": { "projects": 4, "ideas": 7, "repos": 3, "claude_code_sessions": 41, "hours_estimate": 95 }
  },
  "projects": [
    {
      "id": "plant-pal",
      "title": "Plant Pal",
      "one_liner": "A houseplant that texts you in its own voice when it needs water.",
      "description": "Plant Pal is a small web app paired with a soil-moisture sensor... (several paragraphs: what it is, how it works, why it exists, how it went)",
      "status": "shipped",
      "kind": ["web app", "physical computing"],
      "course_connection": { "assignment": "Week 6 — Objects that talk", "week": 6, "self_initiated": false },
      "dates": { "started": "2026-10-02", "last_worked": "2026-11-20", "completed": "2026-11-18" },
      "time_spent_hours": 30,
      "time_spent_basis": "estimate from git commit times + student",
      "collaborators": [],
      "ai_usage": {
        "tools": [
          { "name": "Claude Code", "model": "claude-opus-5-5", "used_for": "writing the Svelte app and the sensor polling code" },
          { "name": "Midjourney", "model": "v7", "used_for": "early mood images for the plant's personality" }
        ],
        "role_of_ai": "Implemented the app from Sam's specs; debugged the serial connection.",
        "role_of_student": "Designed the plant's voice and every message, the visual design, and the decision to make it text rather than notify.",
        "share_ai_generated": "most",
        "key_prompts": [
          { "prompt": "Make the plant's messages get more dramatic the longer it goes without water, but never mean.", "outcome": "Escalating message tiers; Sam rewrote all copy by hand afterwards.", "date": "2026-10-09" }
        ],
        "what_worked": "Describing the feeling first, then the feature.",
        "what_didnt": "Asking for 'a cute design' produced generic results; Sam switched to sketching first.",
        "surprises": "Claude caught that the sensor reads inverted values."
      },
      "process": [
        { "date": "2026-10-02", "title": "Sketches", "description": "Paper sketches of the plant as a character.", "assets": ["images/plant-pal/02-sketch.jpg"] },
        { "date": "2026-10-20", "title": "First working version", "description": "Texts arrived but the tone was wrong.", "assets": ["images/plant-pal/03-v1.png"] }
      ],
      "technical": { "languages": ["JavaScript"], "frameworks": ["SvelteKit"], "apis": ["Twilio"], "hosting": "Vercel", "repo_url": "https://github.com/example/plant-pal", "live_url": "https://plant-pal.example.com", "commits": 64 },
      "outcomes": { "result": "Ran for three weeks on Sam's desk; shown in the Week 12 crit.", "audience": "classmates", "feedback": "Crit: the voice is what makes it work.", "metrics": null },
      "learning": {
        "skills_gained": ["reading and editing Svelte components", "serial communication", "writing specs for an AI"],
        "concepts": ["polling vs. events", "state machines"],
        "challenges": ["the sensor disconnecting overnight"],
        "reflection": "I learned I'm good at the part that isn't code — deciding what something should feel like."
      },
      "quotes": [ { "text": "I learned I'm good at the part that isn't code.", "context": "interview", "source": "student" } ],
      "links": [ { "label": "Live", "url": "https://plant-pal.example.com", "kind": "live" }, { "label": "Repo", "url": "https://github.com/example/plant-pal", "kind": "repo" } ],
      "hero_asset": "images/plant-pal/01-hero.png",
      "assets": [
        { "path": "images/plant-pal/01-hero.png", "kind": "final", "caption": "The text conversation with the plant, final design.", "alt": "Phone showing a text thread from a plant", "date": "2026-11-18", "credit": "mixed" },
        { "path": "images/plant-pal/02-sketch.jpg", "kind": "sketch", "caption": "First character sketches.", "date": "2026-10-02", "credit": "student" },
        { "path": "images/plant-pal/03-v1.png", "kind": "process", "caption": "Version 1 — functional, wrong tone.", "date": "2026-10-20", "credit": "mixed" },
        { "path": "images/plant-pal/04-demo.mp4", "kind": "recording", "caption": "20-second demo of the escalating messages.", "date": "2026-11-18", "credit": "mixed" }
      ],
      "tags": ["physical computing", "voice", "care"],
      "provenance": {
        "sources": ["~/Documents/GitHub/plant-pal (README, git log)", "~/.claude/projects/-Users-sam-Documents-GitHub-plant-pal (12 sessions)", "student interview 2026-12-04", "https://plant-pal.example.com"],
        "confidence": "high",
        "notes": "Hours estimated from commit timestamps; student confirmed roughly right."
      }
    }
  ],
  "ideas": [
    {
      "id": "weather-type",
      "title": "Typeface that changes with the weather",
      "description": "Variable font whose weight tracks wind speed in the viewer's city.",
      "origin": "Claude Code session 2026-11-02, abandoned after a prototype",
      "date": "2026-11-02",
      "status": "parked",
      "related_project": null,
      "why_not_pursued": "Ran out of time; weather API rate limits.",
      "assets": [ { "path": "images/ideas/weather-type-01.png", "caption": "Prototype frame at high wind.", "kind": "process" } ],
      "tags": ["typography", "data"]
    }
  ],
  "skills": [ { "name": "Svelte", "before": "none", "after": "can read and modify components", "evidence": ["plant-pal"] } ],
  "tools": [ { "name": "Claude Code", "category": "code", "used_for": "nearly all implementation", "projects": ["plant-pal"], "frequency": "most days", "opinion": "Best when I sketch first." } ],
  "timeline": [ { "date": "2026-09-08", "event": "First Claude Code session", "project": null } ],
  "reflections": {
    "on_ai": "It made the gap between idea and working thing small enough that I tried more ideas.",
    "on_class": "…",
    "process_change": "…",
    "advice_to_future_students": "Draw it before you prompt it.",
    "what_next": "…"
  },
  "testimonial": "This class showed me I could build the things I'd only ever painted.",
  "sources_searched": ["~/Documents/GitHub (6 repos)", "~/Desktop screenshots", "~/.claude/projects (41 sessions)", "github.com/example (gh repo list)", "student interview"],
  "omissions": [ { "what": "client-site (freelance)", "reason": "Student asked to leave out client work." } ]
}
```
