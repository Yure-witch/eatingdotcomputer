<script>
	import favicon from '$lib/assets/favicon.svg';
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
	import { initTheme, onThemeChanged } from '$lib/theme-store.js';

	let { children } = $props();

	onMount(() => {
		// Apply the saved Material 3 theme as early as possible. Runs
		// in onMount so it happens client-side only — the hex fallbacks
		// in app.css cover SSR + the brief pre-hydration paint.
		initTheme();

		// Whenever the theme changes, the adaptive emoji pipeline needs
		// to know — re-read `--ink` into the worker pool so future
		// builds tint to the new color, and drop the main-thread
		// fetchLottie cache for adaptive URLs so they re-parse fresh.
		onThemeChanged(() => {
			const changed = refreshAdaptiveInk();
			if (changed) pushAdaptiveToShards();
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

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

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
