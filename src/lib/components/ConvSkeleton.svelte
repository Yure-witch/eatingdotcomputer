<script>
	/**
	 * Conversation placeholder — mirrors the real message list + compose bar so
	 * the chat appears instantly (and stays put) from tap → load → live. Mobile
	 * only (fixed overlay below the global header); renders nothing on desktop.
	 *
	 * `slide` plays an enter animation from the left (the conversation sits left
	 * of the menu in the swipe model), so opening a chat reads as a screen
	 * sliding in rather than popping in. The follow-on (Firebase-connect)
	 * skeleton renders static so it lands exactly where the slide ended.
	 */
	let { slide = false } = $props();
</script>

<div class="conv-skel" class:slide aria-hidden="true">
	<div class="cs-list">
		<div class="cs-row"><div class="cs-bubble" style:width="58%"></div></div>
		<div class="cs-row mine"><div class="cs-bubble" style:width="44%"></div></div>
		<div class="cs-row"><div class="cs-bubble cs-tall" style:width="72%"></div></div>
		<div class="cs-row"><div class="cs-bubble" style:width="36%"></div></div>
		<div class="cs-row mine"><div class="cs-bubble cs-tall" style:width="64%"></div></div>
		<div class="cs-row"><div class="cs-bubble" style:width="50%"></div></div>
		<div class="cs-row mine"><div class="cs-bubble" style:width="40%"></div></div>
		<div class="cs-row"><div class="cs-bubble" style:width="66%"></div></div>
	</div>
	<div class="cs-inputbar">
		<div class="cs-compose">
			<div class="cs-field"></div>
			<div class="cs-toolbar">
				{#each Array(6) as _}<span class="cs-tool"></span>{/each}
			</div>
		</div>
		<div class="cs-send"></div>
	</div>
</div>

<style>
	.conv-skel { display: none; }

	@media (max-width: 640px) {
		.conv-skel {
			position: fixed;
			top: var(--header-h, 52px);
			left: 0; right: 0; bottom: 0;
			background: var(--paper);
			z-index: 1100;
			display: flex;
			flex-direction: column;
			pointer-events: none;
		}
		/* Slide in from the left like a pushed screen. */
		.conv-skel.slide {
			animation: cs-slide-in 0.24s cubic-bezier(0.33, 1, 0.68, 1) both;
			box-shadow: -10px 0 28px rgba(0, 0, 0, 0.16);
		}
		@keyframes cs-slide-in {
			from { transform: translateX(-100%); }
			to { transform: translateX(0); }
		}
		.cs-list {
			flex: 1;
			display: flex;
			flex-direction: column;
			gap: 0.15rem;
			padding: 0.75rem 0.875rem;
			justify-content: flex-end;
			overflow: hidden;
		}
		.cs-row { display: flex; }
		.cs-row.mine { justify-content: flex-end; }
		.cs-bubble {
			height: 2.2rem;
			max-width: 88%;
			border-radius: 14px;
			background: var(--surface-2, rgba(0,0,0,0.06));
			animation: cs-pulse 1.3s ease-in-out infinite;
		}
		.cs-bubble.cs-tall { height: 3.5rem; }
		.cs-row.mine .cs-bubble {
			background: color-mix(in srgb, var(--accent) 16%, var(--paper));
		}
		.cs-inputbar {
			flex-shrink: 0;
			display: flex;
			align-items: flex-end;
			gap: 0.5rem;
			padding: 0.4rem 0.875rem calc(0.6rem + env(safe-area-inset-bottom, 0px));
		}
		.cs-compose {
			flex: 1;
			min-width: 0;
			border: 1.5px solid var(--border);
			border-radius: 12px;
			background: var(--paper);
			padding: 0.5rem 0.6rem;
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
		}
		.cs-field {
			height: 1rem; width: 45%;
			border-radius: 6px;
			background: var(--surface-2, rgba(0,0,0,0.06));
		}
		.cs-toolbar { display: flex; gap: 0.55rem; }
		.cs-tool {
			width: 1.2rem; height: 1.2rem;
			border-radius: 50%;
			background: var(--surface-2, rgba(0,0,0,0.06));
		}
		.cs-send {
			flex-shrink: 0;
			width: 3.2rem; height: 2.5rem;
			border-radius: 12px;
			background: color-mix(in srgb, var(--accent) 28%, var(--paper));
		}
		@keyframes cs-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
	}
</style>
