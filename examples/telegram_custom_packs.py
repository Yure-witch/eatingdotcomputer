#!/usr/bin/env python3
"""
Discover + download Telegram custom emoji packs (or regular sticker packs)
already installed on your account, matched by their DISPLAY TITLE.

  TG_API_ID=… TG_API_HASH=… python3 examples/telegram_custom_packs.py \
      "Cursed Emoji" "Kawaii Emoji" "Doge Emoji" …
  # add --list to just see every installed pack's title + short_name + count
  # add --all to grab every installed emoji+sticker pack

Per-pack output: telegram_custom_packs/<short_name>/
  <doc_id>.tgs / .webm / .webp        raw asset
  <doc_id>.json                       unpacked Lottie (for .tgs, with --unpack-tgs)
  manifest.json                       [{doc_id, alt, mime, size, filename}]
"""
import argparse, asyncio, gzip, json, os, sys
from pathlib import Path
from telethon import TelegramClient
from telethon.errors import FloodWaitError, RPCError
from telethon.tl.functions.messages import (
    GetAllStickersRequest, GetEmojiStickersRequest, GetStickerSetRequest,
    SearchEmojiStickerSetsRequest, SearchStickerSetsRequest,
)
from telethon.tl.types import (
    InputStickerSetID,
    DocumentAttributeSticker, DocumentAttributeCustomEmoji,
)

ROOT = Path("telegram_custom_packs")


def norm(s): return "".join(c for c in (s or "").lower() if c.isalnum())


def ext_for(mime: str) -> str:
    return {
        "application/x-tgsticker": ".tgs",
        "video/webm": ".webm",
        "image/webp": ".webp",
        "image/png": ".png",
    }.get(mime or "", ".bin")


def alt_of(doc) -> str:
    for a in (doc.attributes or []):
        if isinstance(a, DocumentAttributeCustomEmoji) and a.alt: return a.alt
        if isinstance(a, DocumentAttributeSticker) and a.alt: return a.alt
    return ""


async def with_backoff(coro_factory, what, max_tries=5):
    delay = 1.0
    for attempt in range(1, max_tries + 1):
        try:
            return await coro_factory()
        except FloodWaitError as e:
            print(f"  flood wait on {what}: sleeping {e.seconds}s"); await asyncio.sleep(e.seconds + 1)
        except RPCError:
            raise
        except Exception as e:
            if attempt == max_tries: raise
            print(f"  transient on {what}: {e!r}; backoff {delay:.0f}s"); await asyncio.sleep(delay)
            delay = min(delay * 2, 30)


async def enumerate_sets(client):
    """Return list of (title, short_name, id, access_hash, kind) for every installed set."""
    sets = []
    all_st = await with_backoff(lambda: client(GetAllStickersRequest(hash=0)), "getAllStickers")
    for s in (all_st.sets or []):
        sets.append((s.title, s.short_name, s.id, s.access_hash, "sticker"))
    all_em = await with_backoff(lambda: client(GetEmojiStickersRequest(hash=0)), "getEmojiStickers")
    for s in (all_em.sets or []):
        sets.append((s.title, s.short_name, s.id, s.access_hash, "emoji"))
    # dedupe by id (in case the same set is reported by both endpoints)
    seen = set(); uniq = []
    for s in sets:
        if s[2] in seen: continue
        seen.add(s[2]); uniq.append(s)
    return uniq


async def find_by_title(client, title):
    """Search Telegram for a pack matching title (works without Premium / install).
       Returns (title, short_name, id, access_hash, kind) or None."""
    nt = norm(title)
    # Try emoji-sticker search first (custom-emoji packs like Cursed/Doge/etc.)
    for kind, fn_cls in (("emoji", SearchEmojiStickerSetsRequest), ("sticker", SearchStickerSetsRequest)):
        try:
            res = await with_backoff(lambda fn=fn_cls: client(fn(q=title, exclude_featured=False, hash=0)),
                                     f"search-{kind}({title})")
        except Exception as e:
            print(f"  search-{kind} error for {title!r}: {e!r}"); continue
        for covered in (getattr(res, "sets", None) or []):
            inner = getattr(covered, "set", covered)
            if norm(inner.title) == nt:
                return (inner.title, inner.short_name, inner.id, inner.access_hash, kind)
    return None


