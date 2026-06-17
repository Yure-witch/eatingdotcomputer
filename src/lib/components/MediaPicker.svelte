<script>
	/**
	 * Standalone GIFs + Reaction Images picker — its own surface, separate from
	 * the expression/emote picker, opened from a dedicated compose entrypoint to
	 * the right of the expression button.
	 *
	 * Reaction images still flow through CustomEmojiPanel (mode="reactions"), so
	 * uploading one continues to feed the same custom-emote system it does today.
	 */
	import GifPicker from './GifPicker.svelte';
	import CustomEmojiPanel from './CustomEmojiPanel.svelte';

	let {
		onSelectGif,         // (gif) → insert a GIF
		onInsertReaction,    // (reaction) → insert a reaction image
		isInstructor = false,
		onClose = null
	} = $props();

	let tab = $state('gifs'); // 'gifs' | 'reactions'
	const _noop = () => {};
</script>

<div class="media-panel">
	<div class="media-body">
		{#if tab === 'gifs'}
			<GifPicker onSelect={onSelectGif} {onClose} />
		{:else}
			<CustomEmojiPanel mode="reactions" onInsertEmoji={_noop} onInsertReaction={onInsertReaction} {isInstructor} {onClose} />
		{/if}
	</div>
	<nav class="media-tabs" aria-label="Media categories">
		<button class="media-tab" class:active={tab === 'gifs'} onclick={() => (tab = 'gifs')} title="GIFs">
			<span class="msi gif-glyph" class:msi-fill={tab === 'gifs'}>gif</span>
		</button>
		<button class="media-tab" class:active={tab === 'reactions'} onclick={() => (tab = 'reactions')} title="Reaction images">
			<span class="msi msi-20" class:msi-fill={tab === 'reactions'}>add_reaction</span>
		</button>
	</nav>
</div>

<style>
	/* Mirrors .expr-panel so the docking behaviour (desktop popover + mobile
	   bottom sheet) is identical to the expression picker. */
	.media-panel {
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
	.media-body { order: 1; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
	.media-tabs {
		order: 2;
		display: flex;
		gap: 1px;
		border-top: 1.5px solid var(--border);
		background: var(--md-sys-color-surface-container, var(--surface-2));
		flex-shrink: 0;
	}
	.media-tab {
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
	.media-tab.active {
		background: var(--md-sys-color-secondary-container, var(--paper));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
		border-bottom-color: var(--md-sys-color-secondary, var(--accent));
	}
	.media-tab:hover:not(.active) {
		background: color-mix(in srgb, var(--md-sys-color-on-surface, var(--ink)) 7%, transparent);
	}
	.gif-glyph { font-size: 30px; line-height: 1; }

	@media (max-width: 640px) {
		.media-panel {
			width: 100%;
			height: 100%;
			border-radius: 14px 14px 0 0;
			box-shadow: 0 -4px 24px rgba(0,0,0,0.18);
		}
		.media-tabs {
			gap: 0.35rem;
			padding: 0.35rem 0.5rem calc(0.35rem + env(safe-area-inset-bottom, 0px));
			border-top: none;
			align-items: stretch;
		}
		.media-tab {
			padding: 0;
			min-height: 3.7rem;
			border-radius: 16px;
			border-bottom: none;
		}
		.media-tab.active { border-bottom-color: transparent; }
		.media-tab .msi { font-size: 24px; }
		.media-tab .gif-glyph { font-size: 34px; }
	}
</style>
