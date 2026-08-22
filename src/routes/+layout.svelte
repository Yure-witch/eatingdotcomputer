<script>
	import '../app.css';
	import { updated } from '$app/stores';
	import { onMount } from 'svelte';
	import {
		loadSpriteSheet,
		loadTelegramEmoji,
		loadCustomPacks,
		TG_SPRITE_URL,
		tgAnimatedUrl,
		tgcUrl,
		isStaticPack,
		refreshAdaptiveInk,
		engineMode,
		usesWorkerPool
	} from '$lib/telegram-emoji-store.js';
	import {
		prewarm as prewarmSkottieWorker,
		prewarmAnimations as prewarmSkottieWorkerAnims,
		pushAdaptiveToShards
	} from '$lib/skottie-stage-worker.js';
	import { dropAdaptiveFrames as dropCpuAtlasAdaptive } from '$lib/cpu-atlas.js';
	import { initTheme, onThemeChanged } from '$lib/theme-store.js';
	import { initEmoteIdle } from '$lib/emote-idle.js';
	import { installChunkErrorRecovery } from '$lib/hard-refresh.js';
	import { initKeyboardMetrics } from '$lib/keyboard-metrics.js';
	import { initEmoteEngine } from '$lib/telegram-emoji-store.js';
	import { get } from 'svelte/store';
	import { dev } from '$app/environment';
	import { initNativeShell, isNativeApp, updateStatusBarTheme } from '$lib/native.js';
	import GetAppBanner from '$lib/components/GetAppBanner.svelte';
	import { afterNavigate, goto } from '$app/navigation';

	let { children } = $props();

	// ── Last-route memory (native shell + installed PWA) ────────────────
	const LAST_ROUTE_KEY = 'ec-last-route';
	// Restore only in app-like containers, where "opening" means launching an
	// icon rather than following a URL.
	const restoreLastRoute = () =>
		isNativeApp() || (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches);
	afterNavigate(() => {
		try {
			const p = location.pathname;
			if (p.startsWith('/app')) localStorage.setItem(LAST_ROUTE_KEY, p);
		} catch { /* private mode — resume just falls back to the dashboard */ }
	});

	onMount(() => {
		// A page loaded from an older build can't fetch chunk names that no longer
		// exist, so the first route it lazily imports fails and silently never
		// renders — which looks exactly like "the change didn't ship". Recover by
		// reloading onto the current build. Installed first: this is what makes
		// everything after it reachable.
		installChunkErrorRecovery();
		// Native shell setup (no-op on web/PWA) — wires the OS keyboard so
		// the compose coordinates with the real keyboard instead of the web
		// suppression hacks.
		initNativeShell();

		// Service worker: register everywhere, including the native shell.
		// The shell used to tear the SW down ("cache-first SW serves stale
		// chunks and black-screens the WKWebView") — but that predates three
		// things that make it safe and fast now: (1) WKAppBoundDomains in the
		// shell's Info.plist, which is what gives WKWebView service-worker
		// support at all (in binaries without it, navigator.serviceWorker is
		// simply undefined here and this is a no-op — which is why this code is
		// safe to ship to old installs); (2) this SW is network-first for HTML,
		// so a deploy's fresh document always pairs with its own chunks —
		// cache-first only applies to content-hashed assets, which never go
		// stale under their own name; (3) installChunkErrorRecovery above
		// hard-refreshes (SW unregistered, caches dropped, cache-busted reload)
		// if a stale pairing somehow happens anyway. What this buys the shell:
		// cold starts serve the whole JS/CSS/font bundle from disk instead of
		// the network, and the app still opens when offline.
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker
				.register('/service-worker.js', { type: dev ? 'module' : 'classic' })
				.catch(() => {});
		}

		// Reopen where you left off. The native shell (and installed PWA) cold
		// starts at "/", which redirects an authenticated session to /app — the
		// dashboard — no matter where you were when iOS killed the process.
		// afterNavigate (below) remembers the last /app route; when a launch
		// lands on exactly "/app" (the generic entry, never a deep link — push
		// notifications navigate straight to their own /app/... URLs), jump
		// back to the remembered place. replaceState so Back doesn't return to
		// the flash of dashboard. Web tabs are left alone: typing a URL into a
		// browser should go where the URL says.
		if (restoreLastRoute()) {
			try {
				const saved = localStorage.getItem(LAST_ROUTE_KEY);
				if (saved && saved !== '/app' && saved.startsWith('/app') && location.pathname === '/app') {
					goto(saved, { replaceState: true });
				}
			} catch { /* private mode — stay on the dashboard */ }
		}

		// Native resume: DON'T blindly reload (that's what flashed the loading
		// screen every time you came back). When the app returns to the foreground,
		// just check whether a NEWER version has been deployed. If so, reload to pick
		// it up; if not, stay exactly where you were — route, scroll, chat connection
		// all intact. (`updated.check()` fetches the version manifest and compares it
		// to the running build.) The native shell emits `native-resume` from its
		// appStateChange listener; we also catch web/PWA foregrounding via visibility.
		let _resumeChecking = false;
		const onAppResume = async () => {
			if (_resumeChecking) return;
			_resumeChecking = true;
			// Only CHECK for a new version — do NOT reload here. Reloading on resume
			// re-initializes whatever you were on (e.g. re-rasterizing a whole
			// conversation's emotes — the low-quality flash). updated.check() arms
			// SvelteKit's $updated, which shows the update banner AND makes the NEXT
			// navigation hard-reload into the new build. So the new version lands the
			// next time you move around the app; your current view stays put.
			try { await updated.check(); } catch {}
			_resumeChecking = false;
		};
		window.addEventListener('native-resume', onAppResume);

		// Hand the emote renderer's canvas/GPU memory back whenever we go away.
		// The Skottie worker keeps an atlas per pixel SIZE (picker cells, pack
		// tabs, avatars, each times devicePixelRatio, plus a high-density
		// variant), and until now none of them were ever freed — they were
		// allocated on first use and held for the life of the worker, which is
		// what got the iOS WebView jetsammed and the app reloaded underneath
		// you. Backgrounded, nothing is on screen to re-bake for, so drop the
		// lot; the disk frame cache survives, so coming back rehydrates from
		// cached frames rather than re-rendering any Lottie.
		const onBackground = async () => {
			try {
				const m = await import('$lib/skottie-stage-worker.js');
				m.reclaimMemory?.({ all: true });
			} catch { /* renderer never started — nothing to reclaim */ }
		};
		window.addEventListener('native-background', onBackground);

		const onVisible = () => {
			if (document.visibilityState === 'visible') onAppResume();
			else onBackground();
		};
		document.addEventListener('visibilitychange', onVisible);

		// On touch devices, drive the "emotes awake" idle signal so animated
		// emotes freeze after ~45s of no interaction (and wake on any) — that
		// sustained 60fps emote churn was jetsamming the native WebView.
		if (window.matchMedia?.('(pointer: coarse)')?.matches) initEmoteIdle();
		// Publishes --kb-h / --kb-h-last on <html>. Needed on every platform:
		// the chat layout sizes itself against the keyboard, and the expression
		// picker opens at the keyboard's height so swapping between the two
		// doesn't shift the compose bar.
		initKeyboardMetrics();

		// Pick the best RASTERIZED emote engine for this device — WebGPU-capable
		// devices get the GPU rasterizer, others the WebGL-free CPU atlas. Runs
		// before chat mounts so there's no engine-swap re-render mid-scroll.
		initEmoteEngine();

		// Load the instructor-hidden emote set so the picker + chat filter them.
		if (location.pathname.startsWith('/app')) {
			import('$lib/hidden-emotes.js').then((m) => m.initHiddenEmotes()).catch(() => {});
		}

		// Background-warm the whole emote library into the persistent frame cache
		// during idle time, so the first picker open is instant.
		//
		// This used to be desktop-only, on the reasoning that the battery and
		// storage cost wasn't worth it on a phone. But the phone is where the
		// cost of NOT having it shows up: without a warm cache every picker cell
		// rasterises on the spot, which is the 1-2s stall on first opening the
		// Telegram and recents tabs. Reading baked frames off disk is far cheaper
		// than baking them while the user waits.
		//
		// It remains heavily self-gating: it does nothing unless frames can be
		// persisted AND the active engine is the rasteriser that reads this
		// cache, it bakes a row per idle tick, it pauses in a background tab,
		// and it stops for good at half the storage quota. So a device that
		// can't afford it opts itself out.
		if (location.pathname.startsWith('/app')) {
			const warm = () => import('$lib/emote-prewarm.js').then((m) => m.startEmotePrewarm()).catch(() => {});
			if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 8000 });
			else setTimeout(warm, 4000);
		}

		// Apply the saved Material 3 theme as early as possible. Runs
		// in onMount so it happens client-side only — the hex fallbacks
		// in app.css cover SSR + the brief pre-hydration paint.
		initTheme();
		updateStatusBarTheme(); // match the native status-bar icons to the initial theme

		// Whenever the theme changes, the adaptive emoji pipeline needs
		// to know — re-read `--ink` into the worker pool so future
		// builds tint to the new color, and drop the main-thread
		// fetchLottie cache for adaptive URLs so they re-parse fresh.
		onThemeChanged(() => {
			updateStatusBarTheme(); // keep clock/battery legible against the themed notch
			const changed = refreshAdaptiveInk();
			if (changed) {
				pushAdaptiveToShards();   // worker (Skia) atlas re-bakes adaptive
				dropCpuAtlasAdaptive();   // CPU atlas re-bakes adaptive in new ink
			}
		});

		// Warm the Telegram emoji sprite sheet immediately on app boot.
		// The <link rel="preload"> in app.html has already begun the
		// network fetch; this call hooks the JS-side reactive store up to
		// the same response so the spriteSheet writable lights up the
		// instant the bytes finish downloading + decoding. By the time the
		// user opens the picker (or sees [tg:…] tokens in chat) the sheet
		// is already a disk-cache hit.
		loadSpriteSheet();

		// Prewarm the Skottie worker pool + queue every Telegram emoji
		// animation for background building, but ONLY if (a) the engine
		// renders through the worker pool and (b) we're inside the app shell
		// (`/app/*` — public landing/login pages don't use the picker).
		// We defer to requestIdleCallback so the first paint isn't
		// burdened with the CanvasKit WASM loads. Once kicked, the worker
		// pool stays alive for the rest of the session: opening the
		// picker becomes nearly instant, and the in-viewport priority
		// queue automatically takes over from "background building" the
		// moment the picker mounts (see processQueue in skottie-worker.js).
		//
		// Read the RESOLVED engine, not raw localStorage, and test it by
		// capability. This used to compare against the literal strings
		// 'skottie-worker' / 'skottie-webgpu' and fall back to 'rlottie'
		// when the key was absent — so once the rasterized engines became
		// the default, this whole block stopped running for everybody, and
		// every cold picker open paid for the worker pool on the critical
		// path. That is the "laggy from 0".
		try {
			const engine = get(engineMode);
			const inApp = location.pathname.startsWith('/app');
			// Skip the prewarm entirely on touch devices. Each pre-built
			// Skottie animation pins GPU memory (and on iOS WebGPU the
			// renderer is killed once we exceed the per-page budget),
			// and the prewarm queues hundreds whose refcount never
			// drops to zero because no cell ever "releases" them. On
			// phones we rely on on-demand build via the IO observer.
			const _isCoarse = window.matchMedia?.('(pointer: coarse)').matches;
			if (usesWorkerPool(engine) && inApp && !_isCoarse) {
				import('$lib/skottie-stage-worker.js').then((m) => {
					m.setPreferWebGPU?.(engine === 'skottie-webgpu');
				});
				const kick = () => prewarmTelegramSkottieWorker();
				if (typeof requestIdleCallback === 'function') {
					requestIdleCallback(kick, { timeout: 2000 });
				} else {
					setTimeout(kick, 500);
				}
			} else if (engine === 'cpu-rasterized' && inApp) {
				// Default engine: boot the rlottie pool at idle so the first
				// picker open doesn't pay the worker spawn + WASM load. Same
				// intent as the CanvasKit prewarm below it, ~25× cheaper —
				// which is why this one runs on touch devices too.
				import('$lib/lottie-spritesheet.js').then((m) => {
					const boot = () => m.prewarm?.();
					if (typeof requestIdleCallback === 'function') requestIdleCallback(boot, { timeout: 3000 });
					else setTimeout(boot, 1000);
				});
			} else if (usesWorkerPool(engine) && inApp && _isCoarse) {
				// Touch: flip the WebGPU preference AND boot the pool at idle,
				// but skip the bulk anim queue. Booting is the expensive,
				// unavoidable part (CanvasKit instantiation) and it is exactly
				// what made the first picker open on a phone feel broken;
				// paying it during an idle callback after the app has settled
				// costs the user nothing they can see. The bulk queue stays
				// desktop-only — THAT is what pins per-animation memory, and a
				// phone has none to spare.
				import('$lib/skottie-stage-worker.js').then((m) => {
					m.setPreferWebGPU?.(engine === 'skottie-webgpu');
					const boot = () => m.prewarm?.({ sheetUrl: TG_SPRITE_URL });
					if (typeof requestIdleCallback === 'function') requestIdleCallback(boot, { timeout: 4000 });
					else setTimeout(boot, 1200);
				});
			}
		} catch {}

		try {
			const font = localStorage.getItem('emoji-font') ?? 'noto';
			document.documentElement.classList.toggle('noto-emoji', font === 'noto');
			if (font === 'noto' && !document.querySelector('#noto-color-emoji-font')) {
				const link = document.createElement('link');
				link.id = 'noto-color-emoji-font';
				link.rel = 'stylesheet';
				link.href = 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap';
				document.head.appendChild(link);
			}
		} catch {}

		return () => {
			window.removeEventListener('native-resume', onAppResume);
			document.removeEventListener('visibilitychange', onVisible);
			window.removeEventListener('native-background', onBackground);
		};
	});

	async function prewarmTelegramSkottieWorker() {
		try {
			// 1. Boot the worker pool, push the sprite-sheet bytes to
			//    each worker as soon as they're ready. Custom-pack
			//    manifest is pulled internally by prewarm() so the
			//    adaptive-pack list reaches the workers before we
			//    queue any URLs to build.
			prewarmSkottieWorker({ sheetUrl: TG_SPRITE_URL });
			// 2. Wait for BOTH manifests so we can compute top-of-tab
			//    URLs across default categories AND custom packs.
			const [m, custom] = await Promise.all([
				loadTelegramEmoji(),
				loadCustomPacks()
			]);
			// 3. Take the first N items of every tab — that's the
			//    "above-the-fold" slice the user sees the instant a
			//    tab opens. Building these in the background means
			//    tab switches start with most of what's about to be
			//    on screen already in `_anims`; cells just below the
			//    fold load on-demand via the existing IO observer.
			//    The priority queue in skottie-worker.js orders all of
			//    this by viewport, so the user's actual scroll
			//    position always wins regardless of queue depth.
			//    Mobile gets a much smaller slice — the cost of
			//    building 600+ animations up-front is steep on
			//    phones (CPU, RAM, battery), and on-demand loading
			//    is fast enough on devices with WebGPU anyway.
			const _isCoarse = window.matchMedia?.('(pointer: coarse)').matches;
			const TOP_N = _isCoarse ? 8 : 24;
			const urls = new Set();
			if (m?.byCat) {
				for (const items of Object.values(m.byCat)) {
					let count = 0;
					for (const it of items) {
						if (it.flag) continue;
						const url = tgAnimatedUrl(it.cp);
						if (url) urls.add(url);
						if (++count >= TOP_N) break;
					}
				}
			}
			if (custom?.packs) {
				for (const pack of custom.packs) {
					if (isStaticPack(pack.short_name)) continue;
					let count = 0;
					for (const it of pack.emoji) {
						const url = tgcUrl(pack.short_name, it.id);
						if (url) urls.add(url);
						if (++count >= TOP_N) break;
					}
				}
			}
			if (urls.size) {
				prewarmSkottieWorkerAnims(Array.from(urls));
				console.log(`[layout] prewarming ${urls.size} top-of-tab animations across worker pool`);
			}
		} catch (e) {
			console.warn('[layout] skottie-worker prewarm failed', e);
		}
	}
