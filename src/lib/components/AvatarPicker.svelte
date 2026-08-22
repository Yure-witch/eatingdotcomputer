<script>
	/**
	 * Avatar picker used on /onboarding/profile and /app/profile/edit.
	 * Three modes — Generative (default, no input), Photo upload, and
	 * Expression (inline ExpressionPicker — no GIFs / reactions, only
	 * the inline tokens that render natively in an Avatar chip).
	 *
	 * Bindable props let the parent persist the choice into its form
	 * payload alongside name / pronouns / etc.:
	 *
	 *   avatarKind   — 'gen' | 'photo' | 'expr'
	 *   avatarValue  — null (gen) | photo URL (photo) | token (expr)
	 *   photoFile    — File object captured by the upload input, posted
	 *                  by the parent so the server can stream it to R2
	 *                  and persist the resulting public URL as
	 *                  avatarValue.
	 *
	 * The Avatar preview at the top of the picker reflects the current
	 * choice live so the user can see what they're picking.
	 */
	import Avatar from './Avatar.svelte';
	import ExpressionPicker from './ExpressionPicker.svelte';
	import { popoverPos } from '$lib/popover-pos.js';

	let {
		name = '',
		uid = '',
		avatarKind = $bindable('gen'),
		avatarValue = $bindable(null),
		photoFile = $bindable(null)
	} = $props();

	let showExpr = $state(false);
	// Trigger ref so the popover positions relative to the actual
	// "Pick expression" button (and flips above when there's no room
	// below, e.g. on the onboarding page where the picker would
	// otherwise drop off the bottom of the card).
	let exprBtnEl = $state(null);

	// While the picker is open, borrow the chat compose's body class: app.css
	// hides the bottom nav for it (`body.expr-picker-open .bottom-nav`), so
	// the picker isn't sharing the bottom of the screen with Home/Chat/…
	// exactly as when it docks in chat. No-op on pages without the nav
	// (onboarding, desktop). The effect cleanup also covers unmounting with
	// the picker still open.
	$effect(() => {
		if (typeof document === 'undefined') return;
		document.body.classList.toggle('expr-picker-open', showExpr);
		return () => document.body.classList.remove('expr-picker-open');
	});

	function pickGenerative() {
		avatarKind = 'gen';
		avatarValue = null;
		photoFile = null;
	}

	function onPhotoChange(e) {
		const f = e.currentTarget.files?.[0];
		if (!f) return;
		photoFile = f;
		avatarKind = 'photo';
		// Local object URL gives an instant preview; the parent's submit
		// path uploads the actual file and the server swaps the URL to
		// the R2 public URL on save.
		avatarValue = URL.createObjectURL(f);
	}

	// Tapping an expression PREVIEWS it; it isn't committed until you confirm
	// with the tick. Committing on first tap meant you couldn't compare options
	// or browse another tab without the picker closing on you.
	let pendingExpr = $state(null);
	// What the circle shows: the pending choice while the picker is open,
	// otherwise the saved avatar.
	const previewKind = $derived(pendingExpr ? 'expr' : avatarKind);
	const previewValue = $derived(pendingExpr ?? avatarValue);

	function setExprToken(token) {
		if (!token) return;
		pendingExpr = token;
	}

	function confirmExpr() {
		if (!pendingExpr) { showExpr = false; return; }
		avatarKind = 'expr';
		avatarValue = pendingExpr;
		photoFile = null;
		pendingExpr = null;
		showExpr = false;
	}

	function cancelExpr() {
		pendingExpr = null;
		showExpr = false;
	}

	function onEmoji(emoji)            { setExprToken(emoji); }
	function onKitchen(token)          { setExprToken(token); }
	function onCustomEmoji(emoji)      { setExprToken(`[ce:${emoji.shortcode}]`); }
	function onTgEmoji(it) {
		if (!it) return;
		if (it.custom) {
			if (it.mode === 'emoji') setExprToken(it.alt || '');
			else setExprToken(`[tgc:${it.short}:${it.id}]`);
		} else {
			setExprToken(`[tg:${it.cp}]`);
		}
	}
</script>

