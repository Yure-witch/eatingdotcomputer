<script>
	import RankList from './RankList.svelte';
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import { haptic } from '$lib/native.js';

	// Movement is animated with FLIP only — deliberately NOT a crossfade
	// between the pool and the two lists.
	//
	// A crossfade flies an absolutely-positioned CLONE between the lists, and
	// if that animation never finishes it leaves the row stranded at opacity 0
	// — which is what a backgrounded tab, a phone locking mid-tap, or a
	// throttled rAF all produce. FLIP only ever animates an element from a
	// transform back to the position it already occupies, so an interrupted
	// one leaves a visible row in the right place. Same readable motion, and
	// the failure mode is "not animated" rather than "gone".

	// Pick your favorites and your least favorites out of a pool, and rank each
	// end. Shared by the signed-in poll page and the public QR page.
	//
	// Picking is by BUTTON, not by dragging between three zones. Cross-zone
	// dragging on a phone is a coin flip — you're aiming at a target that moves
	// as the lists resize — whereas a tap always lands. Dragging still does what
	// it's good at: ordering within a list you've already chosen.

	let {
		items = [],                       // the whole pool
		favItems = $bindable([]),
		leastItems = $bindable([]),
		minFav = 3,
		minLeast = 3,
		disabled = false,
		onchange = () => {},
		// Write-ins. `onadd` returns a promise so the field can show its own
		// error; `onremoveItem`, when given (instructor), puts an × on pool
		// entries so junk suggestions can be cleared out.
		canAdd = false,
		onadd = null,
		onremoveItem = null
	} = $props();

	let draft = $state('');
	let adding = $state(false);
	let addError = $state('');

	async function addOwn() {
		const label = draft.trim();
		if (!label || adding || !onadd) return;
		adding = true;
		addError = '';
		try {
			await onadd(label);
			draft = '';
		} catch (e) {
			addError = e?.message || 'That did not go in';
		} finally {
			adding = false;
		}
	}

	const chosen = $derived(new Set([...favItems, ...leastItems].map((i) => i.id)));
	const pool = $derived(items.filter((i) => !chosen.has(i.id)));

	const favMet = $derived(favItems.length >= minFav);
	const leastMet = $derived(leastItems.length >= minLeast);

	// `chosen` guard, not just `disabled`. Two taps landing on the same pick
	// button before the list re-renders would add the item twice and blow up
	// the keyed each with each_key_duplicate — and double-tapping a small
	// target is exactly what a phone invites. (Found the hard way: an earlier
	// crossfade kept the leaving row in the DOM long enough to make this easy
	// to hit.)
	function addFav(item) {
		if (disabled || chosen.has(item.id)) return;
		favItems = [...favItems, item];
		onchange();
		haptic('light');
	}
	function addLeast(item) {
		if (disabled || chosen.has(item.id)) return;
		leastItems = [...leastItems, item];
		onchange();
		haptic('light');
	}
	function dropFav(item) {
		favItems = favItems.filter((x) => x.id !== item.id);
		onchange();
		haptic('light');
	}
	function dropLeast(item) {
		leastItems = leastItems.filter((x) => x.id !== item.id);
		onchange();
		haptic('light');
	}
</script>

