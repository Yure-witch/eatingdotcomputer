<script>
	// Harness: mounts the ExpressionPicker on its own so its chrome can be looked
	// at without a session — deliberately outside /app, so there's no auth gate
	// and it's reachable in prod at /dev-picker. Every callback is a no-op, it
	// reads nothing and writes nothing, and it's noindex'd below so it can't turn
	// up in search. Delete the folder when it stops being useful.
	//
	// It has to BOOT the emote data itself. `initEmoteEngine()` runs in the root
	// layout so the engine is picked either way, but the manifests are loaded by
	// /app/+layout.svelte — which this route never mounts, being outside /app.
	// Without them the Telegram tabs have nothing to show, which is why the
	// animated emotes were missing here while working fine in a chat.
	import { onMount } from 'svelte';
	import ExpressionPicker from '$lib/components/ExpressionPicker.svelte';
	import {
		loadTelegramEmoji, loadCustomPacks, loadSpriteSheet
	} from '$lib/telegram-emoji-store.js';
	import { initKeyboardMetrics } from '$lib/keyboard-metrics.js';
	import { prewarmPicker } from '$lib/picker-prewarm.js';

	const noop = () => {};
	let booted = $state('loading emote data…');

	onMount(async () => {
		// Same three the app layout warms. The sprite sheet matters as much as
		// the manifest: it is what paints a cell's resting frame before its
		// animation is baked, so without it cells come up blank rather than still.
		try {
			await Promise.all([
				loadTelegramEmoji(),
				loadCustomPacks().catch(() => {}),
				loadSpriteSheet().catch(() => {})
			]);
			booted = '';
		} catch (e) {
			booted = 'emote data failed to load: ' + (e?.message || e);
		}

		// Picker height in a chat comes from --kb-h-last, the height the keyboard
		// last occupied. There is no input here to raise a keyboard, so seed it
		// from the stored value (initKeyboardMetrics does that) and fall back to a
		// realistic phone keyboard if this device has never stored one — otherwise
		// the sheet opens at a height no real chat would ever produce.
		try { initKeyboardMetrics(); } catch {}

		// The chat pages call this on mount and this harness did not, so the
		// background library bake — the main suspect for the picker's cost, and
		// the thing the profiler's warm on/off button toggles — simply never ran
		// here. Without it the A/B was measuring nothing. Respects the same
		// noEmoteWarm kill switch, so the toggle works exactly as it does in a
		// real chat.
		try { prewarmPicker(); } catch {}
		try {
			const r = document.documentElement;
			if (!getComputedStyle(r).getPropertyValue('--kb-h-last').trim()) {
				r.style.setProperty('--kb-h-last', '336px');
			}
		} catch {}
	});
</script>

<svelte:head>
	<title>picker preview</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<!-- A real input, because the picker's height in a chat comes from --kb-h-last:
     the height the keyboard last occupied. With nothing here to focus, that was
     never measured and the sheet fell back to a guess. Tap this, let the
     keyboard come up, dismiss it — the picker is then exactly the height it has
     in a chat, on this device. -->
<input class="dev-input" placeholder="tap here to raise the keyboard" />

<div class="dev-dock">
	<ExpressionPicker
		onSelectEmoji={noop}
		onInsertKitchen={noop}
		onInsertCustomEmoji={noop}
		onInsertTgEmoji={noop}
		onClose={noop}
		onBackspace={noop}
	/>
</div>

<style>
	.dev-dock {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 50;
		/* EXACTLY chat's sheet geometry (see .fi-expr-pop in FormattedInput):
		   open at the height the keyboard occupied, capped at 58vh, and own the
		   safe area the compose bar gives up. Without this the picker sat at its
		   natural content height, which is not the height it ever has in a chat —
		   so the grid showed a different number of rows than the thing being
		   profiled. */
		height: calc(min(var(--kb-h-last, 22rem), 58vh) + env(safe-area-inset-bottom, 0px));
		padding-bottom: env(safe-area-inset-bottom, 0px);
		background: var(--paper);
		border-top: 1.5px solid var(--border);
		overflow: hidden;
	}
	/* The picker fills the sheet rather than sitting at its natural height. */
	.dev-dock > :global(*) { height: 100%; }

	:global(body) { background: var(--paper, #fff); }
	.dev-input {
		position: fixed; left: 8px; right: 8px;
		top: calc(env(safe-area-inset-top, 0px) + 96px);
		z-index: 10;
		font: 15px system-ui; padding: 10px 12px;
		border: 1.5px solid var(--border, #ccc); border-radius: 10px;
		background: var(--paper, #fff); color: var(--ink, #222);
	}
</style>
