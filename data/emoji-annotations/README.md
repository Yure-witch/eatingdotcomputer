# Emoji annotation snapshots

## Files

- `en.xml`: untouched Unicode CLDR English annotation XML, saved from
  https://github.com/unicode-org/cldr/blob/main/common/annotations/en.xml.
  `source.json` records its SHA-256 and source URL. Its original Unicode-3.0
  copyright/license notice is preserved.
- `en.webster.xml`: the same XML with additional Merriam-Webster synonyms
  appended to eligible keyword annotations. Original keywords, names,
  attributes, comments, and ordering are preserved.
- `webster-synonyms.json`: additions by emoji, with the Webster query,
  dictionary entry, part of speech, sense, source URL, and coverage status.
- `reviewed-synonyms.json` and `reviewed-exclusions.json`: explicit review
  decisions. For example, 🤪 receives **silly, wacky, absurd, foolish** from
  Webster's adjective entry for **zany**.

## Current coverage

The one-off run on September 15, 2026 used **3,755 requests**, capped at
**1,000 per supplied Thesaurus key**: 1,000 for each of the first three keys
and 755 for the fourth. The Dictionary keys were not used.

| Coverage in the source XML | Emoji entries |
| --- | ---: |
| Four added synonyms | 580 |
| One to three added synonyms | 303 |
| Unchanged | 723 |
| Total examined | 1,606 |

There are **2,993 additions across 883 entries**. This does **not** complete
four additions for every emoji. All planned lookups for entries with fewer
than four additions are complete; Webster's responses did not yield enough
suitable new words for every entry. Their original annotations remain
intact. The JSON records the gaps, with zero pending entries. More additions
would require different lookup terms or further source review.

Webster's API lists synonyms alphabetically, rather than providing a
popularity ranking. Selection uses the emoji's CLDR name and keywords to
choose the relevant sense. The app's existing MiniLM model ranks the
**sourced candidates locally**; it does not invent synonyms. Manual review
excludes observed wrong senses, such as “crying need,” the verb meaning of
“rocket,” and negation mismatches. Automated relevance ranking remains
imperfect; the source records make every addition auditable.

## Application use

`static/emoji-data.json` contains additions for the **770 matching base emoji**
in the app's catalog. The source XML additionally includes gender variants
and entries outside that catalog. The `sy` field keeps provenance separate
from `kw`, and `st` includes both for picker search. Composer suggestions give
`sy` and `kw` **the same weight**. Full names still retain their existing
priority. There are no runtime Webster requests or new localStorage writes.

## Reproduce or continue deliberately

Responses, request counts, and local embedding vectors are cached in the
ignored `.cache/` directory. No API keys are stored in these output files.
Temporary credential files used for this run were removed.

```sh
# Re-rank cached results locally; no Webster requests.
node scripts/embed-webster-candidates.mjs
node scripts/enrich-emoji-annotations.mjs --semantic
node scripts/apply-webster-emoji-data.mjs

# Validation
node --test scripts/enrich-emoji-annotations.test.mjs
node vendor/emo/tools/check-emotion-suggestions.mjs
```

Fetching is an explicit, optional `--fetch` operation. It requires
`MERRIAM_WEBSTER_THESAURUS_KEY` or a private `--key-file` containing one key per
line. The script counts attempts before sending, enforces 1,000 requests per
key per recorded UTC day, caches successful responses, and stops on server
errors. It never switches keys in response to an API rejection. There is no
scheduled or automatic continuation. API documentation:
https://dictionaryapi.com/products/api-collegiate-thesaurus.

`scripts/build-emoji-data.mjs` also incorporates the saved synonym records
when rebuilding the standard emoji asset.