<section class="picker">
	<div class="pool-head">
		<h3>The pool</h3>
		<span class="pool-count">{pool.length} left</span>
	</div>
	{#if pool.length}
		<ul class="pool">
			{#each pool as item (item.id)}
				<li animate:flip={{ duration: 220, easing: cubicOut }}>
					<span class="label">
						{item.label}
						{#if item.addedByName}<span class="by">added by {item.addedByName}</span>{/if}
					</span>
					<span class="picks">
						{#if onremoveItem && item.addedBy}
							<button class="bin" onclick={() => onremoveItem(item)} aria-label="Remove {item.label} from the pool">
								<span class="msi">delete</span>
							</button>
						{/if}
						<button class="pick fav" onclick={() => addFav(item)} disabled={disabled} aria-label="Add {item.label} to favorites">
							<span class="msi">favorite</span>
						</button>
						<button class="pick least" onclick={() => addLeast(item)} disabled={disabled} aria-label="Add {item.label} to least favorites">
							<span class="msi">thumb_down</span>
						</button>
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">Everything's been picked.</p>
	{/if}

	{#if canAdd}
		<form class="add-own" onsubmit={(e) => { e.preventDefault(); addOwn(); }}>
			<input
				bind:value={draft}
				placeholder="Add your own"
				maxlength="200"
				disabled={disabled || adding}
				aria-label="Add your own thing to the pool"
			/>
			<button type="submit" disabled={disabled || adding || !draft.trim()}>
				{adding ? 'Adding…' : 'Add'}
			</button>
		</form>
		{#if addError}<p class="add-error">{addError}</p>{/if}
	{/if}

	<div class="bucket">
		<div class="bucket-head">
			<h3>Your favorites</h3>
			<span class="tally" class:met={favMet}>
				{favItems.length} of {minFav} minimum{#if favMet}<span class="msi tick">check</span>{/if}
			</span>
		</div>
		{#if favItems.length}
			<p class="order-hint">Best first — drag or use the arrows.</p>
			<RankList bind:items={favItems} {disabled} {onchange} onremove={dropFav} />
		{:else}
			<p class="empty">Tap <span class="msi inline">favorite</span> on at least {minFav} things above.</p>
		{/if}
	</div>

	<div class="bucket">
		<div class="bucket-head">
			<h3>Your least favorites</h3>
			<span class="tally" class:met={leastMet}>
				{leastItems.length} of {minLeast} minimum{#if leastMet}<span class="msi tick">check</span>{/if}
			</span>
		</div>
		{#if leastItems.length}
			<!-- Worst first, so the top of each list is always "the strongest
			     feeling" rather than one list reading inwards and one outwards. -->
			<p class="order-hint">Worst first — drag or use the arrows.</p>
			<RankList bind:items={leastItems} {disabled} {onchange} onremove={dropLeast} />
		{:else}
			<p class="empty">Tap <span class="msi inline">thumb_down</span> on at least {minLeast} things above.</p>
		{/if}
	</div>
</section>

<style>
	.picker { display: flex; flex-direction: column; gap: 1.5rem; }
	h3 {
		font-family: 'Avara', serif; font-size: 0.95rem; font-weight: 400;
		margin: 0; color: var(--ink);
	}
	.pool-head, .bucket-head {
		display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.5rem;
	}
	.pool-head h3, .bucket-head h3 { flex: 1; }
	.pool-count { font-size: 0.75rem; color: var(--muted-fg); }
	.tally {
		display: inline-flex; align-items: center; gap: 0.2rem;
		font-size: 0.75rem; color: var(--muted-fg);
	}
	.tally.met { color: var(--accent); }
	.tick { font-size: 0.9rem; }

	.pool { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
	.pool li {
		display: flex; align-items: center; gap: 0.6rem;
		padding: 0.55rem 0.6rem 0.55rem 0.85rem;
		border: 1.5px solid var(--border); border-radius: 12px;
		background: var(--md-sys-color-surface-container-low, var(--paper));
	}
	.label { flex: 1; font-size: 0.92rem; color: var(--ink); line-height: 1.35; }
	.picks { flex: none; display: flex; gap: 0.3rem; }
	.pick {
		display: inline-flex; align-items: center; justify-content: center;
		width: 2.1rem; height: 2.1rem; padding: 0;
		border: 1.5px solid var(--border); border-radius: 10px;
		background: transparent; color: var(--muted-fg); cursor: pointer;
		transition: border-color 0.12s, color 0.12s;
	}
	.pick .msi { font-size: 1.05rem; transition: transform 0.12s cubic-bezier(0.22, 1, 0.36, 1); }
	.pick:active { transform: scale(0.9); }
	.pick.fav:active { border-color: var(--accent); color: var(--accent); }
	.pick.least:active { border-color: var(--ink); color: var(--ink); }
	.pick.fav:hover { border-color: var(--accent); color: var(--accent); }
	.pick.least:hover { border-color: var(--md-sys-color-error, #b3261e); color: var(--md-sys-color-error, #b3261e); }
	.pick:disabled { opacity: 0.4; cursor: default; }

	.by { display: block; font-size: 0.7rem; color: var(--muted-fg); opacity: 0.8; margin-top: 0.1rem; }
	.add-own { display: flex; gap: 0.4rem; margin-top: 0.55rem; }
	.add-own input {
		flex: 1; min-width: 0; font-family: inherit; font-size: 0.88rem; color: var(--ink);
		background: var(--paper); border: 1.5px dashed var(--border); border-radius: 12px;
		padding: 0.55rem 0.7rem; box-sizing: border-box;
	}
	.add-own input:focus { outline: none; border-color: var(--accent); border-style: solid; }
	.add-own button {
		flex: none; font-family: inherit; font-size: 0.8rem; padding: 0 0.9rem;
		border: 1.5px solid var(--border); border-radius: 12px;
		background: transparent; color: var(--muted-fg); cursor: pointer;
	}
	.add-own button:not(:disabled):hover { border-color: var(--accent); color: var(--accent); }
	.add-own button:disabled { opacity: 0.45; cursor: default; }
	.add-error { font-size: 0.78rem; color: var(--md-sys-color-error, #b3261e); margin: 0.35rem 0 0; }
	.bin {
		display: inline-flex; align-items: center; justify-content: center;
		width: 2.1rem; height: 2.1rem; padding: 0;
		border: 1.5px solid transparent; border-radius: 10px;
		background: transparent; color: var(--muted-fg); cursor: pointer; opacity: 0.7;
	}
	.bin:hover { color: var(--md-sys-color-error, #b3261e); opacity: 1; }
	.bin .msi { font-size: 1rem; }

	.order-hint { font-size: 0.74rem; color: var(--muted-fg); margin: 0 0 0.5rem; }
	.empty {
		display: flex; align-items: center; justify-content: center; gap: 0.3rem; flex-wrap: wrap;
		font-size: 0.8rem; color: var(--muted-fg);
		padding: 1.1rem; border: 1.5px dashed var(--border); border-radius: 12px; margin: 0;
		text-align: center;
	}
	.inline { font-size: 0.95rem; vertical-align: -0.15em; }
</style>
