#!/usr/bin/env python3
"""
Pull Telegram's official animated emoji as RAW .tgs (gzipped Lottie) — the
vector source, not the rasterized .webp you find in third-party repos.

Key idea: you do NOT enumerate emoji and probe them one-by-one. Each official
set returns its ENTIRE emoji->document mapping in a single getStickerSet call
via the `packs` field. That response is ground truth for "what Telegram
animates in the backend." We diff it against any third-party library yourself.

Sets pulled (all official, all in the current MTProto schema):
  - InputStickerSetAnimatedEmoji            -> animated standard emoji  <- the main one
  - InputStickerSetAnimatedEmojiAnimations  -> interactive tap animations
  - InputStickerSetEmojiGenericAnimations   -> generic reaction animations
  - InputStickerSetDice("🎲"/"🎯"/...)      -> dice/dart/ball/etc. (one call each)

Install:
    pip install telethon

Credentials (https://my.telegram.org/apps -- app name is irrelevant, never shown):
    export TG_API_ID=123456
    export TG_API_HASH="your_api_hash"

Run:
    python telegram_animated_emoji.py --out ./telegram_official_emoji --unpack-tgs

Output per set:
    <set>/<emoji>_<docid>.tgs     raw Lottie (render at any fps/resolution)
    <set>/<emoji>_<docid>.json    unpacked Lottie (with --unpack-tgs)
    <set>/manifest.json           [{emoji, codepoints, doc_id, filename, mime, size}]
"""

import argparse
import asyncio
import gzip
import json
import os
import time
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import (
    FloodWaitError,
    RpcCallFailError,
    RPCError,
    ServerError,
    TimedOutError,
)
from telethon.tl.functions.messages import GetStickerSetRequest
from telethon.tl.types import (
    InputStickerSetAnimatedEmoji,
    InputStickerSetAnimatedEmojiAnimations,
    InputStickerSetDice,
    InputStickerSetEmojiGenericAnimations,
)

# Telegram's interactive dice-style emoji (each is its own tiny set).
DICE_EMOTICONS = ["🎲", "🎯", "🏀", "⚽", "🎰", "🎳"]


def official_sets():
    sets = [
        ("animated_emoji", InputStickerSetAnimatedEmoji()),
        ("animated_emoji_animations", InputStickerSetAnimatedEmojiAnimations()),
        ("emoji_generic_animations", InputStickerSetEmojiGenericAnimations()),
    ]
    for e in DICE_EMOTICONS:
        sets.append((f"dice_{'_'.join(f'{ord(c):x}' for c in e)}", InputStickerSetDice(emoticon=e)))
    return sets


async def with_backoff(coro_factory, *, what, max_tries=6):
    """FloodWait: honor Telegram's exact wait. Transient RPC/conn errors:
    exponential backoff 1,2,4,8,16s. Anything else: raise."""
    delay = 1.0
    for attempt in range(1, max_tries + 1):
        try:
            return await coro_factory()
        except FloodWaitError as e:
            print(f"  flood wait on {what}: sleeping {e.seconds}s (Telegram-mandated)")
            await asyncio.sleep(e.seconds + 1)
        except (RpcCallFailError, ServerError, TimedOutError, ConnectionError, asyncio.TimeoutError) as e:
            if attempt == max_tries:
                raise
            print(f"  transient error on {what} ({e!r}); backoff {delay:.0f}s [try {attempt}/{max_tries}]")
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)
        except RPCError:
            raise


def emoji_codepoints(s: str) -> str:
    return " ".join(f"U+{ord(c):04X}" for c in s)


def safe(s: str) -> str:
    return "".join(c if c.isalnum() or c in "._-" else f"u{ord(c):x}" for c in (s or "x"))[:60] or "x"


