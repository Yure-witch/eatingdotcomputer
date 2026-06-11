<script>
	/**
	 * Mention autocomplete popover for chat compose boxes.
	 *
	 * Self-contained: the parent passes `inputEl` (the contenteditable
	 * compose box) + `members`, and this component attaches its own
	 * `input` and `keydown` listeners directly to the input element.
	 *
	 * The `keydown` listener uses the CAPTURE phase so it preempts the
	 * parent's own handler — when the popover is open and the user
	 * hits an arrow/Enter/Tab/Escape, we `preventDefault` +
	 * `stopImmediatePropagation` so the parent never sees the key.
	 *
	 * Insertion: clicks + `Enter`/`Tab` replace the `@<query>` trigger
	 * range with plain `@Name ` text. The chat send path resolves
	 * mentions from plain text at send time (see resolveMentionsFromText),
	 * so the popover's only job is making typing easier — no inline
	 * markup, no state lingering in the message body.
	 */
	import { detectMentionTrigger, filterMembers } from '$lib/mentions.js';
	import Avatar from './Avatar.svelte';

	let { inputEl = null, members = [] } = $props();

	let open = $state(false);
	let query = $state('');
	let atIdx = $state(-1);
	let caretIdx = $state(-1);
	let activeIdx = $state(0);
	let pos = $state({ left: 0, top: 0 });

	const matches = $derived.by(() => filterMembers(members, query));

	// Walk inputEl text nodes to find a (node, offsetInNode) pair for
	// a given absolute char offset in the serialized text. Used to
	// replace the trigger range when a member is picked.
	function locate(root, target) {
		let walked = 0;
		function walk(node) {
			for (const child of node.childNodes) {
				if (child.nodeType === Node.TEXT_NODE) {
					const len = child.textContent.length;
					if (walked + len >= target) {
						return { node: child, offset: target - walked };
					}
					walked += len;
				} else if (child.nodeType === Node.ELEMENT_NODE) {
					const result = walk(child);
					if (result) return result;
				}
			}
			return null;
		}
		return walk(root) ?? { node: root, offset: 0 };
	}

	function textBeforeCaret() {
		if (!inputEl) return null;
		const sel = window.getSelection?.();
		if (!sel?.rangeCount) return null;
		const r = sel.getRangeAt(0);
		if (!inputEl.contains(r.startContainer)) return null;
		const probe = document.createRange();
		probe.selectNodeContents(inputEl);
		probe.setEnd(r.endContainer, r.endOffset);
		return probe.toString();
	}

	// Position the popover with `position: fixed` (viewport coords) so
	// it floats over any positioned ancestor in the chat compose.
	// `transform: translateY(-100% - 6px)` in CSS parks it above the
	// caret where the screen has free space.
	function placePopover() {
		if (!inputEl) return;
		const sel = window.getSelection?.();
		if (!sel?.rangeCount) return;
		const r = sel.getRangeAt(0).getBoundingClientRect();
		const inputRect = inputEl.getBoundingClientRect();
		const base = (r && (r.width || r.height)) ? r : inputRect;
		pos = {
			left: Math.round(base.left),
			top: Math.round(base.top)
		};
	}

	function update() {
		if (!inputEl || !members?.length) { open = false; return; }
		const before = textBeforeCaret();
		if (before == null) { open = false; return; }
		const trig = detectMentionTrigger(before);
		if (!trig) { open = false; return; }
		atIdx = trig.atIdx;
		caretIdx = before.length;
		query = trig.query;
		activeIdx = 0;
		open = true;
		queueMicrotask(placePopover);
	}

	function pick(member) {
		if (!member || !inputEl || atIdx < 0 || caretIdx < atIdx) { open = false; return; }
		const start = locate(inputEl, atIdx);
		const end = locate(inputEl, caretIdx);
		const range = document.createRange();
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);
		range.deleteContents();
		const tn = document.createTextNode('@' + member.name + ' ');
		range.insertNode(tn);
		const sel = window.getSelection();
		sel.removeAllRanges();
		const endRange = document.createRange();
		endRange.setStart(tn, tn.length);
		endRange.collapse(true);
		sel.addRange(endRange);
		open = false;
		inputEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
	}

	function onInput() {
		// Selection isn't always settled the instant `input` fires (some
		// browsers update the DOM first and the selection at the end of
		// the task) so we defer one microtask.
		queueMicrotask(update);
	}

	function onKeyDown(e) {
		if (!open || !matches.length) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault(); e.stopImmediatePropagation();
			activeIdx = (activeIdx + 1) % matches.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault(); e.stopImmediatePropagation();
			activeIdx = (activeIdx - 1 + matches.length) % matches.length;
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault(); e.stopImmediatePropagation();
			pick(matches[activeIdx]);
		} else if (e.key === 'Escape') {
			e.preventDefault(); e.stopImmediatePropagation();
			open = false;
		}
	}

	function onBlur() {
		// Close on a tick delay so a popover-item mousedown handler can
		// still fire before the input loses focus.
		setTimeout(() => { open = false; }, 120);
	}

	// Attach listeners directly to `inputEl` so we sit in the same
	// event flow as the parent. Capture phase on keydown means we can
	// preempt the parent's keydown for nav keys. Re-attach when the
	// inputEl reference changes (e.g. parent remounts the textbox).
	$effect(() => {
		const el = inputEl;
		if (!el) return;
		el.addEventListener('input', onInput);
		el.addEventListener('keydown', onKeyDown, true); // capture phase
		el.addEventListener('blur', onBlur);
		return () => {
			el.removeEventListener('input', onInput);
			el.removeEventListener('keydown', onKeyDown, true);
			el.removeEventListener('blur', onBlur);
		};
	});
</script>

{#if open && matches.length}
	<div class="mention-pop" style:left="{pos.left}px" style:top="{pos.top}px" role="listbox" aria-label="Mention suggestions">
		{#each matches as m, i (m.id)}
			<button
				type="button"
				class="mention-item"
				class:active={i === activeIdx}
				onmousedown={(e) => { e.preventDefault(); pick(m); }}
				onmouseenter={() => (activeIdx = i)}
			>
				<Avatar
					name={m.name}
					uid={m.id}
					avatarKind={m.avatarKind ?? 'gen'}
					avatarValue={m.avatarValue ?? null}
					size={22}
				/>
				<span class="mention-name">{m.name}</span>
				{#if m.role && m.role !== 'student'}
					<span class="mention-role">{m.role}</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}

<style>
	.mention-pop {
		/* `fixed` so the popover floats over the chat compose's
		   position:relative ancestor without being clipped or
		   misplaced. Viewport coordinates from placePopover(),
		   `translateY(-100% - 6px)` lifts it above the caret where
		   there's free space. */
		position: fixed;
		transform: translateY(calc(-100% - 6px));
		z-index: 10000;
		min-width: 200px;
		max-width: 260px;
		padding: 4px;
		background: var(--paper);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: 0 8px 24px rgba(0,0,0,0.12);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.mention-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 5px 8px;
		border: none;
		background: transparent;
		border-radius: 7px;
		font: inherit;
		font-size: 0.85rem;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.mention-name { flex: 1; font-weight: 500; }
	.mention-item.active,
	.mention-item:hover { background: var(--surface-2); }
	.mention-role {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted-fg);
	}
</style>
