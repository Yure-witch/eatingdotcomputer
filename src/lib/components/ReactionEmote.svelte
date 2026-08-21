<script>
	/**
	 * One reaction token, rendered.
	 *
	 * Reaction keys are not plain emoji — they can be any of the five things the
	 * expression picker can produce, and each renders differently:
	 *
	 *   😀                     plain text
	 *   [ce:shortcode]        an uploaded custom emote (image)
	 *   [ek:d36:cp:cp]        an Emoji Kitchen mashup (image, URL derived)
	 *   [tg:codepoint]        a standard animated Telegram emote
	 *   [tgc:shortcode:id]    a custom animated Telegram emote
	 *
	 * Passing these through the message renderer works for message BODIES, where
	 * a mount pass follows and turns the markup into players. A reaction chip has
	 * no such pass, so the same markup arrives inert — which is why animated
	 * reactions rendered as nothing. This owns the whole job instead: parse, then
	 * render the right element directly.
	 */
	import SpriteSticker from './SpriteSticker.svelte';
	import { getCachedCustomEmojiMap, getCustomEmojiMap } from '$lib/custom-emoji-store.js';
	import { ekTokenToUrl } from '$lib/message-render.js';

	let {
		token,
		size = 18,
		/** Chips are small and there are many on screen; a reaction never needs a
		 *  message bubble's fidelity. Medium raster, and a frame rate that reads
		 *  as motion without baking frames nobody perceives at this size. */
		oversample = 1.5,
		maxFps = 20
	} = $props();

	const parsed = $derived.by(() => {
		const t = String(token ?? '');
		let m = t.match(/^\[tgc:([A-Za-z0-9_]+):(\d+)\]$/);
		if (m) return { kind: 'tgc', short: m[1], id: m[2] };
		m = t.match(/^\[tg:([0-9a-f-]+)\]$/i);
		if (m) return { kind: 'tg', cp: m[1] };
		m = t.match(/^\[ce:([a-zA-Z0-9_-]{1,32})\]$/);
		if (m) return { kind: 'ce', shortcode: m[1] };
		m = t.match(/^\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]$/i);
		if (m) return { kind: 'ek', url: ekTokenToUrl(m[1], m[2], m[3]) };
		return { kind: 'text', text: t };
	});

	// The map is loaded once per session by the app layout, but a reaction can
	// render before that lands — so ask for it, and re-read when it arrives.
	let ceMapVersion = $state(0);
	$effect(() => {
		if (parsed.kind !== 'ce' || getCachedCustomEmojiMap()?.[parsed.shortcode]) return;
		getCustomEmojiMap().then(() => ceMapVersion++).catch(() => {});
	});
	const ceUrl = $derived.by(() => {
		void ceMapVersion;
		return parsed.kind === 'ce' ? (getCachedCustomEmojiMap()?.[parsed.shortcode] ?? null) : null;
	});
</script>

{#if parsed.kind === 'tg'}
	<SpriteSticker cp={parsed.cp} {size} {oversample} {maxFps} title={token} />
{:else if parsed.kind === 'tgc'}
	<SpriteSticker short={parsed.short} id={parsed.id} {size} {oversample} {maxFps} title={token} />
{:else if parsed.kind === 'ce' && ceUrl}
	<img class="rx-img" src={ceUrl} alt={parsed.shortcode} style:width="{size}px" style:height="{size}px" />
{:else if parsed.kind === 'ek'}
	<img class="rx-img" src={parsed.url} alt="emoji" style:width="{size}px" style:height="{size}px" />
{:else if parsed.kind === 'text'}
	<span class="rx-text" style:font-size="{size}px">{parsed.text}</span>
{:else}
	<!-- A known token whose art isn't available yet (map still loading, emote
	     deleted, or a bad id). Show a neutral placeholder rather than the raw
	     "[ce:whatever]" — the token is plumbing, not something to read. -->
	<span class="rx-blank" style:width="{size}px" style:height="{size}px" aria-hidden="true"></span>
{/if}

<style>
	.rx-img { display: inline-block; object-fit: contain; vertical-align: middle; }
	.rx-text { line-height: 1; display: inline-flex; align-items: center; }
	.rx-blank {
		display: inline-block; vertical-align: middle; border-radius: 4px;
		background: color-mix(in srgb, var(--ink) 12%, transparent);
	}
</style>
