# Guest decks for the Archive viewer

A guest's Keynote or Google Slides deck becomes a folder the members-only viewer
(`/app/years/decks/<slug>`, `src/lib/components/DeckViewer.svelte`) plays: each
slide as an image, with its videos, GIFs and sounds laid over the frames they had
in the deck. A PDF export loses all of that. Everything here runs on a Mac with
Keynote, ffmpeg, cwebp, and Python with Pillow and NumPy.

Work in a scratch folder per deck (`<deckdir>`). Run the Python scripts with
`python3 -I` and keep downloaded decks out of the folder the scripts live in.

## Keynote (.key)

1. Copy the deck to `<deckdir>/src.key`.
2. `scripts/decks/deck.sh <deckdir>/src.key <deckdir>`: slide PNGs in `png/`
   and `layout.tsv` (every movie, GIF and sound with its frame).
3. `python3 -I scripts/decks/build-deck.py <deckdir> "<title>"`: writes
   `<deckdir>/out/` (deck.json, `s/` slides, `t/` thumbnails, `m/` media).
   Videos become H.264 MP4 capped at 1080p and 8 Mbps; GIFs silent looping MP4s.
4. Things drawn above a video (a label over a screen recording) would end up
   under it. Find them:
   `osascript scripts/decks/zorder.applescript <deckdir>/src.key > <deckdir>/zorder.tsv`
   then `python3 -I scripts/decks/covered.py <deckdir>/zorder.tsv` (slide, item).
   If it lists any, export those slides without the top items and cut the layer:
   `osascript scripts/decks/fg.applescript <deckdir>/src.key <deckdir>/png-under "44:5;45:4"`
   `python3 -I scripts/decks/top-layer.py <deckdir> 44,45`
   (fg.applescript edits the open deck in memory and closes without saving,
   so run it on a scratch copy.)

## Google Slides

1. Download the deck as PDF and PPTX (`/export/pdf`, `/export/pptx`).
2. `python3 -I scripts/decks/pptx-layout.py deck.pptx <deckdir>`: `layout.tsv`
   and the animated GIFs in `media/`, crops included. Slides videos aren't in
   the PPTX: download them from Drive into `media/` and add a `MOVIE` line
   with the frame from the Slides API (EMU, same units as the PPTX).
3. `swift scripts/decks/render.swift deck.pdf <deckdir>/png 1920`
4. `build-deck.py` as above.

A PDF-only deck: render it, then write a `layout.tsv` of `DOC 1920 1080` and
one `SLIDE n n` line per page.

## Publish

1. Check every slide for IDs, addresses, phone numbers and anything private
   before it goes up, even members-only.
2. `node scripts/decks/upload-deck.mjs <deckdir>/out <slug>` and the PDF with
   `node scripts/decks/upload-deck.mjs <file.pdf> <slug>.pdf`. Each goes in a
   new random folder that is never printed or written down.
3. Add `{ label: 'Slides', deck: '<slug>', pdf: '<slug>.pdf', title }` to
   `MEMBER_WORK` in `src/lib/server/archive-members.js`. The talk title shown
   in the viewer comes from the guest's note in `src/lib/archive.js`.
