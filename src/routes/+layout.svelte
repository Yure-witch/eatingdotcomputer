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
		refreshAdaptiveInk
	} from '$lib/telegram-emoji-store.js';
	import {
		prewarm as prewarmSkottieWorker,
		prewarmAnimations as prewarmSkottieWorkerAnims,
		pushAdaptiveToShards
	} from '$lib/skottie-stage-worker.js';
	import { dropAdaptiveFrames as dropCpuAtlasAdaptive } from '$lib/cpu-atlas.js';
	import { initTheme, onThemeChanged } from '$lib/theme-store.js';
	import { initEmoteIdle } from '$lib/emote-idle.js';
	import { initEmoteEngine } from '$lib/telegram-emoji-store.js';
	import { dev } from '$app/environment';
	import { initNativeShell, isNativeApp, updateStatusBarTheme } from '$lib/native.js';
	import GetAppBanner from '$lib/components/GetAppBanner.svelte';

	let { children } = $props();

	onMount(() => {
		// Native shell setup (no-op on web/PWA) — wires the OS keyboard so
		// the compose coordinates with the real keyboard instead of the web
		// suppression hacks.
		initNativeShell();

		// Service worker: register on web/PWA, but NEVER inside the native
		// shell — a cache-first SW serves stale chunks into the WKWebView and
		// black-screens it. In the native app we instead tear down any SW that
		// a previous session (or the live site) left registered, and drop its
		// caches, so the web view always loads fresh from the network.
		if ('serviceWorker' in navigator) {
			if (isNativeApp()) {
				navigator.serviceWorker.getRegistrations()
					.then((regs) => regs.forEach((r) => r.unregister()))
					.catch(() => {});
				if (typeof caches !== 'undefined') {
					caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
				}
			} else {
				navigator.serviceWorker
					.register('/service-worker.js', { type: dev ? 'module' : 'classic' })
					.catch(() => {});
			}
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
		const onVisible = () => { if (document.visibilityState === 'visible') onAppResume(); };
		document.addEventListener('visibilitychange', onVisible);

		// On touch devices, drive the "emotes awake" idle signal so animated
		// emotes freeze after ~45s of no interaction (and wake on any) — that
		// sustained 60fps emote churn was jetsamming the native WebView.
		if (window.matchMedia?.('(pointer: coarse)')?.matches) initEmoteIdle();

		// Pick the best RASTERIZED emote engine for this device — WebGPU-capable
		// devices get the GPU rasterizer, others the WebGL-free CPU atlas. Runs
		// before chat mounts so there's no engine-swap re-render mid-scroll.
		initEmoteEngine();

		// Load the instructor-hidden emote set so the picker + chat filter them.
		if (location.pathname.startsWith('/app')) {
			import('$lib/hidden-emotes.js').then((m) => m.initHiddenEmotes()).catch(() => {});
		}

		// Background-warm the whole emote library into the persistent frame cache
		// during idle time, so the first picker open is instant. Desktop + in-app
		// only (skip the landing/login pages and touch devices, where it's not
		// worth the battery/storage); it self-gates on engine + storage budget.
		if (location.pathname.startsWith('/app') && window.matchMedia?.('(pointer: fine)').matches) {
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
		// animation for background building, but ONLY if (a) the user's
		// saved engine is WorkerGPU and (b) we're inside the app shell
		// (`/app/*` — public landing/login pages don't use the picker).
		// We defer to requestIdleCallback so the first paint isn't
		// burdened with 4 CanvasKit WASM loads. Once kicked, the worker
		// pool stays alive for the rest of the session: opening the
		// picker becomes nearly instant, and the in-viewport priority
		// queue automatically takes over from "background building" the
		// moment the picker mounts (see processQueue in skottie-worker.js).
		try {
			const engine = localStorage.getItem('tgEngine') || 'rlottie';
			const inApp = location.pathname.startsWith('/app');
			// Skip the prewarm entirely on touch devices. Each pre-built
			// Skottie animation pins GPU memory (and on iOS WebGPU the
			// renderer is killed once we exceed the per-page budget),
			// and the prewarm queues hundreds whose refcount never
			// drops to zero because no cell ever "releases" them. On
			// phones we rely on on-demand build via the IO observer.
			const _isCoarse = window.matchMedia?.('(pointer: coarse)').matches;
			if ((engine === 'skottie-worker' || engine === 'skottie-webgpu') && inApp && !_isCoarse) {
				import('$lib/skottie-stage-worker.js').then((m) => {
					m.setPreferWebGPU?.(engine === 'skottie-webgpu');
				});
				const kick = () => prewarmTelegramSkottieWorker();
				if (typeof requestIdleCallback === 'function') {
					requestIdleCallback(kick, { timeout: 2000 });
				} else {
					setTimeout(kick, 500);
				}
			} else if ((engine === 'skottie-worker' || engine === 'skottie-webgpu') && inApp && _isCoarse) {
				// Still need to flip the WebGPU preference so cells
				// boot the worker with the right surface backend on
				// first mount — just skip the bulk anim queue.
				import('$lib/skottie-stage-worker.js').then((m) => {
					m.setPreferWebGPU?.(engine === 'skottie-webgpu');
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
	.update-banner {
		position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%);
		background: var(--ink); color: var(--paper);
		border: 1px solid #444; border-radius: 10px;
		padding: 0.6rem 1rem; z-index: 999;
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
