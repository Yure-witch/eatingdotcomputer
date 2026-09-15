# Emoji search coverage

## What changed

The picker and chat composer share `src/lib/emoji-search.js` for related
concepts, collection searches, and fuzzy names. The original CLDR and Webster
records remain in `data/emoji-annotations/`.

- Exact names, shortcodes, existing keywords, and Webster synonyms retain
  priority over fuzzy names. Webster and CLDR keywords keep equal weight.
- Fuzzy results are capped at **two**, always at the end, including after
  semantic results. The picker labels them **Similar names**. Chat never
  replaces stronger matches merely to make room for a fuzzy result.
- Name typos support insertion, deletion, substitution, and adjacent letter
  swaps. Words of 4–6 letters allow one edit; longer words allow two. Short
  words do not receive spelling corrections; matches need at least 75%
  similarity. Every word in a multiword
  query must fit the same emoji name.
- `concepts.json` contains **119 reviewed concepts and 578 distinct search
  phrases**. These are associations, not synonyms: murder can suggest a
  knife or blood even though those words do not mean murder. They are kept
  separate from Unicode/Webster provenance.
- `families.json` defines collection searches. **heart**, **hearts**, and
  **the heart** put all **34 heart-related catalog entries** together, with
  colored and expressive hearts first. Chat shows the full collection in
  a horizontally scrollable row. An explicitly supplied API limit is still
  respected. Other chat queries keep the usual eight-result limit.
- The MiniLM matrix was regenerated from current names, keywords, synonyms,
  and concept descriptions. `static/emoji-embedding-meta.json` records its
  input checksum. The picker reruns a pending query when the worker becomes
  ready and ignores results from a previous query.

Examples:

| Search | Included results |
| --- | --- |
| murder | 🔪 🗡️ 🩸 💀 ☠️ ⚰️ ⚔️ 🪦 |
| goth | 🖤 🥀 🦇 🗡️ 🩸 💀 ⚰️ 🕸️ |
| daggr | 🗡️ |
| red haert | ❤️ |
| burnout | 🫠 😵‍💫 😩 🪫 🥱 |
| first aid | 🩹 🩺 🚑 💊 |

No Webster requests, search logging, telemetry, or localStorage writes were
added. Concept lookup and fuzzy matching run synchronously on the device;
the existing semantic worker remains optional. The preserved 500 ms chat
prewarm and usage-free WASM are unchanged.

## Finding the next gaps

`probes.json` contains **144 ordinary search intents** across emotions,
school, work, health, food, relationships, hobbies, travel, and aesthetics.
`scripts/audit-emoji-search.mjs` compares keyword-only coverage with the
expanded search and writes `coverage.json`:

- 125 probes had fewer than three keyword-only results; six remain sparse
  after expansion. Those six deliberately request specific names, such as
  **red heart** and **sewing needle**, where a narrow answer is correct.
- 124 probes gained reliable matches. Fuzzy-only hits do not count as
  reliable coverage for this measurement.
- All 1,711 exact names and 1,525 generated transposition queries find their
  intended emoji within the picker result limit.

This is a bounded regression/discovery corpus, not proof that every possible
query is covered. Add newly reported or suspected gaps to `probes.json`, run
the audit, inspect the returned names, and add appropriate associations to
`concepts.json`. Do not add unrelated emoji solely to satisfy a result count.
Keep `expectedSparse` limited to reviewed, deliberately narrow queries.

Rebuild and check:

```sh
node scripts/apply-webster-emoji-data.mjs
node scripts/generate-emoji-embeddings.mjs
node scripts/audit-emoji-search.mjs
node --test scripts/emoji-search.test.mjs scripts/enrich-emoji-annotations.test.mjs
# With Vite running on localhost:5175:
node scripts/test-emoji-search-browser.mjs
node vendor/emo/tools/check-emotion-suggestions.mjs
node vendor/emo/tools/verify-chat-prewarm.mjs
```

The normal `scripts/build-emoji-data.mjs` also includes the saved concepts
and families. The audit fails for missed exact names, missed generated
typos, or stale semantic embeddings. Sparse intent coverage remains a
human-review list rather than forcing speculative matches.

## Background

[Unicode CLDR](https://cldr.unicode.org/translation/characters/short-names-and-keywords)
provides names and search keywords. Thesaurus synonyms expand similar
meanings; event-to-object associations need a separate relation. The
[WordNet overview](https://wordnet.princeton.edu/front) describes the
distinction between synonym groups and semantic relationships. No WordNet
data was imported for this change; the association file is an explicit,
reviewable editorial layer.
