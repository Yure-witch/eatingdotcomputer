<script>
	import { flip } from 'svelte/animate';
	import { cubicOut } from 'svelte/easing';
	import { haptic } from '$lib/native.js';

	// A list you drag into order. Used by the signed-in poll page and by the
	// public QR page, which is why it owns the interaction and nothing else —
	// no fetching, no poll semantics, just `items` in, reordered `items` out.
	//
	// Rows stay in the flow and swap under the pointer rather than a lifted
	// ghost element, and every move is FLIPped, so a drag, an arrow tap and a
	// pick landing from the pool all animate the same way.

	let {
		items = $bindable([]),
		disabled = false,
		onchange = () => {},
		// `onremove`, when given, puts an × on each row — the favorites format
		// needs a way back to the pool, the full-list format has nowhere to put
		// things.
		onremove = null
	} = $props();

	let listEl = $state(null);
	let rowEls = {};
	let dragId = $state(null);
	let liftId = $state(null); // held-but-not-yet-moved, for the lift animation
	let scrollDir = 0;
	let scrollRaf = 0;

	let reduced = $state(false);
	$effect(() => {
		if (typeof matchMedia !== 'function') return;
		const mq = matchMedia('(prefers-reduced-motion: reduce)');
		reduced = mq.matches;
		const on = () => (reduced = mq.matches);
		mq.addEventListener?.('change', on);
		return () => mq.removeEventListener?.('change', on);
	});

	// No FLIP mid-drag: the rows are already following the finger, and animating
	// them as well makes the list feel like it's lagging behind the gesture.
	const flipMs = $derived(reduced || dragId != null ? 0 : 220);

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
		haptic('selection');
	}

	/** Move the dragged row to whatever row the pointer is currently over. */
	function reorderTo(y) {
		const from = items.findIndex((o) => o.id === dragId);
		if (from < 0) return;
		let to = from;
		for (let i = 0; i < items.length; i++) {
			const el = rowEls[items[i].id];
			if (!el) continue;
			const r = el.getBoundingClientRect();
			if (y >= r.top && y <= r.bottom) { to = i; break; }
		}
		if (to === from) return;
		const next = [...items];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		apply(next);
		haptic('selection');
	}

	// Dragging to the end of a long list means dragging past the edge of the
	// screen; nudge the page along instead of stranding them.
	function edgeFrom(y) {
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
		liftId = null;
		scrollDir = 0;
		if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
	}

	// ——— Mouse ————————————————————————————————————————————————————
	// A mouse can grab anywhere on the row: there's no scroll gesture to
	// compete with, so there's nothing to disambiguate.

	function onPointerDown(e, id) {
		if (disabled || e.pointerType !== 'mouse' || e.button !== 0) return;
		dragId = id;
		e.currentTarget.setPointerCapture?.(e.pointerId);
	}
	function onPointerMove(e) {
		if (dragId == null || e.pointerType !== 'mouse') return;
		e.preventDefault();
		reorderTo(e.clientY);
		edgeFrom(e.clientY);
	}

	// ——— Touch ———————————————————————————————————————————————————
	// A finger has to say whether it means "scroll the page" or "move this row",
	// and it can only say it by WAITING. So: hold a row still for a moment and
	// it lifts into a drag; move before that and it's a scroll, which is what a
	// flick down the page is. The handle skips the wait — it carries
	// `touch-action: none`, so a finger there was never going to scroll.
	//
	// The scroll is suppressed by preventDefault on a NON-PASSIVE touchmove,
	// which only works because the finger was stationary through the long
	// press: no scroll has begun yet, so there is still something to prevent.

	const LONG_PRESS = 200;
	const SLOP = 10; // px of movement that means "they meant to scroll"
	let pending = null;
	let pressTimer = 0;

	function touchStart(e, id) {
		if (disabled) return;
		const t = e.touches[0];
		if (!t) return;
		// The handle is an explicit "I want to drag" — no waiting.
		if (e.target?.closest?.('.handle')) {
			dragId = id;
			liftId = id;
			haptic('medium');
			return;
		}
		// Anything interactive on the row keeps its own tap.
		if (e.target?.closest?.('button')) return;
		pending = { id, x: t.clientX, y: t.clientY };
		liftId = id;
		pressTimer = setTimeout(() => {
			if (!pending) return;
			dragId = pending.id;
			pending = null;
			haptic('medium');
		}, LONG_PRESS);
	}

	function touchMove(e) {
		if (dragId != null) {
			// Non-passive, so this actually stops the page moving.
			e.preventDefault();
			const t = e.touches[0];
			if (!t) return;
			reorderTo(t.clientY);
			edgeFrom(t.clientY);
			return;
		}
		if (!pending) return;
		const t = e.touches[0];
		if (!t) return;
		if (Math.abs(t.clientY - pending.y) > SLOP || Math.abs(t.clientX - pending.x) > SLOP) {
			cancelPending(); // they're scrolling, not reordering
		}
	}

	function cancelPending() {
		clearTimeout(pressTimer);
		pending = null;
		if (dragId == null) liftId = null;
	}

	function touchEnd() {
		cancelPending();
		endDrag();
	}

	$effect(() => {
		if (!listEl) return;
		// Attached by hand rather than with an attribute: Svelte registers
		// touchmove as passive, and a passive listener cannot preventDefault —
		// which is the entire mechanism holding the page still during a drag.
		const opts = { passive: false };
		window.addEventListener('touchmove', touchMove, opts);
		window.addEventListener('touchend', touchEnd);
		window.addEventListener('touchcancel', touchEnd);
		return () => {
			window.removeEventListener('touchmove', touchMove, opts);
			window.removeEventListener('touchend', touchEnd);
			window.removeEventListener('touchcancel', touchEnd);
			clearTimeout(pressTimer);
		};
	});

	export function dragging() { return dragId != null; }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={endDrag} onpointercancel={endDrag} />

