#!/usr/bin/env python3
"""
Scrape Emoji Kitchen "Top" combinations from https://tikolu.net/emojimix/

Usage (first time):
  python -m pip install playwright
  python -m playwright install chromium

Run:
  python scripts/scrape_emojimix_top.py --limit 1000 --output data/emojimix_top_1000.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright
from pathlib import Path


DEFAULT_URL = "https://tikolu.net/emojimix/"


@dataclass
class Item:
    url: str
    favourite_count_raw: Optional[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape emojimix Top favourites.")
    parser.add_argument("--url", default=DEFAULT_URL, help="Target URL")
    parser.add_argument("--limit", type=int, default=1000, help="How many unique images to collect")
    parser.add_argument("--output", default="data/emojimix_top.jsonl", help="Output JSONL path")
    parser.add_argument("--headless", action="store_true", help="Run browser headless")
    parser.add_argument("--slow-mo", type=int, default=0, help="Slow down Playwright actions (ms)")
    parser.add_argument("--executable-path", default=None, help="Override Chromium executable path")
    parser.add_argument("--scroll-step", type=int, default=1600, help="Scroll step inside #favourites (px). 0 means jump to bottom")
    parser.add_argument("--scroll-pause", type=float, default=0.6, help="Seconds to wait after each scroll")
    parser.add_argument("--max-idle-scrolls", type=int, default=25, help="Stop after this many scrolls without new items")
    parser.add_argument("--max-idle-seconds", type=int, default=0, help="Stop after this many seconds without new items (0 disables)")
    parser.add_argument("--stop-file", default="", help="If this file exists, stop gracefully (empty disables)")
    parser.add_argument("--screenshot-path", default="", help="(Deprecated) Save a screenshot at the start of each idle streak (overwrites)")
    parser.add_argument("--screenshot-start-path", default="", help="Save a screenshot at the start of the idle streak (overwrites)")
    parser.add_argument("--screenshot-end-path", default="", help="Save a screenshot when idle limit is reached (overwrites)")
    parser.add_argument("--timeout", type=int, default=60000, help="Playwright timeout in ms")
    return parser.parse_args()


def ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)


def try_click(page, selectors: Iterable[str], timeout: int = 2000) -> bool:
    for sel in selectors:
        try:
            locator = page.locator(sel)
            if locator.count() == 0:
                continue
            locator.first.click(timeout=timeout)
            return True
        except PlaywrightTimeoutError:
            continue
        except Exception:
            continue
    return False


def dismiss_overlays(page) -> None:
    # Best-effort dismissals; ignore failures.
    try_click(page, [
        "text=/^Skip tutorial$/i",
        "text=/^Close Ad$/i",
        "text=/^Return$/i",
        "text=/^Got it$/i",
        "text=/^OK$/i",
        "text=/^Okay$/i",
        "text=/^I understand$/i",
    ])
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass


def click_top_tab(page) -> None:
    # The UI shows "mix" and "top" tabs. Try a few strategies.
    clicked = try_click(page, [
        "text=/^top$/i",
        "button:has-text('top')",
        "[role='tab']:has-text('top')",
        "[data-tab='top']",
    ])
    if not clicked:
        # Sometimes the tabs are within a container; try a scoped click.
        try_click(page, ["#top", "[id*='top']"])


def click_all_time(page) -> None:
    # Top tab typically has "all time" / "today" filters.
    try_click(page, [
        "text=/^all time$/i",
        "button:has-text('all time')",
        "[role='tab']:has-text('all time')",
        "[data-range='all']",
    ])


def enable_global_favourites(page) -> None:
    # The "Top" favourites default to personal; toggle to global if needed.
    page.evaluate(
        """
        () => {
          const toggle = document.querySelector('#global-switch');
          if (toggle && !toggle.classList.contains('on')) {
            toggle.click();
          }
        }
        """
    )
    page.wait_for_timeout(600)
    # Some versions require a refresh click to populate global results.
    try_click(page, [
        "#refresh-global",
        "#favourites-settings #refresh-global",
    ])
    page.wait_for_timeout(600)


def wait_for_initial_items(page, min_count: int = 16, timeout_seconds: int = 20) -> None:
    start = time.monotonic()
    last_count = -1
    stable_since = None
    while True:
        count = page.evaluate(
            """
            () => {
              const grid = document.querySelector('#favourites-grid');
              if (!grid) return 0;
              return grid.querySelectorAll('.global-emoji').length;
            }
            """
        )
        now = time.monotonic()
        if count != last_count:
            last_count = count
            stable_since = now
        if count >= min_count and stable_since and (now - stable_since) >= 1.0:
            return
        if (now - start) >= timeout_seconds:
            return
        time.sleep(0.25)


def extract_items(page) -> List[Item]:
    raw_items = page.evaluate(
        r"""
        () => {
          const container = document.querySelector('#favourites');
          if (!container) return [];
          const items = [];
          const seen = new Set();
          const numberRegex = /\b\d[\d,\.]*\s*[kK]?\b/;

          const grid = container.querySelector('#favourites-grid') || container;

          const bgNodes = Array.from(grid.querySelectorAll('div.global-emoji, div.emoji, div.emoji-item'));
          for (const node of bgNodes) {
            let bg = node.style && node.style.backgroundImage ? node.style.backgroundImage : '';
            if (!bg) {
              const computed = getComputedStyle(node);
              bg = computed ? computed.backgroundImage : '';
            }
            const match = bg.match(/url\(["']?(.*?)["']?\)/);
            let url = match ? match[1] : '';
            if (!url) continue;
            if (url.startsWith('//')) url = 'https:' + url;
            if (!/gstatic/i.test(url)) continue;
            if (seen.has(url)) continue;
            seen.add(url);

            let count = node.getAttribute('emoji-counter') || node.getAttribute('data-count') || null;
            if (!count) {
              const text = (node.textContent || '').trim();
              const matchCount = text.match(numberRegex);
              if (matchCount) count = matchCount[0];
            }

            items.push({
              url,
              favourite_count_raw: count ? String(count).trim() : null,
            });
          }

          const imgs = Array.from(grid.querySelectorAll('img'));
          for (const img of imgs) {
            let url = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
            if (!url) continue;
            if (url.startsWith('//')) url = 'https:' + url;
            if (!/gstatic/i.test(url)) continue;
            if (seen.has(url)) continue;
            seen.add(url);

            let count = null;

            if (img.dataset && img.dataset.count) count = img.dataset.count;
            if (!count) {
              let node = img;
              for (let i = 0; i < 4 && node; i++) {
                const candidate = node.querySelector('[data-count], .count, .fav-count, .favorite-count, .favourite-count, .likes, .like, .votes, .score');
                if (candidate) {
                  count = candidate.getAttribute('data-count') || candidate.textContent;
                  break;
                }
                node = node.parentElement;
              }
            }

            if (!count) {
              let node = img.parentElement;
              for (let i = 0; i < 3 && node; i++) {
                const text = (node.textContent || '').trim();
                const match = text.match(numberRegex);
                if (match) {
                  count = match[0];
                  break;
                }
                node = node.parentElement;
              }
            }

            items.push({
              url,
              favourite_count_raw: count ? String(count).trim() : null,
            });
          }

          return items;
        }
        """
    )
    return [Item(url=item["url"], favourite_count_raw=item.get("favourite_count_raw")) for item in raw_items]


def scroll_container(page, step: int) -> None:
    page.evaluate(
        """
        (step) => {
          const el =
            document.querySelector('#favourites-grid') ||
            document.querySelector('#favourites') ||
            document.scrollingElement ||
            document.documentElement;
          if (!el) return;
          if (!step || step <= 0) {
            el.scrollTop = el.scrollHeight;
          } else {
            el.scrollTop = el.scrollTop + step;
          }
        }
        """,
        step,
    )


def write_jsonl(path: str, items: List[Item]) -> None:
    ensure_parent_dir(path)
    with open(path, "w", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps({
                "url": item.url,
                "favourite_count_raw": item.favourite_count_raw,
            }, ensure_ascii=True) + "\n")


def find_headless_shell() -> Optional[str]:
    base_env = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    bases: List[Path] = []
    if base_env and base_env != "0":
        bases.append(Path(base_env).expanduser())
    else:
        bases.append(Path.home() / "Library" / "Caches" / "ms-playwright")
        bases.append(Path.cwd() / ".playwright")

    for base in bases:
        if not base.exists():
            continue
        for root in base.glob("chromium_headless_shell-*"):
            for sub in ("chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"):
                candidate = root / sub / "chrome-headless-shell"
                if candidate.exists():
                    return str(candidate)
    return None


def main() -> int:
    args = parse_args()

    limit_target = args.limit if args.limit and args.limit > 0 else None
    screenshot_start_path = args.screenshot_start_path or args.screenshot_path
    screenshot_end_path = args.screenshot_end_path

    with sync_playwright() as p:
        run_start = time.monotonic()
        executable_path = args.executable_path
        if not executable_path and args.headless:
            executable_path = find_headless_shell()
            if executable_path:
                print(f"Using headless shell: {executable_path}")

        launch_kwargs = {"headless": args.headless, "slow_mo": args.slow_mo}
        if executable_path:
            launch_kwargs["executable_path"] = executable_path

        browser = p.chromium.launch(**launch_kwargs)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()
        page.set_default_timeout(args.timeout)

        print(f"Opening {args.url} ...")
        page.goto(args.url, wait_until="domcontentloaded")
        page.wait_for_timeout(1500)

        dismiss_overlays(page)
        click_top_tab(page)
        page.wait_for_timeout(800)
        enable_global_favourites(page)
        click_all_time(page)
        page.wait_for_timeout(800)

        try:
            page.wait_for_selector("#favourites", timeout=args.timeout)
        except PlaywrightTimeoutError:
            print("Could not find #favourites container. The page structure may have changed.", file=sys.stderr)
            browser.close()
            return 1

        # Ensure we're at the top and the initial batch has rendered (captures highest-ranked items).
        page.evaluate(
            """
            () => {
              const grid = document.querySelector('#favourites-grid');
              if (grid) grid.scrollTop = 0;
            }
            """
        )
        wait_for_initial_items(page)

        seen: Dict[str, Item] = {}
        idle_scrolls = 0
        total_scrolls = 0
        last_new_time = time.monotonic()

        def should_continue() -> bool:
            if limit_target is not None and len(seen) >= limit_target:
                return False
            if args.max_idle_scrolls > 0 and idle_scrolls >= args.max_idle_scrolls:
                return False
            return True

        while should_continue():
            if args.stop_file and Path(args.stop_file).exists():
                print(f"Stop file detected ({args.stop_file}). Stopping.")
                break

            items = extract_items(page)
            before = len(seen)
            for item in items:
                if item.url not in seen:
                    seen[item.url] = item
                else:
                    # Prefer a non-empty count if we get one later.
                    if not seen[item.url].favourite_count_raw and item.favourite_count_raw:
                        seen[item.url] = item

            after = len(seen)
            entering_idle = after == before and idle_scrolls == 0
            if after == before:
                idle_scrolls += 1
                if entering_idle and screenshot_start_path:
                    try:
                        page.screenshot(path=screenshot_start_path, full_page=True)
                        print(f"Saved idle-start screenshot to {screenshot_start_path}")
                    except Exception as exc:
                        print(f"Failed to take screenshot: {exc}", file=sys.stderr)
            else:
                idle_scrolls = 0
                last_new_time = time.monotonic()

            total_scrolls += 1
            idle_seconds = int(time.monotonic() - last_new_time)
            target_display = limit_target if limit_target is not None else "∞"
            print(f"Collected {after} / {target_display} (scrolls: {total_scrolls}, idle: {idle_scrolls}, idle_seconds: {idle_seconds})")

            if args.max_idle_seconds > 0 and idle_seconds >= args.max_idle_seconds:
                if screenshot_end_path:
                    try:
                        page.screenshot(path=screenshot_end_path, full_page=True)
                        print(f"Saved idle-end screenshot to {screenshot_end_path}")
                    except Exception as exc:
                        print(f"Failed to take screenshot: {exc}", file=sys.stderr)
                break

            if limit_target is not None and after >= limit_target:
                break

            scroll_container(page, args.scroll_step)
            page.wait_for_timeout(int(args.scroll_pause * 1000))

        browser.close()
        run_seconds = int(time.monotonic() - run_start)
        print(f"Run time: {run_seconds}s")

    items_sorted = list(seen.values()) if limit_target is None else list(seen.values())[: limit_target]
    write_jsonl(args.output, items_sorted)
    print(f"Wrote {len(items_sorted)} items to {args.output}")

    if limit_target is not None and len(items_sorted) < limit_target:
        print(
            f"Stopped early after {len(items_sorted)} items. Try increasing --max-idle-scrolls/--max-idle-seconds or adjusting --scroll-step/--scroll-pause.",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
