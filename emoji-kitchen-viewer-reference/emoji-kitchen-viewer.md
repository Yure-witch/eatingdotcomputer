# Emoji Kitchen Viewer (Svelte) – Implementation Guide

This doc describes how to build a **Svelte Emoji Kitchen viewer component** with three modes:

- **1+1 mode**: pick two emojis and show the resulting mix(es).
- **All mixes mode**: pick one emoji, show all valid mixes for that emoji.
- **Search mode**: search by plain‑text and see matching emoji and mixes.

It uses data and patterns already present in this repo, while letting you design a different UI.

---

## Data Sources You Already Have

You can base your viewer on one or both of these sources:

1. **Scraped URLs**  
   `fetchemoji.json` contains direct gstatic URLs for valid combos.  
   Example URLs from this repo:
   - `https://www.gstatic.com/android/keyboard/emojikitchen/20250728/u1f42d/u1f42d_u1f369.png` (🐭 + 🍩)
   - `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u1f987/u1f987_u1f383.png` (🦇 + 🎃)
   - `https://www.gstatic.com/android/keyboard/emojikitchen/20260202/u1f47b/u1f47b_u1fa77.png` (👻 + 🩷)

2. **Repo’s encoded emoji metadata**  
   `docs/kitchen/emojidata.js`  
   This defines `window.points`, `window.pairs`, `window.revisions`, `window.point_names`.  
   `docs/kitchen/script.js` shows how to build mix URLs from these.

Use **(1)** if you want to show only real, verified assets.  
Use **(2)** if you want a smaller dataset and “expected” availability (but still need to resolve to URLs).

---

## URL Pattern (from this repo)

From `docs/kitchen/script.js`:

```
https://www.gstatic.com/android/keyboard/emojikitchen/{date}/u{cp1}/u{cp1}_u{cp2}.png
```

Notes:
- `cp1` is the **parent folder**, and that’s what counts as the “owner” of the asset in your counts.
- For dates before `20220500`, codepoints are zero‑padded (e.g. `00a9`).
- Codepoints are joined with `-u` when they’re multi‑part.

---

## Suggested Svelte Component Structure

- `EmojiKitchenViewer.svelte` (parent container, tab UI)
- `EmojiPicker.svelte` (keyboard grid / search input)
- `MixGrid.svelte` (grid of mix thumbnails)
- `MixPreview.svelte` (large preview for 1+1 mode)
- `tabs.ts` (keyboard navigation helpers)
- `emojiData.ts` (parsing and normalization)

---

## Step 1: Parse `fetchemoji.json` into Maps

This gives you “which emoji + which emoji is valid” using actual assets.

```js
// src/lib/emojiData.ts
import urls from '../../fetchemoji.json';

export function parseUrl(url) {
  const parts = url.split('/');
  const idx = parts.indexOf('emojikitchen');
  const date = parts[idx + 1];
  const parent = parts[idx + 2].replace(/^u/, '').replace(/-u/g, '-');
  const filename = parts[idx + 3];
  const child = filename.split('_u')[1].split('.png')[0].replace(/-u/g, '-');
  return { date, parent, child, url };
}

export function buildMaps() {
  const byParent = new Map();       // parent -> [{child, url}]
  const pairToUrl = new Map();      // "parent|child" -> url

  for (const url of urls) {
    const { parent, child } = parseUrl(url);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push({ child, url });
    pairToUrl.set(`${parent}|${child}`, url);
  }

  return { byParent, pairToUrl };
}
```

This is the simplest way to power:
- **All mixes mode** → `byParent.get(parentCp)`
- **1+1 mode** → look up `pairToUrl.get(a|b)` and `pairToUrl.get(b|a)`

---

## Step 2: Convert Codepoints to Emoji

You’ll need a helper to show emoji glyphs from codepoints like `1f42d` or `1f3f5-fe0f`.

```js
export function cpToEmoji(cp) {
  const parts = cp.split('-').map(p => parseInt(p, 16));
  return String.fromCodePoint(...parts);
}
```

If your picker is based on `emojis.csv`, parse the `Codepoint` column:

```js
// "u1f42d" or "u1f3f5-ufe0f"
export function csvCpToEmoji(cp) {
  const parts = cp.toLowerCase().split('-').map(p => p.startsWith('u') ? p.slice(1) : p);
  return cpToEmoji(parts.join('-'));
}
```

