<script>
	/**
	 * Unified expression picker — single popover with one tab per
	 * inserter: Emoji, Kitchen, GIFs, Emotes, Animated, Reactions.
	 *
	 * Replaces the row of 5 separate buttons + popovers in chat compose.
	 * The chat page mounts one `<ExpressionPicker>` and passes every
	 * insertion callback through.
	 */
	import EmojiPicker from './EmojiPicker.svelte';
	import EmojiKitchen from './EmojiKitchen.svelte';
	import CustomEmojiPanel from './CustomEmojiPanel.svelte';
	import TelegramEmojiPanel from './TelegramEmojiPanel.svelte';
	import PickerStickyBtn from './PickerStickyBtn.svelte';
	import SpriteSticker from './SpriteSticker.svelte';
	import { isTgHidden } from '$lib/tg-visibility.js';
	import { getExprRecents, addExprRecent, exprRecentKey } from '$lib/expr-recents.js';
	import { ekTokenToUrl } from '$lib/message-render.js';

	// Per-user switch (users.hide_tg_emoji): drop the Telegram surfaces —
	// the Animated tab and the Emotes Library sub-tab.
	const tgHidden = isTgHidden();

	let {
		onSelectEmoji,        // (emoji: string) → from EmojiPicker
		onInsertKitchen,      // (svgUrl: string) → from EmojiKitchen
		onSelectGif,          // (gif: object) → from GifPicker
		onInsertCustomEmoji,  // (emoji: object) → from CustomEmojiPanel
		onInsertReaction,     // (reaction: object) → from CustomEmojiPanel
		onInsertTgEmoji,      // (sticker: object) → from TelegramEmojiPanel
		isInstructor = false,
		// `mode` controls which surface the picker renders:
		//   'compose' (default) — full 6-tab picker for chat compose and
		//                         assignment-form text fields. Every
		//                         callback fires; consumer wires what
		//                         it cares about.
		//   'react'             — compact emoji-only view for message
		//                         reactions. No tab strip; the picker
		//                         is just the bare EmojiPicker so the
		//                         reaction-pick UX stays focused while
		//                         still sharing the same `emoji-recent`
		//                         localStorage that compose mode uses.
		mode = 'compose',
		// `inline` hides surfaces that don't make sense outside of a
		// real chat compose: Giphy GIFs (always full-size attachment-
		// style) and reaction images (the big "react sticker" gallery).
		// Used by FormattedInput when the picker is embedded inside a
		// formatted text field — assignments, notes, etc. — where you
		// just want emoji + emotes + animated stickers, not GIF
		// uploads or reaction-image attachments. Default `false` so
		// chat usage is unchanged.
		inline = false,
		// Optional close handler — when provided, a ✕ button is pinned to the
		// top-left corner of the panel (visible in every category).
		onClose = null,
		// Optional backspace handler — when provided, a ⌫ button sits at the
		// bottom-right of the (bottom) category strip and deletes the last
		// character / emote in the compose. Used by the docked mobile picker.
		onBackspace = null
	} = $props();

	// Top-level tab. Persisted so reopening the picker lands on the
	// last category the user was using. In inline mode the GIFs and
	// Reactions tabs are hidden — if the persisted choice was one of
	// those, fall back to emoji so the picker doesn't open on an
	// invisible tab.
	const TAB_KEY = 'exprTab';
	// GIFs + reaction images now live in their own MediaPicker, so this picker
	// only has emoji / kitchen / emotes / animated. A stale saved 'gifs' or
	// 'reactions' falls back to emoji.
	const VALID_TABS = new Set(['recent', 'emoji', 'kitchen', 'emotes', ...(tgHidden ? [] : ['animated'])]);
	const _saved = typeof localStorage !== 'undefined' ? localStorage.getItem(TAB_KEY) : null;
	let tab = $state(VALID_TABS.has(_saved) ? _saved : 'emoji');
	$effect(() => {
		try { localStorage.setItem(TAB_KEY, tab); } catch {}
	});

	// Emotes tab has two sources: the class's uploaded custom emotes
	// (R2-backed PNGs / GIFs / WebPs) and the static Telegram packs
	// (CrazyEmoji / MadEmoji2 / HeartEmoji) — packs whose artwork
	// has no frame-to-frame motion, so they belong with non-animated
	// emotes rather than under Animated. A sub-tab persists each
	// section's own search / scroll chrome so they don't fight inside
	// the 320 px mobile panel.
	const EMOTES_SUB_KEY = 'exprEmotesSub';
	const _savedSub = typeof localStorage !== 'undefined' ? localStorage.getItem(EMOTES_SUB_KEY) : null;
	let emotesSub = $state(_savedSub === 'library' && !tgHidden ? 'library' : 'uploaded');
	$effect(() => {
		try { localStorage.setItem(EMOTES_SUB_KEY, emotesSub); } catch {}
	});

	// Reactions tab only handles reactions; pass a no-op for emoji
	// insertion. CustomEmojiPanel hides the unused side via `mode`.
	const _noop = () => {};

	// ── Shared recents ───────────────────────────────────────────────
	// Every insert routes through these wrappers so the Recent tab sees
	// all expression types from all surfaces. Recents replay through the
	// same wrappers, which also bumps them back to the front.
	function fireEmoji(e) {
		// stamp the font mode the emoji is being sent in, so the Recent tab
		// renders it the same way (re-sending refreshes the stamp)
		let f = 'noto';
		try { f = localStorage.getItem('emoji-font') || 'noto'; } catch { /* default */ }
		addExprRecent({ t: 'emoji', v: e, f });
		onSelectEmoji?.(e);
	}
	function fireKitchen(tok) { addExprRecent({ t: 'ek', v: tok }); onInsertKitchen?.(tok); }
	function fireCe(em) {
		if (em?.shortcode) addExprRecent({ t: 'ce', v: { shortcode: em.shortcode, url: em.url } });
		onInsertCustomEmoji?.(em);
	}
	function fireTg(it) {
		addExprRecent({ t: 'tg', v: { custom: !!it.custom, mode: it.mode, alt: it.alt, short: it.short, id: it.id, cp: it.cp } });
		onInsertTgEmoji?.(it);
	}
	function fireRecent(it) {
		if (it.t === 'emoji') fireEmoji(it.v);
		else if (it.t === 'ek') fireKitchen(it.v);
		else if (it.t === 'ce') fireCe(it.v);
		else if (it.t === 'tg') fireTg(it.v);
	}
	// Kitchen recents may be [ek:] tokens (chat) — render via the sprite URL.
	function ekThumb(tok) {
		const m = /\[ek:([a-z0-9]+):([0-9a-f-]+):([0-9a-f-]+)\]/i.exec(tok);
		return m ? ekTokenToUrl(m[1], m[2], m[3]) : tok;
	}
	let recents = $state([]);
	$effect(() => {
		if (tab === 'recent') recents = getExprRecents().filter((it) => it.t !== 'tg' || !tgHidden);
	});
