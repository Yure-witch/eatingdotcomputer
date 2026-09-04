<script>
	// Hover info for expressions inside rendered message HTML — shared by
	// the chat pages and the thread panel. Handles:
	//   • plain emoji: positions the CSS `.e-tip-pop` (glyph + CLDR name)
	//     that wrapEmojiInText ($lib/emoji-tip.js) baked into the markup
	//   • Emoji Kitchen images ([data-ek]): floating card with the mix +
	//     its two source emoji ("where it came from")
	//   • custom emotes ([data-ce]): floating card with the :shortcode:
	//   • Telegram emotes (.tg-emoji spans): floating card with a live
	//     animated preview (LottieSticker), the emote's emoji name, then
	//     two meta lines: the picker tab it lives in ("Animated emotes" /
	//     "Emotes" with its Material icon), and underneath the pack it
	//     comes from ([tgc:], with the pack's tab-icon thumb) or just the
	//     category name (default [tg:] emoji)
	// Attach by passing the scrollable message container as `root` — the
	// component wires its own listeners and renders one fixed-position card.
	import { ekTokenToUrl } from '$lib/message-render.js';
	import { getCachedCustomEmojiMap } from '$lib/custom-emoji-store.js';
	import { loadEmojiNames } from '$lib/emoji-names.js';
	import { emojiDisplayName } from '$lib/emoji-tip.js';
	import { loadTelegramEmoji, loadCustomPacks, tgEntry, tgcEntry, getCachedCustomPacks,
		tgcThumbUrl, isAdaptivePack, isStaticPack } from '$lib/telegram-emoji-store.js';
	import LottieSticker from './LottieSticker.svelte';
	import { onMount } from 'svelte';

	let { root = null } = $props();

	let tip = $state(null);
	let _lastMX = null, _lastMY = 0;
	const TIP_W = 160, TIP_MARGIN = 8;
	const tipLeft = (cx) => Math.max(TIP_MARGIN, Math.min(cx - TIP_W / 2, window.innerWidth - TIP_W - TIP_MARGIN));

	function ekCpToChar(cp) {
		try { return String.fromCodePoint(...cp.split('-').map((p) => parseInt(p, 16))); } catch { return ''; }
	}

	function onOver(e) {
		// A reaction chip has its own hover card, which names the expression AND
		// the menu it came from. Firing this as well stacked two cards over one
		// small chip — the enlarged glyph appearing twice, once in each.
		if (e.target.closest?.('.reaction-chip')) { tip = null; return; }
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
		// mousemove fires at pointer-poll rate (60–120Hz). The full
		// dataset/regex/closest scan below only matters when the cursor has
		// actually crossed onto a different element — gate it on movement
		// distance so hovering still costs ~nothing.
		if (_lastMX !== null && Math.abs(e.clientX - _lastMX) < 3 && Math.abs(e.clientY - _lastMY) < 3) return;
		_lastMX = e.clientX; _lastMY = e.clientY;
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
		// Telegram emote spans hold a mounted canvas/svg child, so the hover
		// target is usually that child — resolve up to the .tg-emoji span.
		const tg = target.closest?.('.tg-emoji');
		if (tg) {
			const rect = tg.getBoundingClientRect();
			const isJumbo = !!tg.closest('.jumbo-emoji');
			if (tg.dataset.tgId) { // custom pack emote [tgc:short:id]
				const id = tg.dataset.tgId;
				const entry = tgcEntry(id);
				const short = tg.dataset.tgPack || entry?.short;
				// Adaptive packs ship white-silhouette art — the pre-baked
				// webp thumb would be invisible on the card, but the live
				// LottieSticker path tints it to --ink, so the big animated
				// preview works; only the pack-line thumb icon is skipped.
				const adaptive = short && isAdaptivePack(short);
				// The pack's tab icon in the picker is its first emote — use
				// that thumb as the icon on the pack line.
				const firstId = getCachedCustomPacks()?.packs
					.find((p) => p.short_name === short)?.emoji[0]?.id;
				const isStatic = short && isStaticPack(short);
				tip = { type: 'tg', left: tipLeft(rect.left + rect.width / 2), anchorY: rect.bottom,
					short, id, img: !isJumbo && !!short, imgKey: `tgc:${short}:${id}`,
					name: entry?.alt ? (emojiDisplayName(entry.alt) ?? entry.alt) : null,
					// Line 1: the picker tab (static packs live under Emotes,
					// animated packs under Animated emotes). Line 2: the pack.
					metaMsi: isStatic ? 'sentiment_very_satisfied' : 'animated_images',
					metaTab: isStatic ? 'Emotes' : 'Animated emotes',
					metaIconUrl: firstId && !adaptive ? tgcThumbUrl(short, firstId) : null,
					metaSub: entry?.packTitle ?? short ?? '' };
				return;
			}
			if (tg.dataset.tgCp) { // default Telegram emote [tg:cp]
				const cp = tg.dataset.tgCp;
				const entry = tgEntry(cp);
				tip = { type: 'tg', left: tipLeft(rect.left + rect.width / 2), anchorY: rect.bottom,
					cp, flag: !!entry?.flag, img: !isJumbo, imgKey: `tg:${cp}`,
					name: entry?.e ? (emojiDisplayName(entry.e) ?? entry.e) : null,
					// Line 1: the picker tab. Line 2: "Special · <category>" for
					// effect-capable (av>0) emotes, else just the category name.
					metaMsi: 'animated_images', metaTab: 'Animated emotes',
					metaSub: entry ? (entry.av > 0 ? `Special · ${entry.cat}` : entry.cat) : '' };
				return;
			}
		}
		tip = null;
	}

	function onLeave() { tip = null; }
	function onScroll() { tip = null; }

	// Warm the CLDR name cache for the pops + the Telegram manifests so
	// tgEntry/tgcEntry have data by the time anything is hovered (all three
	// are cached module-level, so this is free on surfaces that already load them).
	onMount(() => { loadEmojiNames(); loadTelegramEmoji(); loadCustomPacks(); });

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
			<span class="et-meta"><span class="msi et-meta-msi">blender</span> Emoji Kitchen</span>
		{:else if tip.type === 'ce'}
			<img class="et-img" src={tip.url} alt={tip.shortcode} />
			<span class="et-shortcode">:{tip.shortcode}:</span>
			<span class="et-meta"><span class="msi et-meta-msi">sentiment_very_satisfied</span> Custom emotes</span>
		{:else if tip.type === 'tg'}
			{#if tip.img}
				<!-- Live animated preview — LottieSticker plays when visible,
				     freezes static packs, renders flags as webp, tints
				     adaptive packs. Keyed so hovering a different emote
				     remounts the player (props are read once on mount). -->
				{#key tip.imgKey}
					<LottieSticker cp={tip.cp} flag={tip.flag} short={tip.short} id={tip.id} size={64} />
				{/key}
			{/if}
			{#if tip.name}<span class="et-name">{tip.name}</span>{/if}
			{#if tip.metaTab}
				<span class="et-meta">
					{#if tip.metaMsi}<span class="msi et-meta-msi">{tip.metaMsi}</span>{/if}
					{tip.metaTab}
				</span>
			{/if}
			{#if tip.metaSub || tip.metaIconUrl}
				<span class="et-meta">
					{#if tip.metaIconUrl}<img class="et-meta-icon" src={tip.metaIconUrl} alt="" />{/if}
					{tip.metaSub}
				</span>
			{/if}
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
	.et-name {
		font-size: 0.78rem; text-align: center; line-height: 1.3;
		text-transform: capitalize; max-width: 140px;
	}
	.et-meta {
		font-size: 0.68rem; color: var(--muted-fg); text-align: center; line-height: 1.3; max-width: 140px;
		display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem;
	}
	.et-meta-icon { width: 15px; height: 15px; object-fit: contain; flex-shrink: 0; }
	.et-meta-msi { font-size: 15px; line-height: 1; flex-shrink: 0; }

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
	/* The plain-emoji pop is pure CSS, so the JS guard above can't stop it —
	   it has to be switched off here too. */
	:global(.reaction-chip .e-tip:hover .e-tip-pop) { display: none; }
	:global(.e-tip-char) {
		font-size: 2.6rem; line-height: 1.1;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif, 'Noto Color Emoji';
	}
	:global(.e-tip-name) {
		font-size: 0.72rem; color: var(--muted-fg); text-align: center; line-height: 1.3;
		text-transform: capitalize; max-width: 160px;
	}
	:global(.e-tip-meta) {
		font-size: 0.68rem; color: var(--muted-fg); line-height: 1.3;
		display: inline-flex; align-items: center; gap: 0.25rem;
	}
	:global(.e-tip-meta .msi) { font-size: 15px; line-height: 1; }
</style>