async def download_set(client, title, short_name, set_id, access_hash, kind, unpack=True):
    out = ROOT / short_name; out.mkdir(parents=True, exist_ok=True)
    res = await with_backoff(
        lambda: client(GetStickerSetRequest(stickerset=InputStickerSetID(id=set_id, access_hash=access_hash), hash=0)),
        f"getStickerSet({short_name})",
    )
    docs = list(res.documents or [])
    manifest = []
    for i, d in enumerate(docs, 1):
        ext = ext_for(d.mime_type)
        fn = f"{d.id}{ext}"
        path = out / fn
        if not path.exists():
            await with_backoff(lambda d=d, p=path: client.download_media(d, file=str(p)), f"download {d.id}")
        manifest.append({
            "doc_id": str(d.id), "alt": alt_of(d), "mime": d.mime_type or "",
            "size": d.size or 0, "filename": fn,
        })
        if unpack and ext == ".tgs":
            try:
                raw = gzip.open(path, "rb").read(); json.loads(raw)
                (out / f"{d.id}.json").write_bytes(raw)
            except Exception as e:
                print(f"  ! could not unpack {fn}: {e}")
        if i % 25 == 0: print(f"    {i}/{len(docs)}")
    info = {"title": title, "short_name": short_name, "kind": kind, "count": len(manifest), "emoji": manifest}
    (out / "manifest.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  ✓ {title}  ({short_name})  {kind}  {len(manifest)} items")


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("titles", nargs="*", help="display titles to match (any case, spacing ignored)")
    p.add_argument("--list", action="store_true", help="just print every installed pack, don't download")
    p.add_argument("--all", action="store_true", help="download every installed pack")
    p.add_argument("--no-unpack", action="store_true")
    p.add_argument("--session", default="tg_emoji")
    p.add_argument("--api-id", type=int, default=int(os.environ["TG_API_ID"]) if os.getenv("TG_API_ID") else None)
    p.add_argument("--api-hash", default=os.getenv("TG_API_HASH"))
    a = p.parse_args()

    if not a.api_id or not a.api_hash:
        sys.exit("Set TG_API_ID and TG_API_HASH.")

    client = TelegramClient(a.session, a.api_id, a.api_hash)
    async with client:
        installed = await enumerate_sets(client)
        print(f"\n{len(installed)} packs installed on your account")
        if a.list:
            for t, s, _i, _h, k in sorted(installed, key=lambda x: x[0].lower()):
                print(f"  [{k:7}]  {t!r:40}  short={s}")
            return

        if a.all:
            targets = installed
        else:
            # 1) Try to match against installed (fast path, no extra API calls).
            wanted = {norm(t): t for t in a.titles}
            by_norm = {norm(t): (t, s, i, h, k) for t, s, i, h, k in installed}
            targets, still_missing = [], []
            for k, original in wanted.items():
                if k in by_norm: targets.append(by_norm[k])
                else: still_missing.append(original)
            # 2) For everything not installed, search Telegram by title (works without Premium).
            if still_missing:
                print(f"\nsearching Telegram for {len(still_missing)} non-installed titles...")
                truly_missing = []
                for title in still_missing:
                    hit = await find_by_title(client, title)
                    if hit:
                        print(f"  found  {title!r}  →  short={hit[1]!r}  ({hit[4]})")
                        targets.append(hit)
                    else:
                        truly_missing.append(title)
                if truly_missing:
                    print("UNMATCHED (skipped):", truly_missing)
            print(f"\nwill download {len(targets)} pack(s)")

        ROOT.mkdir(exist_ok=True)
        for t, s, i, h, k in targets:
            print(f"\n▶ {t}  ({s})  {k}")
            try:
                await download_set(client, t, s, i, h, k, unpack=not a.no_unpack)
            except RPCError as e:
                print(f"  ! failed: {e}")
        print(f"\nDone. → {ROOT.resolve()}")


asyncio.run(main())