async def pull_set(client, out_root: Path, source_name: str, set_input, delay: float):
    result = await with_backoff(
        lambda: client(GetStickerSetRequest(stickerset=set_input, hash=0)),
        what=f"getStickerSet({source_name})",
    )
    docs = {d.id: d for d in (getattr(result, "documents", []) or [])}
    packs = getattr(result, "packs", []) or []
    set_obj = getattr(result, "set", None)

    # Build emoji -> document mapping straight from `packs` (this is ground truth).
    doc_to_emoji = {}
    for pack in packs:
        for doc_id in (pack.documents or []):
            doc_to_emoji.setdefault(doc_id, pack.emoticon)

    out_dir = out_root / source_name
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{source_name}: title={getattr(set_obj,'title','')!r} "
          f"docs={len(docs)} emoji={len(packs)}")

    manifest = []
    for i, (doc_id, doc) in enumerate(docs.items(), 1):
        emoji = doc_to_emoji.get(doc_id, "")
        mime = getattr(doc, "mime_type", "") or ""
        ext = ".tgs" if mime == "application/x-tgsticker" else (
            ".webm" if mime == "video/webm" else ".webp" if mime == "image/webp" else ".bin")
        filename = f"{safe(emoji)}_{doc_id}{ext}"
        path = out_dir / filename
        if not path.exists():
            await with_backoff(
                lambda d=doc, p=path: client.download_media(d, file=str(p)),
                what=f"download {doc_id}",
            )
            await asyncio.sleep(delay)
        manifest.append({
            "emoji": emoji,
            "codepoints": emoji_codepoints(emoji),
            "doc_id": str(doc_id),
            "filename": filename,
            "mime": mime,
            "size": getattr(doc, "size", None),
        })
        if i % 50 == 0:
            print(f"  {i}/{len(docs)}")

    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  done: {len(manifest)} files -> {out_dir}")
    return manifest


def unpack_tgs(root: Path):
    files = list(root.rglob("*.tgs"))
    print(f"\nunpacking {len(files)} .tgs -> .json (gunzip)")
    for tgs in files:
        out = tgs.with_suffix(".json")
        if out.exists():
            continue
        try:
            raw = gzip.open(tgs, "rb").read()
            json.loads(raw)  # validate
            out.write_bytes(raw)
        except Exception as e:
            print(f"  skip {tgs.name}: {e}")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="./telegram_official_emoji")
    ap.add_argument("--session", default="tg_emoji")
    # NOTE: int() the env var here -- argparse type= does NOT apply to default=.
    ap.add_argument("--api-id", type=int,
                    default=int(os.environ["TG_API_ID"]) if os.getenv("TG_API_ID") else None)
    ap.add_argument("--api-hash", default=os.getenv("TG_API_HASH"))
    ap.add_argument("--delay", type=float, default=0.1)
    ap.add_argument("--unpack-tgs", action="store_true")
    args = ap.parse_args()

    if not args.api_id or not args.api_hash:
        raise SystemExit("Set TG_API_ID and TG_API_HASH (https://my.telegram.org/apps).")

    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)

    grand = {}
    async with TelegramClient(args.session, args.api_id, args.api_hash) as client:
        for source_name, set_input in official_sets():
            try:
                grand[source_name] = await pull_set(client, out_root, source_name, set_input, args.delay)
            except RPCError as e:
                print(f"  set {source_name} failed: {e}")

    # Master catalog: every emoji Telegram animates, across sets. Diff THIS
    # against any third-party library to find what they're missing.
    all_emoji = sorted({m["emoji"] for ms in grand.values() for m in ms if m["emoji"]})
    (out_root / "catalog.json").write_text(
        json.dumps({"sets": {k: len(v) for k, v in grand.items()},
                    "distinct_emoji": all_emoji,
                    "distinct_emoji_count": len(all_emoji)},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nCATALOG: {len(all_emoji)} distinct emoji across {len(grand)} sets "
          f"-> {out_root/'catalog.json'}")

    if args.unpack_tgs:
        unpack_tgs(out_root)
    print(f"\nDone: {out_root.resolve()}")


if __name__ == "__main__":
    asyncio.run(main())
