// Smart positioning for floating popovers (expression pickers, color
// swatches, format menus, etc.).
//
// Usage as a Svelte action:
//
//   <button bind:this={trigger}>open</button>
//   {#if open}
//     <div use:popoverPos={{ anchor: trigger, side: 'bottom' }}>…</div>
//   {/if}
//
// Behaviour:
//   - Switches the popover to `position: fixed` so it can escape any
//     scrolling / clipping ancestor.
//   - Tries the preferred `side` (default 'bottom'); flips to the
//     opposite side if there isn't room on that side and there IS
//     room on the other.
//   - Vertically gaps from the trigger by `gap` (default 8px) so the
//     picker never overlaps the input it was opened from.
//   - Clamps horizontally to [margin, viewportWidth - popoverWidth -
//     margin] so the popover never spills off-screen.
//   - Re-positions on scroll, resize, mutation of the popover's
//     contents, and on every requestAnimationFrame for the duration
//     it's mounted so a tab swap inside the popover (which can change
//     its size) re-flows immediately.
//
// On mobile (<= 640px wide) the popover instead docks to the bottom
// of the viewport as a full-width sheet — same affordance the
// existing inline CSS sheets use, but driven from one place.

const MARGIN = 8;
const MOBILE_BREAKPOINT = 640;

export function popoverPos(node, options = {}) {
	const config = {
		anchor: null,
		side: 'bottom',     // 'top' | 'bottom'
		align: 'center',    // 'start' | 'center' | 'end'
		gap: 8,
		...options
	};

	let raf = 0;
	let ro;

	function isMobile() {
		return typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT;
	}

	function place() {
		const anchor = config.anchor;
		if (!anchor || !node.isConnected) return;

		// Mobile: anchor-agnostic bottom sheet.
		if (isMobile()) {
			Object.assign(node.style, {
				position: 'fixed',
				left: '0',
				right: '0',
				top: '',
				bottom: '0',
				width: '100%',
				maxWidth: '100%'
			});
			return;
		}

		// Force fixed positioning so we can ignore scrolling ancestors.
		// Reset width / right so we measure the natural popover size,
		// not whatever the mobile branch left behind.
		Object.assign(node.style, {
			position: 'fixed',
			width: '',
			right: '',
			maxWidth: ''
		});

		const a = anchor.getBoundingClientRect();
		const p = node.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		// Vertical side selection — preferred, with flip-on-overflow.
		const spaceBelow = vh - a.bottom - MARGIN;
		const spaceAbove = a.top - MARGIN;
		let side = config.side;
		if (side === 'bottom' && p.height > spaceBelow && spaceAbove > spaceBelow) side = 'top';
		else if (side === 'top' && p.height > spaceAbove && spaceBelow > spaceAbove) side = 'bottom';

		const top = side === 'bottom'
			? Math.min(a.bottom + config.gap, vh - p.height - MARGIN)
			: Math.max(a.top - p.height - config.gap, MARGIN);

		// Horizontal alignment + viewport clamping.
		let left;
		if (config.align === 'start') left = a.left;
		else if (config.align === 'end') left = a.right - p.width;
		else left = a.left + a.width / 2 - p.width / 2;
		left = Math.max(MARGIN, Math.min(left, vw - p.width - MARGIN));

		node.style.top = `${Math.max(MARGIN, top)}px`;
		node.style.left = `${left}px`;
		node.style.bottom = '';
	}

	function schedule() {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(place);
	}

	// Run after the popover's first paint so its measured size is real.
	schedule();

	// Re-flow on every layout-affecting event.
	window.addEventListener('scroll', schedule, { passive: true, capture: true });
	window.addEventListener('resize', schedule, { passive: true });
	if (typeof ResizeObserver !== 'undefined') {
		ro = new ResizeObserver(schedule);
		ro.observe(node);
		if (config.anchor) ro.observe(config.anchor);
	}

	return {
		update(next) {
			Object.assign(config, next ?? {});
			schedule();
		},
		destroy() {
			cancelAnimationFrame(raf);
			window.removeEventListener('scroll', schedule, true);
			window.removeEventListener('resize', schedule);
			ro?.disconnect();
		}
	};
}
