<script>
	/**
	 * Compact user avatar. Three rendering kinds — selected by
	 * `avatarKind`, falling back to 'gen' for any unknown value:
	 *
	 *   gen   — Generative default. A two-stop linear gradient hashed
	 *           deterministically from `uid` (same uid → same gradient,
	 *           forever) with the first letter of `name` centered. The
	 *           letter colour picks ink-on-paper or paper-on-ink based
	 *           on the gradient's average luminance so it stays legible
	 *           against any hashed colour combination.
	 *
	 *   photo — Uploaded photo. `avatarValue` is an absolute URL
	 *           (Cloudflare R2 in practice). Rendered as an <img>
	 *           cover-fit to the chip.
	 *
	 *   expr  — Emoji / EK kitchen / custom emote / TG emote token.
	 *           `avatarValue` is the canonical inline token (bare
	 *           emoji char, `[ek:…]`, `[ce:…]`, `[tg:…]`, `[tgc:…]`).
	 *           contentHtml + the existing mountStaticEmotes pipeline
	 *           handle rendering, so animated TG emote avatars actually
	 *           animate wherever the component appears.
	 *
	 * Sized via the `size` prop (CSS pixels). Default 24 is the right
	 * scale for inline lists (mention picker, notification bell).
	 */
	import { onMount, tick } from 'svelte';
	import { createContentRenderer } from '$lib/message-render.js';
	import { mountStaticEmotes } from '$lib/emote-mount.js';
	import { getCustomEmojiMap, getCachedCustomEmojiMap, isCustomEmojiLoaded } from '$lib/custom-emoji-store.js';
	import { genPalette } from '$lib/avatar-gen.js';

	let {
		name = '',
		uid = '',
		size = 24,
		avatarKind = 'gen',
		avatarValue = null
	} = $props();

	// getCeMap is the whole ballgame for [ce:…] avatars: the default is an
	// empty map, under which every custom emote renders as its :shortcode:
	// fallback — which is exactly how this component behaved until now.
	const { contentHtml } = createContentRenderer({ getCeMap: getCachedCustomEmojiMap });

	const initial = $derived(((name || '?').trim().charAt(0) || '?').toUpperCase());

	// Deterministic palette selection. genPalette() picks one of a
	// curated 24-entry palette (see avatar-gen.js for the rationale)
	// keyed off the uid, plus a hashed gradient angle so two adjacent
	// users in a member list don't read as duplicates.
	const palette = $derived(genPalette(uid || name || ''));

	// `expr` rendering goes through contentHtml so emote tokens
	// produce the right `<img>` / `<span>` shape. Plain emoji chars
	// pass straight through.
	// A [ce:…] avatar needs the class's custom-emote map to resolve. Only the app
	// layout used to load it, so the same token rendered fine in chat and blank
	// during onboarding, which has its own layout. Fetch it on demand and bump
	// this to re-render once it lands.
	let _ceVer = $state(0);
	$effect(() => {
		if (avatarKind !== 'expr' || !avatarValue || !String(avatarValue).includes('[ce:')) return;
		// `isCustomEmojiLoaded`, not map-emptiness: the map is seeded with the
		// built-in WeChat set, so it is never empty and emptiness would mean
		// the class's uploads never get fetched at all.
		if (isCustomEmojiLoaded()) return;
		getCustomEmojiMap().then(() => _ceVer++).catch(() => {});
	});

	const exprHtml = $derived(
		(void _ceVer, avatarKind === 'expr' && avatarValue) ? contentHtml(avatarValue, false) : ''
	);

	let exprEl = $state(null);
	$effect(() => {
		void exprHtml;
		if (!exprEl) return;
		tick().then(() => mountStaticEmotes(exprEl));
	});
</script>

{#if avatarKind === 'photo' && avatarValue}
	<span class="avatar avatar-photo" style:width="{size}px" style:height="{size}px">
		<img src={avatarValue} alt={name} loading="lazy" />
	</span>
{:else if avatarKind === 'expr' && avatarValue}
	<span
		class="avatar avatar-expr"
		style:width="{size}px"
		style:height="{size}px"
		style:font-size="{Math.round(size * 0.78)}px"
		aria-label={name}
		bind:this={exprEl}
	>{@html exprHtml}</span>
{:else}
	<!-- Default generative gradient + initial. Curated palette gives
	     the chip a friendly painterly look instead of muddy HSL,
	     and the ink colour is pre-chosen per palette so the letter is
	     legible without a runtime contrast computation. -->
	<span
		class="avatar avatar-gen"
		style:width="{size}px"
		style:height="{size}px"
		style:background="linear-gradient({palette.angle}deg, {palette.a} 0%, {palette.b} 100%)"
		style:color={palette.ink}
		style:font-size="{Math.round(size * 0.41)}px"
		aria-hidden="true"
	>{initial}</span>
{/if}

<style>
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		flex-shrink: 0;
		line-height: 1;
		overflow: hidden;
		position: relative;
	}
	/* Letter typography mirrors the top-right user-menu chip
	   (.user-avatar in UserMenu.svelte): inherits the app's body
	   sans, 700 weight, slight negative tracking so the cap sits
	   confidently centered. The vibrant palette is the personality;
	   the type stays neutral so it doesn't fight the colour. */
	.avatar-gen {
		font-family: inherit;
		font-weight: 700;
		letter-spacing: -0.02em;
		/* Subtle inset highlight + bottom-shadow keep the chip from
		   looking flat-painted; a sharp text-shadow gives the letter
		   a bit of separation against the most chromatic palette
		   stops without dulling the colour. */
		box-shadow:
			inset 0 0 0 1px rgba(255, 255, 255, 0.22),
			inset 0 -2px 5px rgba(0, 0, 0, 0.12);
		text-shadow: 0 1px 0 rgba(0, 0, 0, 0.18);
	}
	.avatar-photo img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.avatar-expr {
		background: var(--md-sys-color-surface-container, var(--surface-2));
		line-height: 1;
	}
	/* Emote tokens inside an expression-avatar should fill the chip.
	   contentHtml's `.tg-emoji` / `.ek-img` / `.ce-img` default to
	   em-sizes meant for inline-with-text rendering; here they need
	   to take the whole square. */
	.avatar-expr :global(.tg-emoji),
	.avatar-expr :global(.tg-emoji-img),
	.avatar-expr :global(.ek-img),
	.avatar-expr :global(.ce-img),
	.avatar-expr :global(.tg-img) {
		width: 100%;
		height: 100%;
		vertical-align: middle;
	}
</style>
