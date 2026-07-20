<script>
	// Hover info for expressions inside rendered message HTML — shared by
	// the chat pages and the thread panel. Handles:
	//   • plain emoji: positions the CSS `.e-tip-pop` (glyph + CLDR name)
	//     that wrapEmojiInText ($lib/emoji-tip.js) baked into the markup
	//   • Emoji Kitchen images ([data-ek]): floating card with the mix +
	//     its two source emoji ("where it came from")
	//   • custom emotes ([data-ce]): floating card with the :shortcode:
	// Attach by passing the scrollable message container as `root` — the
	// component wires its own listeners and renders one fixed-position card.
	import { ekTokenToUrl } from '$lib/message-render.js';
	import { getCachedCustomEmojiMap } from '$lib/custom-emoji-store.js';
	import { loadEmojiNames } from '$lib/emoji-names.js';
	import { onMount } from 'svelte';

	let { root = null } = $props();

	let tip = $state(null);
	const TIP_W = 160, TIP_MARGIN = 8;
	const tipLeft = (cx) => Math.max(TIP_MARGIN, Math.min(cx - TIP_W / 2, window.innerWidth - TIP_W - TIP_MARGIN));

	function ekCpToChar(cp) {
		try { return String.fromCodePoint(...cp.split('-').map((p) => parseInt(p, 16))); } catch { return ''; }
	}

	function onOver(e) {
		const eTip = e.target.closest?.('.e-tip');
		if (!eTip) return;
		const pop = eTip.querySelector('.e-tip-pop');
		if (!pop) return;
		const rect = eTip.getBoundingClientRect();
		pop.style.left = tipLeft(rect.left + rect.width / 2) + 'px';
		pop.style.top = (rect.bottom + 10) + 'px';
		pop.style.transform = 'none';
	}

	function onMove(e) {
		const target = e.target;
		if (target.dataset?.ek) {
			const m = target.dataset.ek.match(/\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]/i);
			if (m) {
				const rect = target.getBoundingClientRect();
				const isJumbo = !!target.closest('.jumbo-emoji');
				tip = { type: 'ek', left: tipLeft(rect.left + rect.width / 2), anchorY: rect.bottom,
					url: isJumbo ? null : ekTokenToUrl(m[1], m[2], m[3]),
					parentChar: ekCpToChar(m[2]), childChar: ekCpToChar(m[3]) };
				return;
			}
		}
		if (target.dataset?.ce) {
			const m = target.dataset.ce.match(/\[ce:([a-zA-Z0-9_-]+)\]/);
			if (m) {
				const rect = target.getBoundingClientRect();
				tip = { type: 'ce', left: tipLeft(rect.left + rect.width / 2), anchorY: rect.bottom,
					url: getCachedCustomEmojiMap()[m[1]]?.url, shortcode: m[1] };
				return;
			}
		}
		tip = null;
	}

	function onLeave() { tip = null; }
	function onScroll() { tip = null; }

	onMount(() => { loadEmojiNames(); }); // warm the CLDR name cache for the pops

	$effect(() => {
		const el = root;
		if (!el) return;
		el.addEventListener('mouseover', onOver);
		el.addEventListener('mousemove', onMove);
		el.addEventListener('mouseleave', onLeave);
		el.addEventListener('scroll', onScroll, true);
		return () => {
			el.removeEventListener('mouseover', onOver);
			el.removeEventListener('mousemove', onMove);
			el.removeEventListener('mouseleave', onLeave);
			el.removeEventListener('scroll', onScroll, true);
		};
	});
</script>

{#if tip}
	<div class="emoji-tooltip" style="--tip-x: {tip.left}px; --tip-y: {tip.anchorY}px">
		{#if tip.type === 'ek'}
			{#if tip.url}<img class="et-img" src={tip.url} alt="" />{/if}
			<div class="et-ek-mix">
				<span class="et-mix-char">{tip.parentChar}</span>
				<span class="et-mix-plus">+</span>
				<span class="et-mix-char">{tip.childChar}</span>
			</div>
		{:else if tip.type === 'ce'}
			<img class="et-img" src={tip.url} alt={tip.shortcode} />
			<span class="et-shortcode">:{tip.shortcode}:</span>
		{/if}
	</div>
{/if}

<style>
	.emoji-tooltip {
		position: fixed;
		z-index: 9999;
		pointer-events: none;
		width: 160px;
		left: var(--tip-x, 8px);
		top: var(--tip-y, 0px);
		transform: translateY(10px);
		border-radius: 10px;
		background: var(--paper, var(--paper));
		border: 1.5px solid var(--border);
		box-shadow: 0 4px 18px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		padding: 0.55rem 0.75rem 0.45rem;
		display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
		animation: et-pop 0.12s cubic-bezier(0.2, 1.2, 0.4, 1) both;
	}
	@keyframes et-pop { from { opacity: 0; transform: translateY(4px) scale(0.88); } to { opacity: 1; transform: translateY(10px) scale(1); } }
	.et-img { width: 64px; height: 64px; object-fit: contain; }
	.et-ek-mix { display: flex; align-items: center; gap: 0.3rem; font-size: 1.4rem; line-height: 1; }
	.et-mix-char { font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif, 'Noto Color Emoji'; }
	.et-mix-plus { font-size: 0.85rem; color: var(--muted-fg); }
	.et-shortcode { font-size: 0.75rem; color: var(--muted-fg); font-family: monospace; }

	/* Inline emoji pops (`.e-tip` spans baked by wrapEmojiInText) — global
	   so they style rendered HTML in ANY surface that mounts this component */
	:global(.e-tip) { position: relative; display: inline; }
	:global(.e-tip-pop) {
		display: none;
		position: fixed;
		left: 0; top: 0;
		width: 160px;
		z-index: 9999;
		pointer-events: none;
		border-radius: 10px;
		flex-direction: column; align-items: center; gap: 0.25rem;
		background: var(--paper, var(--paper));
		border: 1.5px solid var(--border);
		box-shadow: 0 4px 18px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		padding: 0.55rem 0.75rem 0.45rem;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
		animation: et-pop 0.12s cubic-bezier(0.2, 1.2, 0.4, 1) both;
	}
	:global(.e-tip:hover .e-tip-pop) { display: flex; }
	:global(.e-tip-char) {
		font-size: 2.6rem; line-height: 1.1;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif, 'Noto Color Emoji';
	}
	:global(.e-tip-name) {
		font-size: 0.72rem; color: var(--muted-fg); text-align: center; line-height: 1.3;
		text-transform: capitalize; max-width: 160px;
	}
</style>
