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
	import GifPicker from './GifPicker.svelte';
	import CustomEmojiPanel from './CustomEmojiPanel.svelte';
	import TelegramEmojiPanel from './TelegramEmojiPanel.svelte';

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
		inline = false
	} = $props();

	// Top-level tab. Persisted so reopening the picker lands on the
	// last category the user was using. In inline mode the GIFs and
	// Reactions tabs are hidden — if the persisted choice was one of
	// those, fall back to emoji so the picker doesn't open on an
	// invisible tab.
	const TAB_KEY = 'exprTab';
	const VALID_TABS = new Set(['emoji', 'kitchen', 'gifs', 'emotes', 'animated', 'reactions']);
	const INLINE_HIDDEN_TABS = new Set(['gifs', 'reactions']);
	const _saved = typeof localStorage !== 'undefined' ? localStorage.getItem(TAB_KEY) : null;
	const _initialTab = VALID_TABS.has(_saved)
		? (inline && INLINE_HIDDEN_TABS.has(_saved) ? 'emoji' : _saved)
		: 'emoji';
	let tab = $state(_initialTab);
	$effect(() => {
		// Don't persist inline-only fallbacks; the chat usage owns the
		// shared exprTab key, so an inline switch shouldn't change
		// what compose opens on next time.
		if (inline && INLINE_HIDDEN_TABS.has(tab)) return;
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
	let emotesSub = $state(_savedSub === 'library' ? 'library' : 'uploaded');
	$effect(() => {
		try { localStorage.setItem(EMOTES_SUB_KEY, emotesSub); } catch {}
	});

	// Reactions tab only handles reactions; pass a no-op for emoji
	// insertion. CustomEmojiPanel hides the unused side via `mode`.
	const _noop = () => {};
</script>

<div class="expr-panel" class:expr-panel-react={mode === 'react'}>
	{#if mode === 'react'}
		<!-- Reaction mode: just the EmojiPicker, no chrome. The chat
		     pages used to mount a bare EmojiPicker for this; routing
		     through ExpressionPicker means recents + skin-tone +
		     popular-tab state are shared with the compose picker (via
		     EmojiPicker's own localStorage keys). -->
		<EmojiPicker onSelect={onSelectEmoji} />
	{:else}
	<nav class="expr-tabs" aria-label="Expression categories">
		<button class="expr-tab" class:active={tab === 'emoji'} onclick={() => (tab = 'emoji')} title="Emoji">
			<span class="msi msi-20" class:msi-fill={tab === 'emoji'}>mood</span>
		</button>
		<button class="expr-tab" class:active={tab === 'kitchen'} onclick={() => (tab = 'kitchen')} title="Emoji Kitchen">
			<span class="msi msi-20" class:msi-fill={tab === 'kitchen'}>blender</span>
		</button>
		{#if !inline}
			<!-- GIFs and Reactions are hidden in inline mode (assignment
			     text fields, etc.) — they always insert full-size
			     attachments which don't make sense outside a chat
			     compose. -->
			<button class="expr-tab" class:active={tab === 'gifs'} onclick={() => (tab = 'gifs')} title="GIFs">
				<!-- `gif` is letters in a tight bounding box, so the glyph
				     renders ~60% the optical size of icons at the same px
				     value. Bumping font-size to ~30px makes the letters
				     match the visual weight of `mood`, `blender`, etc.
				     Variation axes still come from the .msi class. -->
				<span class="msi gif-glyph" class:msi-fill={tab === 'gifs'}>gif</span>
			</button>
		{/if}
		<button class="expr-tab" class:active={tab === 'emotes'} onclick={() => (tab = 'emotes')} title="Custom emotes">
			<span class="msi msi-20" class:msi-fill={tab === 'emotes'}>sentiment_very_satisfied</span>
		</button>
		<button class="expr-tab" class:active={tab === 'animated'} onclick={() => (tab = 'animated')} title="Animated stickers">
			<span class="msi msi-20" class:msi-fill={tab === 'animated'}>animated_images</span>
		</button>
		{#if !inline}
			<button class="expr-tab" class:active={tab === 'reactions'} onclick={() => (tab = 'reactions')} title="Reactions">
				<span class="msi msi-20" class:msi-fill={tab === 'reactions'}>favorite</span>
			</button>
		{/if}
	</nav>

	<div class="expr-body">
		{#if tab === 'emoji'}
			<EmojiPicker onSelect={onSelectEmoji} />
		{:else if tab === 'kitchen'}
			<EmojiKitchen onInsert={onInsertKitchen} />
		{:else if tab === 'gifs' && !inline}
			<GifPicker onSelect={onSelectGif} />
		{:else if tab === 'emotes'}
			<!-- Two sources, two sub-tabs. Uploaded = class custom
			     emotes (R2). Library = the static Telegram packs
			     (CrazyEmoji / MadEmoji2 / HeartEmoji) which don't
			     animate, so they belong here next to the rest of the
			     non-animated emotes rather than under Animated. -->
			<nav class="expr-subtabs" aria-label="Emote source">
				<button class="expr-subtab" class:active={emotesSub === 'uploaded'} onclick={() => (emotesSub = 'uploaded')}>Uploaded</button>
				<button class="expr-subtab" class:active={emotesSub === 'library'} onclick={() => (emotesSub = 'library')}>Library</button>
			</nav>
			{#if emotesSub === 'uploaded'}
				<CustomEmojiPanel mode="emoji" onInsertEmoji={onInsertCustomEmoji} onInsertReaction={_noop} {isInstructor} />
			{:else}
				<TelegramEmojiPanel onInsert={onInsertTgEmoji} packFilter="static" />
			{/if}
		{:else if tab === 'animated'}
			<!-- Animated stickers only — static packs live in the
			     Emotes tab's Library sub-tab. -->
			<TelegramEmojiPanel onInsert={onInsertTgEmoji} packFilter="animated" />
		{:else if tab === 'reactions' && !inline}
			<CustomEmojiPanel mode="reactions" onInsertEmoji={_noop} onInsertReaction={onInsertReaction} {isInstructor} />
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
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif;
		font-size: 0.85rem;
	}
	@media (max-width: 640px) {
		.expr-panel {
			width: 100%;
			height: 320px;
			border-radius: 14px 14px 0 0;
			box-shadow: 0 -4px 24px rgba(0,0,0,0.18);
		}
	}

	/* Picker chrome — neutral `surface-container` background to match
	   the sidebar/bottom-nav family. The active tab still uses the
	   secondary pair so the chosen tab pops in the seed's colour. */
	.expr-tabs {
		display: flex;
		gap: 1px;
		border-bottom: 1.5px solid var(--border);
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
		/* Full-ink icons for high contrast — the active state is signalled
		   by the filled glyph variant + the secondary-container pill +
		   secondary underline, not by dimming the inactive tabs. */
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
</style>
