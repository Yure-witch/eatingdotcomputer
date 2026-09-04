// Searching inside a docked picker.
//
// Every expression / media picker docks exactly where the on-screen keyboard
// would be — that's the whole point of --kb-h-last (see keyboard-metrics.js).
// But the pickers have search fields of their own ("Search emoji…", the emote
// library, GIFs), and focusing one brings the REAL keyboard up ON TOP of the
// sheet: you get the field and a sliver of results, with everything you're
// typing for buried under the keys.
//
// This action flags that state on <html> as `expr-search-kb`; app.css lifts
// the sheet (and, in chat, the compose bar riding above it) by --kb-h so the
// picker sits ON the keyboard the way the compose bar does when you type
// normally. CSS-only from there, so the lift lands in the same frame as the
// keyboard metrics it reads.

const CLASS = 'expr-search-kb';
// Everything that summons a keyboard. Checkboxes, files, ranges and buttons
// take focus without one, and lifting for those would move the sheet for no
// reason (the custom-emoji panel is full of them).
const FIELD =
	'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=button]):not([type=submit]),' +
	'textarea,[contenteditable="true"]';

// Two pickers can be mounted at once (chat's compose sheet and the reaction
// dock), so the flag is refcounted by node — the LAST field to lose focus is
// what puts the sheets back down.
const lifted = new Set();

function sync() {
	try { document.documentElement.classList.toggle(CLASS, lifted.size > 0); } catch {}
}

/** Svelte action — put it on the picker's root element. */
export function kbLift(node) {
	const onFocusIn = (e) => {
		if (e.target?.matches?.(FIELD)) { lifted.add(node); sync(); }
	};
	const onFocusOut = () => {
		// focusout fires BEFORE the next element takes focus, so settle a turn
		// first and then ask where focus actually landed: moving between two
		// fields inside the same picker must not bounce the sheet down and up.
		setTimeout(() => {
			const el = document.activeElement;
			if (el && node.contains(el) && el.matches?.(FIELD)) lifted.add(node);
			else lifted.delete(node);
			sync();
		}, 0);
	};
	node.addEventListener('focusin', onFocusIn);
	node.addEventListener('focusout', onFocusOut);
	return {
		destroy() {
			node.removeEventListener('focusin', onFocusIn);
			node.removeEventListener('focusout', onFocusOut);
			// Dismissing the picker while its search field is focused is the
			// common exit, and it never fires focusout for a removed node.
			lifted.delete(node);
			sync();
		}
	};
}
