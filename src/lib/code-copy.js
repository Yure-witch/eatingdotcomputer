// Copying code out of a chat message.
//
// A rendered code block is not just code — it carries chrome: the Copy button's
// own label, the language pill, a gutter of line numbers, and sometimes a
// "Show all N lines" button. All of it sits inside `.code-block`, so a plain
// text selection swept across a block used to come out as
//
//     " CopyJavaScript
//      1234
//      const a = 1;
//      …"
//
// — the line numbers run together into "1234", and the button label leads.
// Pasting that anywhere is useless.
//
// Two rules, matching how people actually copy:
//
//   • Chrome is never copied. The CSS marks it `user-select: none`, which
//     keeps it out of the browser's own selection string too, so even the
//     paths that don't reach this handler stay clean.
//   • A code block that is selected IN FULL comes out as a fenced block
//     (```lang … ```) rather than bare lines. Paste it back into the composer
//     and it renders as a code block again, which is what someone quoting a
//     snippet into another conversation actually wants. A partially selected
//     block still yields just the lines they dragged over.
//
// The Copy button itself is a separate path (the click handler in each chat
// page) and copies the raw code with no fence — pressing "Copy" means "give me
// this code", not "give me this code as markdown".

/** The block, rebuilt as markdown someone can paste back into the composer. */
function fence(block) {
	const lang = block.getAttribute('data-lang') || '';
	const code = block.querySelector('code')?.textContent ?? '';
	return `\`\`\`${lang}\n${code.replace(/\n$/, '')}\n\`\`\``;
}

/** Serialise a cloned selection fragment, fencing whole blocks, dropping chrome. */
function serialise(node) {
	let out = '';
	for (const child of node.childNodes) {
		if (child.nodeType === Node.TEXT_NODE) {
			out += child.nodeValue;
			continue;
		}
		if (child.nodeType !== Node.ELEMENT_NODE) continue;

		// Marked before the clone: this block was inside the selection in its
		// entirety, so the clone holds all of it and we can rebuild the fence.
		if (child.getAttribute?.('data-copy-whole') === '1') {
			out += `\n${fence(child)}\n`;
			continue;
		}

		// Chrome, in a partially selected block. Never text.
		const cls = child.classList;
		if (
			cls?.contains('code-block-header') ||
			cls?.contains('code-lines') ||
			cls?.contains('code-show-more')
		) continue;

		out += serialise(child);
		// Keep the line structure of a partial selection: <pre> content is
		// already newline-delimited, but block elements around it are not.
		if (child.tagName === 'BR') out += '\n';
		else if (child.tagName === 'DIV' || child.tagName === 'P') out += '\n';
	}
	return out;
}

/**
 * Attach the copy handler to a message list.
 * @param {HTMLElement} listEl
 * @returns {() => void} detach
 */
export function attachCodeBlockCopy(listEl) {
	const onCopy = (e) => {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !sel.rangeCount) return;

		const range = sel.getRangeAt(0);
		// Explicit boundary comparison rather than Selection.containsNode():
		// containsNode(node, false) reports FALSE when the node's end sits at
		// the same position as the selection's end, which is exactly the case
		// when someone selects a block and nothing after it — the one case
		// this feature exists for. Comparing boundary points has no such edge.
		//
		// Ask about the <code>, not the wrapper: the wrapper also holds chrome
		// that is user-select:none, so it is never fully inside a selection.
		const whole = [];
		for (const block of listEl.querySelectorAll('.code-block')) {
			const codeEl = block.querySelector('code');
			if (!codeEl) continue;
			const codeRange = document.createRange();
			codeRange.selectNodeContents(codeEl);
			const startsBefore = range.compareBoundaryPoints(Range.START_TO_START, codeRange) <= 0;
			const endsAfter = range.compareBoundaryPoints(Range.END_TO_END, codeRange) >= 0;
			if (startsBefore && endsAfter) whole.push(block);
		}
		// No complete block in the selection: the CSS already keeps chrome out,
		// so the browser's own behaviour is correct. Don't touch the clipboard.
		if (!whole.length) return;

		let text;
		if (whole.length === 1 && whole[0].contains(range.commonAncestorContainer)) {
			// The selection lies WITHIN the block (dragging across the code, or
			// selecting the block's own contents). cloneContents() then returns
			// the block's children, not the block element, so there is nothing
			// for the walk below to rewrite — build the fence straight from it.
			text = fence(whole[0]);
		} else {
			for (const b of whole) b.setAttribute('data-copy-whole', '1');
			try {
				text = serialise(range.cloneContents());
			} finally {
				for (const b of whole) b.removeAttribute('data-copy-whole');
			}
		}

		text = text.replace(/\n{3,}/g, '\n\n').trim();
		if (!text) return;
		e.clipboardData?.setData('text/plain', text);
		e.preventDefault();
	};

	listEl.addEventListener('copy', onCopy);
	return () => listEl.removeEventListener('copy', onCopy);
}