<ul class="rank-list" bind:this={listEl}>
	{#each items as item, i (item.id)}
		<li
			class="row"
			class:dragging={dragId === item.id}
			class:lifting={liftId === item.id && dragId !== item.id}
			class:disabled
			bind:this={rowEls[item.id]}
			animate:flip={{ duration: flipMs, easing: cubicOut }}
			onpointerdown={(e) => onPointerDown(e, item.id)}
			ontouchstart={(e) => touchStart(e, item.id)}
		>
			<span class="pos">{i + 1}</span>
			{#if !disabled}
				<span class="handle msi">drag_indicator</span>
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
		user-select: none; -webkit-user-select: none;
		/* Stops iOS putting a callout / text-selection bubble on the long press
		   that is now the gesture for picking a row up. */
		-webkit-touch-callout: none;
		transition: border-color 0.12s, box-shadow 0.16s, transform 0.16s, background 0.16s;
	}
	.row.lifting { transform: scale(0.985); }
	.row.dragging {
		border-color: var(--accent);
		box-shadow: 0 10px 26px -10px color-mix(in srgb, var(--ink) 55%, transparent);
		transform: scale(1.03);
		position: relative; z-index: 2;
	}
	.row.disabled { opacity: 0.75; }
	.pos {
		flex: none; width: 1.5rem; text-align: center;
		font-family: 'Avara', serif; font-size: 0.9rem; color: var(--muted-fg);
		font-variant-numeric: tabular-nums;
	}
	.handle {
		flex: none; color: var(--muted-fg); opacity: 0.7; cursor: grab;
		font-size: 1.15rem; touch-action: none; /* a finger here drags immediately */
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
		transition: color 0.12s, transform 0.12s;
	}
	.nudge button:disabled { opacity: 0.22; cursor: default; }
	.nudge button:not(:disabled):hover { color: var(--accent); opacity: 1; }
	.nudge button:not(:disabled):active { transform: scale(1.25); color: var(--accent); }
	.nudge .msi { font-size: 1.15rem; }

	@media (prefers-reduced-motion: reduce) {
		.row { transition: none; }
		.row.dragging, .row.lifting { transform: none; }
	}
</style>
