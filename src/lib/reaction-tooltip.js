/**
 * Position a reaction chip's "who reacted" tooltip so it can never hang off
 * either edge of the screen.
 *
 * The tooltip is centred under its chip by CSS. That's fine in the middle of a
 * conversation and wrong at both ends: a chip near the left edge pushes it past
 * 0, and a chip near the right (or a tooltip listing several long names, since
 * it sets `white-space: nowrap`) pushes it past the viewport. So we measure and
 * clamp.
 *
 * Two things the previous version got wrong, both of which put it off-screen:
 *
 *  - It used the sidebar's WIDTH as the left bound. On mobile the sidebar is a
 *    drawer parked off-screen, still ~220px wide, so the bound landed a third of
 *    the way across a phone. Measuring its RIGHT edge instead means an
 *    off-screen drawer correctly contributes nothing.
 *  - With `max(leftBound, min(centred, rightBound - width))`, a tooltip wider
 *    than the space available has no valid position, and the outer max wins —
 *    pushing it off the RIGHT edge. Capping its width first means the clamp
 *    always has a solution.
 *
 * @param {MouseEvent | FocusEvent} e — from the chip's own mouseenter/focus
 */
export function positionReactionTooltip(e) {
	const chip = e.currentTarget;
	const tooltip = chip?.querySelector?.('.reaction-tooltip');
	if (!tooltip) return;

	// Reset so the CSS default is what we measure against.
	tooltip.style.left = '';
	tooltip.style.transform = '';
	tooltip.style.maxWidth = '';

	const chipRect = chip.getBoundingClientRect();
	const sidebar = document.querySelector('.global-sidebar');
	const sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 0;
	// Ignore a sidebar claiming more than half the screen — that's a drawer
	// mid-animation, not a layout the tooltip has to dodge.
	let leftBound = Math.max(8, Math.min(sidebarRight + 10, window.innerWidth / 2));
	let rightBound = window.innerWidth - 8;

	// The viewport is not the real boundary. This tooltip is position:absolute
	// inside the message list, and an ancestor with a non-visible overflow
	// CLIPS it — no z-index can escape that, which is why on desktop it was
	// being sliced off at the chat column's left edge rather than merely
	// overlapping it. Clamp to whatever actually clips us, so the tooltip is
	// positioned (and capped) inside the box it has to live in.
	for (let el = chip.parentElement; el; el = el.parentElement) {
		const cs = getComputedStyle(el);
		if (!/(auto|hidden|scroll|clip)/.test(cs.overflowX + ' ' + cs.overflowY)) continue;
		const r = el.getBoundingClientRect();
		if (r.width < 80) break; // a collapsed/off-screen ancestor tells us nothing
		leftBound = Math.max(leftBound, r.left + 4);
		rightBound = Math.min(rightBound, r.right - 4);
		break;
	}

	const avail = Math.max(140, rightBound - leftBound);
	tooltip.style.maxWidth = `${avail}px`;
	// Long name lists have to be allowed to wrap once they're capped, or the cap
	// just clips them.
	tooltip.style.whiteSpace = 'normal';

	const width = Math.min(tooltip.getBoundingClientRect().width, avail);
	const centred = chipRect.left + chipRect.width / 2 - width / 2;
	const left = Math.max(leftBound, Math.min(centred, rightBound - width));

	// CSS positions it relative to the chip, so convert back out of viewport space.
	tooltip.style.left = `${left - chipRect.left}px`;
	tooltip.style.transform = 'none';
}
