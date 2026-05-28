#!/usr/bin/env python3
"""
Build a cp(hyphen-hex) -> category map for the animated emoji, by matching
each live emoji's CLDR slug against the Tarikul-Islam-Anik repo's folder
names (Smileys / People / Animals and Nature / Food and Drink / Activity /
Travel and Places / Objects / Symbols / Flags). Writes /tmp/tg_categories.json
which examples/upload_telegram_emoji.mjs reads.

Run (once /tmp/repo_webp_paths.txt exists — fetched via `gh api`):
    python3 examples/gen_categories.py
"""
import json, emoji

VS16 = "️"

def norm(s):
    return "".join(c for c in s.lower() if c.isalnum())

# repo filename(normalized) -> category, from the gh-fetched paths list
namecat = {}
for line in open("/tmp/repo_webp_paths.txt"):
    cat, _, file = line.strip().partition("/")
    if file:
        namecat[norm(file.replace(".webp", ""))] = cat

def cldr_slug(ch):
    """Try emoji.demojize on the char with/without VS16; return its slug or None."""
    for cand in (ch, ch + VS16, ch.replace(VS16, "")):
        s = emoji.demojize(cand)
        if s != cand and s.startswith(":"):
            return norm(s.strip(":"))
    return None

def cpof(ch):  # MUST match Node's Array.from(ch).map(c=>c.codePointAt(0).toString(16)).join('-')
    return "-".join(f"{ord(c):x}" for c in ch)

live = json.load(open("telegram_official_emoji/animated_emoji/manifest.json"))
out = {}
miss = 0
seen = set()
for m in live:
    e = m["emoji"]
    if e in seen:
        continue
    seen.add(e)
    slug = cldr_slug(e)
    cat = namecat.get(slug) if slug else None
    if not cat:
        cat = "Other"
        miss += 1
    out[cpof(e)] = cat

json.dump(out, open("/tmp/tg_categories.json", "w"))
from collections import Counter
print("categories:", dict(Counter(out.values())))
print(f"uncategorized(Other): {miss} of {len(out)}")
