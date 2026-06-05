<script>
	import { goto } from '$app/navigation';
	import { themeStore, PRESETS, setPreset, setDark } from '$lib/theme-store.js';

	let menuOpen = $state(false);
	let menuEl = $state(null);
	let triggerEl = $state(null);

	function toggleMenu() { menuOpen = !menuOpen; }
	function closeMenu() { menuOpen = false; }
	function openCustomTheme() {
		// Close the menu and route to the picker. Originally an <a href>,
		// but pairing onclick={closeMenu} with the navigation made the
		// anchor unreliable — the menu element unmounted during the same
		// tick the browser tried to follow the link, so the click looked
		// like it went nowhere. Programmatic goto avoids the race. The
		// picker now lives at /app/theme so it inherits the global
		// sidebar (desktop) + bottom nav (mobile) from /app/+layout
		// without needing its own AppHeader on top of the picker.
		menuOpen = false;
		goto('/app/theme');
	}

	function onWindowClick(e) {
		if (!menuOpen) return;
		if (menuEl?.contains(e.target) || triggerEl?.contains(e.target)) return;
		closeMenu();
	}

	function onKey(e) {
		if (e.key === 'Escape' && menuOpen) closeMenu();
	}

	function pick(id) {
		setPreset(id);
		closeMenu();
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKey} />

<div class="theme-switcher">
	<!-- Dark / light toggle -->
	<button
		type="button"
		class="icon-btn"
		title={$themeStore.dark ? 'Switch to light' : 'Switch to dark'}
		aria-label="Toggle dark mode"
		onclick={() => setDark(!$themeStore.dark)}
	>
		{#if $themeStore.dark}
			<!-- Sun -->
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="4"/>
				<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
			</svg>
		{:else}
			<!-- Moon -->
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
				<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
			</svg>
		{/if}
	</button>

	<!-- Color preset trigger -->
	<button
		type="button"
		bind:this={triggerEl}
		class="swatch-btn"
		title="Color theme"
		aria-haspopup="menu"
		aria-expanded={menuOpen}
		onclick={toggleMenu}
	>
		<span class="swatch-dot" style:background={$themeStore.seed}></span>
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<polyline points="6 9 12 15 18 9"/>
		</svg>
	</button>

	{#if menuOpen}
		<div bind:this={menuEl} class="menu" role="menu">
			<div class="menu-section-title">Theme</div>
			{#each PRESETS as p}
				<!-- Same emoji-only convention as the full theme picker:
				     Default keeps its written name; every other entry
				     shows just the emoji. Full name still surfaces via
				     `title` + `aria-label` for accessibility. -->
				<button
					type="button"
					class="menu-item"
					class:active={$themeStore.presetId === p.id}
					onclick={() => pick(p.id)}
					role="menuitemradio"
					aria-checked={$themeStore.presetId === p.id}
					title={p.name}
					aria-label={p.name}
				>
					<span class="menu-dot" style:background={p.seed}></span>
					<span class="menu-emoji">{p.emoji}</span>
					{#if p.id === 'default'}
						<span class="menu-name">{p.name}</span>
					{:else}
						<!-- Spacer keeps the active-check aligned to the
						     right edge consistently across rows even when
						     there's no written label. -->
						<span class="menu-name" aria-hidden="true"></span>
					{/if}
					{#if $themeStore.presetId === p.id}
						<svg class="menu-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="20 6 9 17 4 12"/>
						</svg>
					{/if}
				</button>
			{/each}
			<button type="button" class="menu-footer" onclick={openCustomTheme}>
				Custom theme →
			</button>
		</div>
	{/if}
</div>

<style>
	.theme-switcher {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		position: relative;
	}
	.icon-btn,
	.swatch-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		height: 32px;
		padding: 0 0.5rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.12));
		border-radius: 10px;
		background: transparent;
		color: var(--ink);
		cursor: pointer;
		font: inherit;
		transition: background 140ms ease, border-color 140ms ease;
	}
	.icon-btn { width: 32px; padding: 0; }
	.icon-btn:hover,
	.swatch-btn:hover {
		background: var(--md-sys-color-surface-variant, rgba(0,0,0,0.04));
	}
	.swatch-dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12);
	}

	.menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		min-width: 200px;
		padding: 6px;
		background: var(--md-sys-color-surface, var(--paper));
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.08));
		border-radius: 12px;
		box-shadow: 0 8px 24px rgba(0,0,0,0.12);
		z-index: 100;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.menu-section-title {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		padding: 4px 8px 6px;
	}
	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 6px 8px;
		border: none;
		background: transparent;
		border-radius: 8px;
		font: inherit;
		font-size: 0.85rem;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.menu-item:hover { background: var(--md-sys-color-surface-variant, rgba(0,0,0,0.04)); }
	.menu-item.active { background: var(--md-sys-color-primary-container, rgba(0,0,0,0.06)); }
	.menu-dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12);
		flex-shrink: 0;
	}
	.menu-emoji { font-size: 0.95rem; }
	.menu-name { flex: 1; }
	.menu-check { color: var(--md-sys-color-primary, var(--accent)); flex-shrink: 0; }

	.menu-footer {
		/* Originally an <a>; now a <button> for reliable navigation via
		   programmatic goto(). Reset the button defaults that would
		   otherwise show through. */
		appearance: none;
		-webkit-appearance: none;
		border: none;
		background: transparent;
		font: inherit;
		text-align: left;
		cursor: pointer;
		width: 100%;
		margin-top: 4px;
		padding: 7px 8px;
		font-size: 0.78rem;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
		border-top: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.08));
		text-decoration: none;
		border-radius: 0 0 8px 8px;
	}
	.menu-footer:hover { background: var(--md-sys-color-surface-variant, rgba(0,0,0,0.04)); }
</style>
