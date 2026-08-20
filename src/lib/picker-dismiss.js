// Dismissal wiring for the docked compose pickers, shared by the channel and
// DM chat pages so the two can't drift apart.
//
// The pickers used to sit under a full-screen `position: fixed; inset: 0`
// backdrop that existed only to catch an outside tap. That backdrop also ate
// every gesture aimed at the message list, so the chat was frozen behind an
// open picker — you couldn't scroll it, let alone have scrolling dismiss the
// picker. Here the backdrop is gone: an outside *tap* is detected on the
// window instead, which leaves the list fully interactive underneath.
//
// Scrolling is detected from `wheel` / `touchmove` on the list rather than
// from its `scroll` event, and that distinction matters: opening the picker
// shrinks the list and we compensate by writing `scrollTop` (see the chat
// pages' ResizeObserver). That write fires `scroll`, which would close the
// picker in the same frame it opened. `wheel` and `touchmove` only ever come
// from the user, so there is no feedback loop to guard against.

/**
 * @param {object} o
 * @param {HTMLElement|null} o.listEl        message list (the scroll container)
 * @param {() => void}       o.close         called once, on the first dismissing gesture
 * @param {string[]}         o.inside        selectors that count as "inside" for an outside-tap
 * @returns {() => void} cleanup
 */
export function installPickerDismiss({ listEl, close, inside = [] }) {
	if (typeof window === 'undefined') return () => {};

	let done = false;
	const fire = () => {
		if (done) return;
		done = true;
		close();
	};

	const onOutsidePointer = (e) => {
		const t = e.target;
		if (t && t.nodeType === 1 && inside.some((sel) => t.closest(sel))) return;
		fire();
	};

	// Capture phase: the picker's own controls stop propagation in places, and
	// an outside tap must be seen regardless of what the target does with it.
	window.addEventListener('pointerdown', onOutsidePointer, true);
	// `passive` — these never preventDefault, and saying so keeps the scroll
	// they accompany on the compositor.
	listEl?.addEventListener('wheel', fire, { passive: true });
	listEl?.addEventListener('touchmove', fire, { passive: true });

	return () => {
		window.removeEventListener('pointerdown', onOutsidePointer, true);
		listEl?.removeEventListener('wheel', fire);
		listEl?.removeEventListener('touchmove', fire);
	};
}

/**
 * Keep the content at the BOTTOM edge of a chat list pinned while the list's
 * own height changes — opening the picker shrinks the list by the sheet's
 * height, which would otherwise slide the newest messages out of sight behind
 * the sheet. Compensating `scrollTop` by the height delta keeps whatever you
 * were looking at exactly where it was, and (because max-scrollTop moves by
 * the same delta) still leaves a bottom-pinned list pinned to the bottom.
 *
 * Observing the element rather than reacting to the picker specifically means
 * the reply bar, attachment preview and keyboard all get the same treatment.
 *
 * The write is safe to make without suppressing the page's own scroll handler:
 * it moves scrollTop and clientHeight by the same amount, so the handler's
 * distance-from-bottom reading (and the `userScrolledUp` flag it drives) comes
 * out identical either way.
 *
 * @param {HTMLElement} listEl
 * @returns {() => void} cleanup
 */
export function keepScrollAnchored(listEl) {
	if (typeof ResizeObserver === 'undefined' || !listEl) return () => {};
	let prevH = listEl.clientHeight;
	const ro = new ResizeObserver(() => {
		const h = listEl.clientHeight;
		const delta = prevH - h;
		prevH = h;
		// Width-only changes (rotation, sidebar) report delta 0 and are skipped.
		if (!delta) return;
		listEl.scrollTop = Math.max(0, listEl.scrollTop + delta);
	});
	ro.observe(listEl);
	return () => ro.disconnect();
}