</script>

<div class="expr-panel" class:expr-panel-react={mode === 'react'}>
	{#if mode === 'react'}
		<!-- Reaction mode: just the EmojiPicker, no chrome. The chat
		     pages used to mount a bare EmojiPicker for this; routing
		     through ExpressionPicker means recents + skin-tone +
		     popular-tab state are shared with the compose picker (via
		     EmojiPicker's own localStorage keys). -->
		<EmojiPicker onSelect={fireEmoji} {onClose} />
	{:else}
		<nav class="expr-tabs" aria-label="Expression categories">
		<button class="expr-tab" class:active={tab === 'recent'} onclick={() => (tab = 'recent')} title="Recently used">
			<span class="msi msi-20" class:msi-fill={tab === 'recent'}>history</span>
		</button>
		<!-- Order: emoji, telegram (animated), emoji kitchen, custom emotes -->
		<button class="expr-tab" class:active={tab === 'emoji'} onclick={() => (tab = 'emoji')} title="Emoji">
			<span class="msi msi-20" class:msi-fill={tab === 'emoji'}>mood</span>
		</button>
		{#if !tgHidden}
			<button class="expr-tab" class:active={tab === 'animated'} onclick={() => (tab = 'animated')} title="Animated stickers">
				<span class="msi msi-20" class:msi-fill={tab === 'animated'}>animated_images</span>
			</button>
		{/if}
		<button class="expr-tab" class:active={tab === 'kitchen'} onclick={() => (tab = 'kitchen')} title="Emoji Kitchen">
			<span class="msi msi-20" class:msi-fill={tab === 'kitchen'}>blender</span>
		</button>
		<button class="expr-tab" class:active={tab === 'emotes'} onclick={() => (tab = 'emotes')} title="Custom emotes">
			<span class="msi msi-20" class:msi-fill={tab === 'emotes'}>sentiment_very_satisfied</span>
		</button>
		{#if onBackspace}
			<!-- Backspace lives at the right end of the (bottom) category
			     strip — bottom-right corner of the picker, like a native
			     emoji keyboard's delete key. -->
			<button class="expr-tab expr-tab-back" onmousedown={(e) => { e.preventDefault(); onBackspace(); }} title="Delete" aria-label="Delete">
				<span class="msi msi-20">backspace</span>
			</button>
		{/if}
	</nav>

	<div class="expr-body">
		{#if tab === 'recent'}
			{#if !recents.length}
				<p class="expr-recent-empty">Emoji, emotes, mixes and stickers you use will show up here.</p>
			{:else}
				<div class="expr-recent-grid">
					{#each recents as it (exprRecentKey(it))}
						<button class="expr-recent-cell" onclick={() => fireRecent(it)}>
							{#if it.t === 'emoji'}
								<span class="expr-recent-emoji" class:er-noto={it.f === 'noto'} class:er-sys={it.f === 'system'}>{it.v}</span>
							{:else if it.t === 'ek'}
								<img src={ekThumb(it.v)} alt="" loading="lazy" />
							{:else if it.t === 'ce'}
								<img src={it.v.url} alt={it.v.shortcode} loading="lazy" />
							{:else if it.t === 'tg'}
								<!-- live cell on the inline-canvas Skottie pipeline (each
								     cell owns its own canvas — no stage host needed, so
								     it animates here just like in the TG panel; static
								     packs auto-rest on their thumb frame) -->
								<SpriteSticker
									cp={it.v.custom ? null : it.v.cp}
									short={it.v.custom ? it.v.short : null}
									id={it.v.custom ? it.v.id : null}
									size={34} loop={true} eager={true} title={it.v.alt || ''} />
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		{:else if tab === 'emoji'}
			<EmojiPicker onSelect={fireEmoji} {onClose} />
		{:else if tab === 'kitchen'}
			<EmojiKitchen onInsert={fireKitchen} {onClose} />
		{:else if tab === 'emotes'}
			<!-- Two sources, two sub-tabs. Uploaded = class custom
			     emotes (R2). Library = the static Telegram packs
			     (CrazyEmoji / MadEmoji2 / HeartEmoji) which don't
			     animate, so they belong here next to the rest of the
			     non-animated emotes rather than under Animated. -->
			{#if !tgHidden}
				<nav class="expr-subtabs" aria-label="Emote source">
					{#if onClose}
						<!-- close rides the sub-tab row at the LEFT — the same
						     PickerStickyBtn tile every other tab pins top-left -->
						<PickerStickyBtn square onclick={onClose} title="Close" label="Close picker">
							<span class="msi msi-20">close</span>
						</PickerStickyBtn>
					{/if}
					<button class="expr-subtab" class:active={emotesSub === 'uploaded'} onclick={() => (emotesSub = 'uploaded')}>Uploaded</button>
					<button class="expr-subtab" class:active={emotesSub === 'library'} onclick={() => (emotesSub = 'library')}>Library</button>
				</nav>
			{/if}
			{#if emotesSub === 'uploaded'}
				<!-- inner panels skip their own ✕ when the sub-tab row carries it -->
				<CustomEmojiPanel mode="emoji" onInsertEmoji={fireCe} onInsertReaction={_noop} {isInstructor} onClose={tgHidden ? onClose : null} />
			{:else}
				<TelegramEmojiPanel onInsert={fireTg} packFilter="static" onClose={null} />
			{/if}
		{:else if tab === 'animated'}
			<!-- Animated stickers only — static packs live in the
			     Emotes tab's Library sub-tab. -->
			<TelegramEmojiPanel onInsert={fireTg} packFilter="animated" {onClose} />
		{/if}
	</div>
	{/if}
</div>

<style>
	.expr-panel {
		display: flex;
		flex-direction: column;
		width: 340px;
		height: 440px;
		background: var(--paper);
		color: var(--ink);
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.13), 0 1.5px 4px rgba(0,0,0,0.07);
		overflow: hidden;
		position: relative;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
		font-size: 0.85rem;
	}

	/* Category strip docks to the bottom (native-keyboard layout); the
	   body fills the space above it. */
	.expr-body { order: 1; }
	.expr-tabs { order: 2; }

	@media (max-width: 640px) {
		.expr-panel {
			width: 100%;
			/* Fill the docked sheet exactly — its height is driven by the
			   chat page's --picker-h so the bar above stays flush. */
			height: 100%;
			border-radius: 14px 14px 0 0;
			box-shadow: 0 -4px 24px rgba(0,0,0,0.18);
		}
		/* Taller bottom section strip with soft, pill-shaped buttons (no hard
		   bottom-underline highlight). The buttons fill down to ~5px above the
		   sheet's safe-area edge. */
		.expr-tabs {
			gap: 0.35rem;
			/* The strip's grey background runs to the very bottom of the screen;
			   the safe-area inset is padding INSIDE it so the buttons clear the
			   home indicator while the grey fills behind it. */
			padding: 0.35rem 0.5rem calc(0.35rem + env(safe-area-inset-bottom, 0px));
			border-top: none;
			align-items: stretch;
		}
		.expr-tab {
			padding: 0;
			min-height: 3.7rem;
			border-radius: 16px;
			border-bottom: none;
		}
		.expr-tab.active { border-bottom-color: transparent; }
		.expr-tab .msi { font-size: 24px; }
		.expr-tab-back { padding: 0 0.6rem; min-height: 3.7rem; border-radius: 16px; }
	}

	/* Picker chrome — neutral `surface-container` background to match
	   the sidebar/bottom-nav family. The active tab still uses the
	   secondary pair so the chosen tab pops in the seed's colour. */
	.expr-tabs {
		display: flex;
		gap: 1px;
		/* Strip is at the bottom now — divider goes on top. */
		border-top: 1.5px solid var(--border);
		background: var(--md-sys-color-surface-container, var(--surface-2));
		flex-shrink: 0;
	}
	.expr-tab {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		border: none;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		border-bottom: 2px solid transparent;
	}
	.expr-tab.active {
		background: var(--md-sys-color-secondary-container, var(--paper));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
		border-bottom-color: var(--md-sys-color-secondary, var(--accent));
	}
	.expr-tab-back { flex: 0 0 auto; color: var(--muted-fg); padding: 0.5rem 0.85rem; }
	.expr-tab-back:hover { color: var(--ink); }
	.expr-tab:hover:not(.active) {
		background: color-mix(in srgb, var(--md-sys-color-on-surface, var(--ink)) 7%, transparent);
	}
	/* Neutral darkening overlay — same M3 state-layer pattern the
	   sidebar uses, so chromatic active never gets out-competed. */
	.expr-tab:hover:not(.active) {
		background: color-mix(in srgb,
			var(--md-sys-color-on-surface, var(--ink)) 7%,
			transparent);
	}

	/* `gif` glyph fills ~60% of its em box (letters only, no icon body),
	   so it reads small next to `mood`, `blender`, etc. at the same px
	   size. Bumping font-size compensates without affecting any other
	   icon. Variation axes (wght/FILL/etc.) inherit from .msi. */
	.gif-glyph { font-size: 30px; line-height: 1; }

	.expr-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }

	.expr-subtabs {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--border);
		background: var(--md-sys-color-surface-container, var(--surface-2));
		flex-shrink: 0;
	}
	.expr-subtab {
		padding: 0.25rem 0.7rem;
		border: 1px solid transparent;
		border-radius: 999px;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}
	.expr-subtab.active {
		background: var(--md-sys-color-secondary-container, var(--paper));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
		border-color: var(--md-sys-color-secondary, var(--border));
	}
	.expr-subtab:hover:not(.active) {
		background: color-mix(in srgb,
			var(--md-sys-color-on-surface, var(--ink)) 7%,
			transparent);
	}

	/* The inner pickers each manage their own width/height inside the
	   expr-body container. Reset their default panel chrome so they
	   blend into the unified shell instead of double-styling. The
	   Emoji Kitchen component uses `.kitchen-panel` (not
	   `.emoji-kitchen`) on its root, so it was sitting at its own
	   hard-coded 380px width inside the 340px picker shell and
	   overflowing the right edge — adding `.kitchen-panel` to the
	   reset list snaps it to the container. */
	.expr-body :global(.tg-panel),
	.expr-body :global(.emoji-picker),
	.expr-body :global(.emoji-kitchen),
	.expr-body :global(.kitchen-panel),
	.expr-body :global(.gif-picker),
	.expr-body :global(.custom-emoji-panel) {
		/* Reset each inner picker's standalone chrome so it reads as
		   the body of the ExpressionPicker shell, not a card-within-
		   a-card. width/height let the picker fill the body; the
		   visual chrome (border, radius, shadow, background) is
		   owned by the outer .expr-panel. */
		width: 100% !important;
		height: 100% !important;
		border: none !important;
		border-radius: 0 !important;
		box-shadow: none !important;
		background: transparent !important;
	}

	/* Recently used — one flat grid mixing every expression type */
	.expr-recent-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
		gap: 0.2rem;
		padding: 0.5rem;
		overflow-y: auto;
		height: 100%;
		align-content: start;
	}
	.expr-recent-cell {
		aspect-ratio: 1;
		display: flex; align-items: center; justify-content: center;
		background: none; border: none; border-radius: 8px;
		cursor: pointer; padding: 0.2rem; min-width: 0;
		transition: background 0.1s;
	}
	.expr-recent-cell:hover { background: var(--surface-2); }
	.expr-recent-cell img { width: 100%; height: 100%; object-fit: contain; }
	.expr-recent-emoji { font-size: 1.6rem; line-height: 1; }
	/* each emoji renders in the font it was SENT in, regardless of the
	   current global emoji-font setting */
	.expr-recent-emoji.er-noto { font-family: 'Noto Color Emoji', sans-serif; }
	.expr-recent-emoji.er-sys { font-family: 'Apple Color Emoji', 'Segoe UI Emoji', system-ui, sans-serif; }
	.expr-recent-empty {
		margin: 0; padding: 1.5rem 1rem; text-align: center;
		color: var(--muted-fg); font-size: 0.85rem;
	}
</style>
