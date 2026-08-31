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
	let liftId = $state(null);     // held-but-not-yet-moved, for the lift animation
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

	// The held row is NOT animated between slots — it is transform-positioned to
	// sit under the pointer continuously (see dragTo), so it never has a slot to
	// travel between. Animating it would mean sliding it toward the finger it is
	// already on, i.e. lag. Every other row FLIPs out of its way.
	//
	// Two earlier cuts got this wrong: the first switched FLIP off for the whole
	// list mid-drag, which made the others jump; the second left the held row in
	// the flow, so it teleported slot to slot while the rest slid.
	const flipMs = $derived(reduced ? 0 : 220);
	const dragFlipMs = $derived(reduced ? 0 : 160); // keeps up with a moving finger
	const flipFor = (id) => (dragId == null ? flipMs : id === dragId ? 0 : dragFlipMs);

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

	// ——— The held row follows the pointer ————————————————————————
	//
	// It is lifted out of the flow VISUALLY (a transform), not structurally, so
	// it stays under the finger at all times while the list re-slots underneath
	// it. `offsetTop` is the key: it reports LAYOUT position and ignores
	// transforms, so it still says where the row would sit if we let go — which
	// is exactly what the offset has to be measured against once the row has
	// been re-slotted mid-drag.
	let grabPageY = 0;    // pointer position when the drag started
	let grabTop = 0;      // the row's layout position at that moment
	let originOffset = 0; // page space → offsetTop space

	function beginDrag(id, pageY) {
		dragId = id;
		liftId = id;
		const el = rowEls[id];
		// Start from a clean slate: a half-finished settle from a previous drag
		// would otherwise be baked into this one's anchor.
		if (el) { el.style.transition = ''; el.style.transform = ''; }
		grabPageY = pageY;
		grabTop = el ? el.offsetTop : 0;
		// Everything below measures in offsetTop space; the pointer arrives in
		// page space. Captured here, with the row untransformed, so it's the
		// true layout offset between the two.
		originOffset = el ? (el.getBoundingClientRect().top + window.scrollY) - el.offsetTop : 0;
		dragTo(pageY);
		haptic('medium');
	}

	/**
	 * Put the held row under the pointer, wherever the list has re-slotted it.
	 *
	 * `slotTop` overrides the measured position for the one case that matters:
	 * immediately after a re-slot, when the DOM has not caught up yet and
	 * `offsetTop` would still report the slot the row just left.
	 */
	function dragTo(pageY, slotTop) {
		lastPageY = pageY;
		const el = rowEls[dragId];
		if (!el) return;
		const top = slotTop ?? el.offsetTop;
		// Where it should appear: where it started, plus how far the pointer has
		// travelled. Minus where the layout puts it.
		const dy = (pageY - grabPageY) + (grabTop - top);
		el.style.transform = `translateY(${dy}px) scale(1.03)`;
	}

	/**
	 * Re-slot the held row against the OTHER rows' midpoints.
	 *
	 * It can't be "whichever row contains the pointer" any more: the held row is
	 * transformed to sit under the pointer, so that test would always find the
	 * held row itself and nothing would ever move. Moving up, take the first row
	 * whose midpoint the pointer has passed; moving down, the last.
	 */
	function reorderTo(pageY) {
		const from = items.findIndex((o) => o.id === dragId);
		if (from < 0) return;
		// Midpoints from offsetTop, NOT getBoundingClientRect: the other rows are
		// usually mid-FLIP while you drag through them, and a rect reports where
		// a row is being ANIMATED to sit, not where it actually sits. Hit-testing
		// against a moving target makes the swap point wander. offsetTop is
		// layout and ignores transforms entirely.
		const y = pageY - originOffset;
		let to = from;
		for (let i = 0; i < items.length; i++) {
			if (items[i].id === dragId) continue;
			const el = rowEls[items[i].id];
			if (!el) continue;
			const mid = el.offsetTop + el.offsetHeight / 2;
			if (i < from && y < mid) { to = i; break; }
			if (i > from && y > mid) { to = i; }
		}
		if (to === from) return null;

		// Work out where the held row will LAND, before the DOM knows. Every row
		// is still in place right now, so this is measurable; a moment from now
		// the answer would need a layout pass we haven't had yet.
		//
		// Moving up, it takes the target's slot outright. Moving down, the rows
		// it passed close up above it, so it lands at the target's slot shifted
		// by the difference in their heights (zero for uniform rows, correct for
		// a label that wrapped to two lines).
		const heldEl = rowEls[dragId];
		const targetEl = rowEls[items[to].id];
		let slotTop = null;
		if (heldEl && targetEl) {
			slotTop = to < from
				? targetEl.offsetTop
				: targetEl.offsetTop + targetEl.offsetHeight - heldEl.offsetHeight;
		}

		const next = [...items];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		apply(next);
		haptic('selection');
		return slotTop;
	}

	/**
	 * One step of a drag: re-slot, then re-anchor to the pointer.
	 *
	 * The re-anchor has to happen AFTER Svelte has re-slotted the row, because
	 * `dragTo` measures `offsetTop` to work out how far to translate — measure
	 * too early and the row anchors to the slot it just left and lands a full
	 * row off the finger.
	 *
	 * Done synchronously off a PREDICTED slot position rather than by waiting for
	 * the DOM (an `await tick()` or a rAF): the transform then lands in the same
	 * event as the move, so there is no frame in which the row is drawn against
	 * the wrong slot, and nothing that can leave a drag wedged if the flush or
	 * the frame never arrives.
	 */
	function dragStep(pageY) {
		const slotTop = reorderTo(pageY);
		dragTo(pageY, slotTop ?? undefined);
	}

	// Dragging to the end of a long list means dragging past the edge of the
	// screen; nudge the page along instead of stranding them.
	function edgeFrom(y) {
		const margin = 90;
		scrollDir = y < margin ? -1 : y > window.innerHeight - margin ? 1 : 0;
		if (scrollDir && !scrollRaf) scrollRaf = requestAnimationFrame(edgeScroll);
	}
	let lastPageY = 0;
	function edgeScroll() {
		scrollRaf = 0;
		if (dragId == null || !scrollDir) return;
		const before = window.scrollY;
		window.scrollBy(0, scrollDir * 9);
		// The finger hasn't moved, but the page under it has — so its position
		// in page coordinates has, and the held row has to follow or it drifts
		// away from the finger as the list scrolls.
		lastPageY += window.scrollY - before;
		dragStep(lastPageY);
		scrollRaf = requestAnimationFrame(edgeScroll);
	}

	function endDrag() {
		const id = dragId;
		const el = id != null ? rowEls[id] : null;
		if (el) {
			// Let go and it eases down into its slot rather than snapping — the
			// transform it's carrying is usually a few px off the resting spot.
			//
			// Both writes are SYNCHRONOUS and inline. Going through a Svelte
			// class plus a rAF meant the clear could simply never happen if the
			// frame never came, and the row kept its transform for good — which
			// then became the starting offset of the NEXT drag on that row.
			// Nothing here is allowed to depend on a frame arriving.
			el.style.transition = 'transform 0.18s cubic-bezier(0.22, 1, 0.36, 1)';
			el.style.transform = '';
			setTimeout(() => { el.style.transition = ''; }, 240);
		}
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
		e.currentTarget.setPointerCapture?.(e.pointerId);
		beginDrag(id, e.clientY + window.scrollY);
	}
	function onPointerMove(e) {
		if (dragId == null || e.pointerType !== 'mouse') return;
		e.preventDefault();
		const pageY = e.clientY + window.scrollY;
		dragStep(pageY);
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
			beginDrag(id, t.clientY + window.scrollY);
			return;
		}
		// Anything interactive on the row keeps its own tap.
		if (e.target?.closest?.('button')) return;
		pending = { id, x: t.clientX, y: t.clientY };
		liftId = id;
		pressTimer = setTimeout(() => {
			if (!pending) return;
			const p = pending;
			pending = null;
			beginDrag(p.id, p.y + window.scrollY);
		}, LONG_PRESS);
	}

	function touchMove(e) {
		if (dragId != null) {
			// Non-passive, so this actually stops the page moving.
			e.preventDefault();
			const t = e.touches[0];
			if (!t) return;
			const pageY = t.clientY + window.scrollY;
			dragStep(pageY);
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
			animate:flip={{ duration: flipFor(item.id), easing: cubicOut }}
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
		/* transform is written inline while dragging (it tracks the pointer), so
		   the transition here must be OFF or every move would ease toward the
		   finger instead of arriving with it. */
		transition: border-color 0.12s, box-shadow 0.16s, background 0.16s;
		position: relative; z-index: 2;
		will-change: transform;
	}
	/* The drop's ease-back is applied inline in endDrag — see the note there on
	   why it can't go through a class. */
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