---

## Step 3: Accessible Tabs (Keyboard Navigation)

Use WAI‑ARIA tabs:

- `role="tablist"`
- `role="tab"` for each tab
- `role="tabpanel"` for each content panel
- **Roving tabindex** + arrow key navigation

Example Svelte pattern:

```svelte
<div role="tablist" aria-label="Emoji Kitchen modes">
  {#each tabs as tab, i}
    <button
      role="tab"
      aria-selected={active === i}
      aria-controls={`panel-${i}`}
      id={`tab-${i}`}
      tabindex={active === i ? 0 : -1}
      on:click={() => active = i}
      on:keydown={(e) => handleTabKey(e, i)}
    >
      {tab.label}
    </button>
  {/each}
</div>

<section role="tabpanel" id="panel-0" aria-labelledby="tab-0" hidden={active !== 0}>
  <!-- 1+1 Mode -->
</section>
```

`handleTabKey` should support:
- `ArrowLeft`, `ArrowRight` to move tabs
- `Home`, `End` to jump
- `Enter` / `Space` to activate

---

## Mode A: 1+1 (Two Emoji)

UI behavior:
- Two large emoji selectors at the top
- Selected pair previews below
- If both orders exist, show both

Logic:

```js
const url1 = pairToUrl.get(`${a}|${b}`);
const url2 = pairToUrl.get(`${b}|${a}`);
const urls = [url1, url2].filter(Boolean);
```

Render `urls` in a large preview grid.

---

## Mode B: “All mixes” (One Emoji)

UI behavior:
- Big emoji header at top
- All valid mixes displayed in grid
- Emoji keyboard docked at bottom

Logic:

```js
const mixes = byParent.get(selectedCp) ?? [];
```

Render each mix with:
- child emoji glyph
- image (the mix URL)

Use lazy loading:
```html
<img loading="lazy" src={mix.url} alt={`${cpToEmoji(selected)} + ${cpToEmoji(mix.child)}`} />
```

---

## Mode C: Plain‑Text Search

Use `docs/kitchen/emojidata.js` for keyword data:

- `window.point_names` contains comma‑separated keywords for each emoji
- `window.points` is the matching codepoint list

Approach:
- Build a search index from `point_names`
- On query, filter matching codepoints
- Use `byParent` to show valid mixes for selected or matched emoji

Example parsing:

```js
// Use data from docs/kitchen/emojidata.js
const keywords = point_names.map((s, i) => ({
  cp: points[i],
  text: s.toLowerCase()
}));

function search(query) {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];
  return keywords.filter(k => k.text.includes(q)).map(k => k.cp);
}
```

---

## Example UI Layout (Different from repo viewer)

You can keep behavior while styling differently:

- **Top bar** with large emoji(s) and mode switcher
- **Sticky bottom keyboard** with a scrollable emoji grid
- **Main area** with cards showing:
  - mixed image
  - both emoji glyphs
  - copy/download actions

---

## Accessibility Notes

- Every mode should be reachable with `Tab`.
- Emoji buttons should have `aria-label` like `aria-label="Select 🍉"`.
- The grid should be navigable:
  - Use `tabindex="0"` on emoji buttons.
  - Use `aria-live="polite"` for mode changes or search results.

---

## Integration Points from This Repo

These files are helpful references:

- `docs/kitchen/script.js`  
  URL format, emoji selection logic, and combo rendering.
- `docs/kitchen/emojidata.js`  
  `points`, `pairs`, `revisions`, `point_names`.
- `netlify/edge-functions/metadata.js`  
  URL construction and date handling.
- `netlify.toml`  
  Proxy config if you want a local `/emojikitchen/` rewrite.

---

## Optional: Precompute a Minimal JSON

For performance, precompute these once at build time:

- `byParent` map
- `pairToUrl` map
- `emojiList` from `emojis.csv`
- `keywords` index from `point_names`

Then import them in Svelte as static JSON.

---

## Suggested Next Steps

1. Build `emojiData.ts` to parse `fetchemoji.json` into maps.
2. Implement `EmojiPicker` and `MixGrid`.
3. Wire up the 3 modes with the tablist pattern.
4. Add search with `point_names`.
5. Style it to match your product design.

If you want, I can scaffold the Svelte components and data parsing files directly.  
Tell me whether you want it as SvelteKit or plain Svelte. 
