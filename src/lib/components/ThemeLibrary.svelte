<script>
	/*
	 * The design team's theme libraries (static/theme-library.json, built by
	 * scripts/build-theme-library.mjs): ~200 themes in ~140 groups of
	 * relatives. Every theme is its own chip and picks on its own; a group is
	 * only a shelf — "Dune" holds Dune · CMF, its two Energy sets, and the
	 * '26 colorways named after it.
	 *
	 * Loaded on mount rather than bundled. Chips preview the palette each
	 * theme resolves to in the current light/dark mode, like the presets.
	 */
	import { onMount } from 'svelte';
	import {
		themeStore,
		loadThemeLibrary,
		setLibraryTheme,
		previewRolesForLibrary
	} from '$lib/theme-store.js';

	let lib = $state(null);
	let failed = $state(false);
	let query = $state('');

	onMount(() => {
		loadThemeLibrary().then((d) => (lib = d), () => (failed = true));
	});

	const q = $derived(query.trim().toLowerCase());
	const shelves = $derived.by(() => {
		if (!lib) return [];
		const current = $themeStore;
		return lib.groups
			.map((g) => {
				const groupHit = !q || g.label.toLowerCase().includes(q);
				const themes = g.themes
					.map((id) => ({ id, ...lib.themes[id] }))
					.filter((t) => groupHit || t.name.toLowerCase().includes(q) || t.lib.toLowerCase().includes(q))
					.map((t) => ({ ...t, roles: previewRolesForLibrary(t.id, t, current) }));
				return { ...g, themes };
			})
			.filter((g) => g.themes.length);
	});
	const count = $derived(shelves.reduce((n, g) => n + g.themes.length, 0));
</script>

<div class="library">
	<div class="head">
		<span class="row-label">Library</span>
		<input
			type="search"
			placeholder="Search themes"
			bind:value={query}
			aria-label="Search theme library"
		/>
		{#if lib}<span class="count">{count}</span>{/if}
	</div>

	{#if failed}
		<p class="note">The theme library didn't load.</p>
	{:else if !lib}
		<p class="note">Loading themes…</p>
	{:else}
		<div class="shelves">
			{#each shelves as g (g.id)}
				<div class="shelf">
					<div class="shelf-label">{g.label}</div>
					<div class="chips">
						{#each g.themes as t (t.id)}
							<button
								type="button"
								class="chip"
								class:active={$themeStore.presetId === `lib:${t.id}`}
								style:--swatch={t.roles.primary}
								style:--swatch-2={t.roles.tertiary}
								style:--swatch-bg={t.roles.surface}
								onclick={() => setLibraryTheme(t.id, t)}
								title={`${t.name} — ${t.lib}`}
							>
								<span class="dot"></span>
								<span class="name">{t.name}</span>
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.library { display: grid; gap: 0.75rem; min-width: 0; }
	.head { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
	.row-label {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--md-sys-color-on-surface-variant, #6f655a);
	}
	input[type='search'] {
		flex: 1 1 auto;
		min-width: 0;
		max-width: 16rem;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.12));
		background: var(--md-sys-color-surface-container-low, transparent);
		color: var(--ink);
	}
	.count { font-size: 0.75rem; color: var(--md-sys-color-on-surface-variant, #6f655a); }
	.note { margin: 0; font-size: 0.85rem; color: var(--md-sys-color-on-surface-variant, #6f655a); }

	.shelves {
		display: grid;
		gap: 0.6rem;
		max-height: 28rem;
		overflow-y: auto;
		padding-right: 0.25rem;
	}
	.shelf {
		display: grid;
		grid-template-columns: 7.5rem minmax(0, 1fr);
		gap: 0.75rem;
		align-items: start;
	}
	.shelf-label {
		font-size: 0.8rem;
		font-weight: 600;
		padding-top: 0.35rem;
		overflow-wrap: anywhere;
	}
	.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; min-width: 0; }
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		max-width: 100%;
		padding: 0.3rem 0.65rem 0.3rem 0.4rem;
		border: 1px solid var(--md-sys-color-outline-variant, rgba(0,0,0,0.12));
		border-radius: 999px;
		background: var(--md-sys-color-surface, transparent);
		color: var(--ink);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
		transition: border-color 160ms ease, transform 120ms ease;
	}
	.chip:hover { transform: translateY(-1px); }
	.chip.active {
		border-color: var(--md-sys-color-primary, var(--accent));
		border-width: 2px;
		padding: calc(0.3rem - 1px) calc(0.65rem - 1px) calc(0.3rem - 1px) calc(0.4rem - 1px);
	}
	.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.dot {
		flex: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		/* Primary over tertiary on the theme's own surface. */
		background:
			radial-gradient(circle at 35% 50%, var(--swatch) 0 32%, transparent 33%),
			radial-gradient(circle at 68% 50%, var(--swatch-2) 0 30%, transparent 31%),
			var(--swatch-bg);
		box-shadow: 0 0 0 1px rgba(128,128,128,0.35);
	}

	@media (max-width: 640px) {
		.shelf { grid-template-columns: minmax(0, 1fr); gap: 0.3rem; }
		.shelf-label { padding-top: 0; }
		.shelves { max-height: none; overflow: visible; }
		input[type='search'] { max-width: none; }
	}
</style>
