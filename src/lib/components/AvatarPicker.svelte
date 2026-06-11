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

	function setExprToken(token) {
		if (!token) return;
		avatarKind = 'expr';
		avatarValue = token;
		photoFile = null;
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
		<Avatar {name} {uid} {avatarKind} {avatarValue} size={96} />
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
		<div class="ap-expr-backdrop" onclick={() => (showExpr = false)}></div>
		<div class="ap-expr-popover" use:popoverPos={{ anchor: exprBtnEl, side: 'bottom' }}>
			<ExpressionPicker
				inline={true}
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
	.ap-hint {
		font-size: 0.74rem;
		color: var(--md-sys-color-on-surface-variant, var(--muted-fg));
		text-align: center;
		max-width: 340px;
		margin: 0;
		line-height: 1.4;
	}
</style>
