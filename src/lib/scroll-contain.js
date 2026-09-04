// Keep a wheel gesture inside a panel.
//
// `overscroll-behavior: contain` is already on every scrollable pane inside the
// expression picker, and it is not enough on its own. It only governs what
// happens once a SCROLLER reaches its end — it says nothing about a wheel event
// that never lands on a scroller in the first place. Most of an open picker is
// not scrollable: the tab bar, the search row, the floating category rail, the
// padding around the grid. A wheel there goes straight to the document, and the
// whole app scrolls out from under the popover the user is reading.
//
// So: on the panel root, decide for each wheel event whether anything inside
// can still consume it. If yes, let it through untouched. If not — the cursor
// is over chrome, or the grid is already at the end it is being pushed toward —
// cancel it, so the page never inherits the gesture.
//
// Deliberately only `wheel`. Touch scrolling on the same panels is handled by
// overscroll-behavior, which does work for touch, and cancelling touchmove here
// would fight the pickers' own horizontal pane swiping.

/**
 * Svelte action. Put it on the panel's root element.
 * @param {HTMLElement} node
 */
export function containScroll(node) {
	const onWheel = (e) => {
		// Pinch-zoom and horizontal gestures are not ours to cancel.
		if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

		for (let el = e.target; el && el !== node.parentElement; el = el.parentElement) {
			if (!(el instanceof Element)) break;
			if (el.scrollHeight <= el.clientHeight) continue;
			const overflowY = getComputedStyle(el).overflowY;
			if (overflowY !== 'auto' && overflowY !== 'scroll') continue;

			// A real scroller. Hand the event over only if it can still move in
			// the direction being asked for — otherwise it would bounce out to
			// the document, which is the whole bug.
			const atTop = el.scrollTop <= 0;
			const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
			if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return;
			break;
		}

		// Nothing in here wants it. Don't let the page have it either.
		e.preventDefault();
	};

	// Non-passive: the whole point is being able to call preventDefault.
	node.addEventListener('wheel', onWheel, { passive: false });
	return {
		destroy() {
			node.removeEventListener('wheel', onWheel);
		}
	};
}
