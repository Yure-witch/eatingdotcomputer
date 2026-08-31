<script>
	// A list you drag into order. Used by the signed-in poll page and by the
	// public QR page, which is why it owns the interaction and nothing else —
	// no fetching, no poll semantics, just `items` in, reordered `items` out.
	//
	// Rows stay in the flow and swap under the pointer rather than a lifted
	// ghost element: fewer moving parts, and it behaves the same with a mouse,
	// a finger, and the arrow buttons — which are the accessible path and the
	// one that still works when a drag gets fiddly on a phone.

	// `onremove`, when given, puts an × on each row — the favorites format needs
	// a way back to the pool, the full-list format has nowhere to put things.
	let { items = $bindable([]), disabled = false, onchange = () => {}, onremove = null } = $props();

	let rowEls = {};
	let dragId = $state(null);
	let scrollDir = 0;
	let scrollRaf = 0;

	function apply(next) {
		items = next;
		onchange();
	}

	function move(id, delta) {
		if (disabled) return;
		const from = items.findIndex((o) => o.id === id);
		const to = from + delta;
		if (from < 0 || to < 0 || to >= items.length) return;
		const next = [...items];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		apply(next);
	}

	function onPointerDown(e, id) {
		if (disabled) return;
		// Touch drags start from the handle only (it carries touch-action:none);
		// a finger on the row body should still scroll the page.
		if (e.pointerType !== 'mouse' && !e.currentTarget.classList.contains('handle')) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		dragId = id;
		e.currentTarget.setPointerCapture?.(e.pointerId);
	}

	function onPointerMove(e) {
		if (dragId == null) return;
		e.preventDefault();
		const y = e.clientY;
		const from = items.findIndex((o) => o.id === dragId);
		let to = from;
		for (let i = 0; i < items.length; i++) {
			const el = rowEls[items[i].id];
			if (!el) continue;
			const r = el.getBoundingClientRect();
			if (y >= r.top && y <= r.bottom) { to = i; break; }
		}
		if (to !== from) {
			const next = [...items];
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);
			apply(next);
		}
		// Dragging to the end of a long list means dragging past the edge of the
		// screen; nudge the page along instead of stranding them.
		const margin = 90;
		scrollDir = y < margin ? -1 : y > window.innerHeight - margin ? 1 : 0;
		if (scrollDir && !scrollRaf) scrollRaf = requestAnimationFrame(edgeScroll);
	}

	function edgeScroll() {
		scrollRaf = 0;
		if (dragId == null || !scrollDir) return;
		window.scrollBy(0, scrollDir * 9);
		scrollRaf = requestAnimationFrame(edgeScroll);
	}

	function endDrag() {
		dragId = null;
		scrollDir = 0;
		if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
	}

	export function dragging() { return dragId != null; }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={endDrag} onpointercancel={endDrag} />

<ul class="rank-list">
	{#each items as item, i (item.id)}
		<li
			class="row"
			class:dragging={dragId === item.id}
			class:disabled
			bind:this={rowEls[item.id]}
			onpointerdown={(e) => onPointerDown(e, item.id)}
		>
			<span class="pos">{i + 1}</span>
			{#if !disabled}
				<span class="handle msi" onpointerdown={(e) => onPointerDown(e, item.id)}>drag_indicator</span>
			{/if}
			<span class="label">{item.label}</span>
			{#if onremove && !disabled}
				<button class="remove" aria-label="Take {item.label} off this list" onclick={() => onremove(item)}>
					<span class="msi">close</span>
				</button>
			{/if}
			{#if !disabled}
				<span class="nudge">
					<button aria-label="Move {item.label} up" disabled={i === 0} onclick={() => move(item.id, -1)}>
						<span class="msi">keyboard_arrow_up</span>
					</button>
					<button aria-label="Move {item.label} down" disabled={i === items.length - 1} onclick={() => move(item.id, 1)}>
						<span class="msi">keyboard_arrow_down</span>
					</button>
				</span>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.rank-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
	.row {
		display: flex; align-items: center; gap: 0.6rem;
		padding: 0.7rem 0.75rem;
		border: 1.5px solid var(--border); border-radius: 12px;
		background: var(--md-sys-color-surface-container-low, var(--paper));
		user-select: none;
		transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s;
	}
	.row.dragging {
		border-color: var(--accent);
		box-shadow: 0 8px 22px -10px color-mix(in srgb, var(--ink) 45%, transparent);
		transform: scale(1.012);
	}
	.row.disabled { opacity: 0.75; }
	.pos {
		flex: none; width: 1.5rem; text-align: center;
		font-family: 'Avara', serif; font-size: 0.9rem; color: var(--muted-fg);
	}
	.handle {
		flex: none; color: var(--muted-fg); opacity: 0.7; cursor: grab;
		font-size: 1.15rem; touch-action: none; /* a finger here drags, it doesn't scroll */
	}
	.row.dragging .handle { cursor: grabbing; }
	.label { flex: 1; font-size: 0.95rem; color: var(--ink); line-height: 1.35; }
	.remove {
		flex: none; border: none; background: transparent; color: var(--muted-fg);
		cursor: pointer; padding: 0.15rem; line-height: 0; opacity: 0.6;
	}
	.remove:hover { color: var(--md-sys-color-error, #b3261e); opacity: 1; }
	.remove .msi { font-size: 1.05rem; }
	.nudge { flex: none; display: flex; flex-direction: column; }
	.nudge button {
		border: none; background: transparent; color: var(--muted-fg);
		cursor: pointer; padding: 0; line-height: 0.9; opacity: 0.75;
	}
	.nudge button:disabled { opacity: 0.22; cursor: default; }
	.nudge button:not(:disabled):hover { color: var(--accent); opacity: 1; }
	.nudge .msi { font-size: 1.15rem; }
</style>