</script>


{@render children()}

<GetAppBanner />

{#if $updated}
	<div class="update-banner">
		<span>A new version is available.</span>
		<button onclick={() => window.location.reload()}>Reload</button>
	</div>
{/if}

<footer class="build-info">build #{__BUILD_NUMBER__} · {__BUILD_SHA__}</footer>

<style>
	@media (max-width: 640px) {
		.update-banner {
			bottom: calc(max(6px, env(safe-area-inset-bottom, 0px)) + 60px + 12px);
		}
	}
	.update-banner {
		position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%);
		/* Above the mobile bottom nav, which is 60px tall, sits at
		   max(6px, safe-area) and carries z-index 1000 — at bottom:1rem this
		   banner was landing underneath it. */
		background: var(--ink); color: var(--paper);
		border: 1px solid #444; border-radius: 10px;
		padding: 0.6rem 1rem; z-index: 1001;
		display: flex; align-items: center; gap: 1rem;
		font-size: 0.85rem; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
		white-space: nowrap;
	}
	.update-banner button {
		background: var(--paper); color: var(--ink);
		border: none; border-radius: 6px;
		padding: 0.3rem 0.75rem; font-family: inherit;
		font-size: 0.82rem; font-weight: 600; cursor: pointer;
	}
	.build-info {
		position: fixed; bottom: 0.5rem; right: 0.75rem;
		font-size: 0.65rem; color: #bbb; pointer-events: none;
		font-family: monospace; z-index: 10;
	}
</style>