<div class="ap-wrap">
	<!-- Live preview reflects whichever kind is currently picked. -->
	<div class="ap-preview">
		<Avatar {name} {uid} avatarKind={previewKind} avatarValue={previewValue} size={96} />
		<!-- Confirm sits beside the preview, and only while the picker is open:
		     it's the thing you look at to decide, so the tick belongs next to it
		     rather than buried in the panel below. -->
		{#if showExpr}
			<button type="button" class="ap-confirm" onclick={confirmExpr}
				disabled={!pendingExpr}
				aria-label={pendingExpr ? 'Use this expression' : 'Pick an expression first'}
				title={pendingExpr ? 'Use this expression' : 'Pick an expression first'}>
				<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
					stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
			</button>
		{/if}
	</div>

	<div class="ap-actions">
		<button
			type="button"
			class="ap-btn"
			class:active={avatarKind === 'gen'}
			onclick={pickGenerative}
		>
			<span class="msi msi-18">auto_awesome</span>
			Generative
		</button>

		<label class="ap-btn" class:active={avatarKind === 'photo'}>
			<span class="msi msi-18">photo_camera</span>
			Upload photo
			<input type="file" accept="image/*" class="sr-only" onchange={onPhotoChange} />
		</label>

		<button
			bind:this={exprBtnEl}
			type="button"
			class="ap-btn"
			class:active={avatarKind === 'expr'}
			onclick={() => (showExpr = !showExpr)}
		>
			<span class="msi msi-18">mood</span>
			Pick expression
		</button>
	</div>

	{#if showExpr}
		<!-- inline=true hides GIFs + Reactions tabs — we only want
		     inline tokens that render natively in an Avatar chip. -->
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="ap-expr-backdrop" onclick={cancelExpr}></div>
		<div class="ap-expr-popover" use:popoverPos={{ anchor: exprBtnEl, side: 'bottom' }}>
			<ExpressionPicker
				inline={true}
				rememberTab={false}
				onSelectEmoji={onEmoji}
				onInsertKitchen={onKitchen}
				onInsertCustomEmoji={onCustomEmoji}
				onInsertTgEmoji={onTgEmoji}
			/>
		</div>
	{/if}

	<p class="ap-hint">
		{#if avatarKind === 'gen'}
			Your gradient is generated from your account ID and never changes — same image every time.
		{:else if avatarKind === 'photo'}
			Photo uploads are stored privately and shown wherever your avatar appears.
		{:else if avatarKind === 'expr'}
			Emoji + emote avatars animate everywhere they appear if they're animated.
		{/if}
	</p>
</div>

<style>
	.ap-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		position: relative;
	}
	.ap-preview {
		display: inline-flex;
		padding: 6px;
		border-radius: 14px;
		background: var(--md-sys-color-surface-container, var(--surface-2));
		border: 1px solid var(--md-sys-color-outline-variant, var(--border));
	}
	.ap-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		justify-content: center;
	}
	.ap-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.8rem;
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		background: var(--paper);
		color: var(--ink);
		border: 1.5px solid var(--md-sys-color-outline-variant, var(--border));
		border-radius: 999px;
		cursor: pointer;
		transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
	}
	.ap-btn:hover { border-color: var(--ink); }
	.ap-btn.active {
		background: var(--md-sys-color-secondary-container, var(--paper));
		color: var(--md-sys-color-on-secondary-container, var(--ink));
		border-color: var(--md-sys-color-secondary, var(--accent));
	}
	.sr-only {
		position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
		overflow: hidden; clip: rect(0,0,0,0); border: 0;
	}
	.ap-expr-backdrop {
		position: fixed; inset: 0; background: transparent; z-index: 998;
	}
	/* Position owned by popoverPos action — it flips above / below
	   relative to the trigger and clamps the popover inside the
	   viewport so it never spills off the right edge or under the
	   onboarding card's bottom bound. Only visual chrome here. */
	.ap-expr-popover {
		z-index: 999;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
		border-radius: 12px;
		overflow: hidden;
	}
	/* Cap the picker's height here. On mobile .expr-panel is height:100% so it
	   can fill the chat's docked sheet, but in this popover nothing bounds it
	   and it covered the avatar you're choosing. Shorter panel = the circle
	   above stays visible while you pick, so you can see what you're getting. */
	.ap-expr-popover :global(.expr-panel) {
		height: min(48vh, 420px);
		max-height: min(48vh, 420px);
	}
	/* The preview row centres the circle and hangs the tick off its right, so
	   the circle stays optically centred whether or not the tick is showing. */
	.ap-preview { position: relative; display: inline-flex; align-items: center; }
	.ap-confirm {
		position: absolute; left: calc(100% + 0.75rem);
		display: inline-flex; align-items: center; justify-content: center;
		width: 48px; height: 48px; flex-shrink: 0;
		border: none; border-radius: 50%;
		background: var(--md-sys-color-primary, var(--ink));
		color: var(--md-sys-color-on-primary, var(--paper));
		cursor: pointer;
		animation: ap-confirm-in 0.22s cubic-bezier(0.33, 1, 0.68, 1) both;
		transition: opacity 0.15s ease, transform 0.12s ease;
	}
	.ap-confirm:active { transform: scale(0.94); }
	.ap-confirm:disabled {
		opacity: 0.4; cursor: default;
		background: var(--md-sys-color-surface-container-high, rgba(0,0,0,0.08));
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
	}
	@keyframes ap-confirm-in { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: none; } }
	@media (prefers-reduced-motion: reduce) { .ap-confirm { animation: none; } }

	.ap-hint {
		font-size: 0.74rem;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
		text-align: center;
		max-width: 340px;
		margin: 0;
		line-height: 1.4;
	}
</style>
