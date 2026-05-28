#!/usr/bin/env python3
"""
Probe Telegram's InputStickerSetAnimatedEmojiAnimations set and dump the TRUE
per-doc emoji mapping (from each Document's Sticker.alt — NOT the buggy packs
grouping, where most docs land under a "1⃣" mega-pool).

Writes /tmp/anim_mapping.json: { "<doc_id>": "<emoji>" }
which examples/rekey_animations.mjs then reads to re-key R2 correctly.

Run:
    TG_API_ID=… TG_API_HASH=… python3 examples/probe_animations.py
"""
import os, json, asyncio
from collections import defaultdict
from telethon import TelegramClient
from telethon.tl.functions.messages import GetStickerSetRequest
from telethon.tl.types import (
    InputStickerSetAnimatedEmojiAnimations,
    DocumentAttributeSticker,
    DocumentAttributeCustomEmoji,
)

OUT = "/tmp/anim_mapping.json"

async def main():
    client = TelegramClient("tg_emoji", int(os.environ["TG_API_ID"]), os.environ["TG_API_HASH"])
    async with client:
        res = await client(GetStickerSetRequest(stickerset=InputStickerSetAnimatedEmojiAnimations(), hash=0))
        mapping = {}
        by_emoji = defaultdict(list)
        for d in res.documents:
            alt = None
            for a in (d.attributes or []):
                if isinstance(a, DocumentAttributeSticker) and a.alt:
                    alt = a.alt; break
                if isinstance(a, DocumentAttributeCustomEmoji) and a.alt:
                    alt = a.alt; break
            if alt:
                mapping[str(d.id)] = alt
                by_emoji[alt].append(str(d.id))
        json.dump(mapping, open(OUT, "w"), ensure_ascii=False)
        print(f"wrote {OUT}  ({len(mapping)} docs across {len(by_emoji)} emoji)")
        print(f"emoji with multiple variants:")
        for e, ids in sorted(by_emoji.items(), key=lambda x: -len(x[1])):
            if len(ids) > 1:
                print(f"  {e}  {len(ids)} variants")

asyncio.run(main())
