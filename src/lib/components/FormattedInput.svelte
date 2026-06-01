<script>
	import { onMount, tick } from 'svelte';
	import {
		TEXT_FXS, FX_TO_CHAR, CHAR_TO_FX, FX_CLOSE_CHAR, FX_OPEN_CHARS,
		TEXT_COLORS, WDTH_FX_MAP, WDTH_STEPS, WGHT_FX_MAP, WGHT_STEPS, SZ_FX_MAP, SZ_STEPS,
		markupToSegments, segmentsToMarkup, normalizeLegacyMarkup, unicodeToReadable
	} from '$lib/message-render.js';

	let { value = $bindable(''), placeholder = '', singleLine = false } = $props();

	let inputEl = $state(null);
	let showTextFxBar = $state(false);
	let showFormatPanel = $state(false);
	let allowFxNesting = $state(true);
	let allowFxMultiply = $state(false);
	let fxSplitWords = $state(true);
	let messageFontSize = $state(1.0);
	let messageFontWeight = $state(400);
	let messageFontStretch = $state(100);
	let _savedCeSel = null;
	let _lastInlineTypo = {};
	let undoStack = [];
	let redoStack = [];

	const _segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter() : null;
	const _isEmojiSeg = s => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);

	onMount(() => {
		if (value && inputEl) {
			inputEl.innerHTML = '';
			for (const node of ceMarkupToNodes(value)) inputEl.appendChild(node);
		}
	});

	function makeFxNode(fxStack, text, delay = null) {
		const decorFx = fxStack.filter(fx => fx === 'underline' || fx === 'strike');
		const wdthFx = fxStack.find(fx => fx.startsWith('wdth-'));
		const wghtFx = fxStack.find(fx => fx.startsWith('wght-'));
		const szFx = fxStack.find(fx => fx.startsWith('sz-'));
		const animFx = fxStack.filter(fx => fx !== 'underline' && fx !== 'strike' && !fx.startsWith('wdth-') && !fx.startsWith('wght-') && !fx.startsWith('sz-'));
		let innerNode = document.createTextNode(text);
		if (decorFx.length) {
			const span = document.createElement('span');
			span.className = `tfx ${decorFx.map(fx => `tfx-${fx}`).join(' ')}`;
			span.dataset.fx = decorFx.join(' ');
			const tdLine = decorFx.map(fx => fx === 'underline' ? 'underline' : 'line-through').join(' ');
			span.style.textDecorationLine = tdLine;
			span.style.textUnderlineOffset = '2px';
			span.appendChild(innerNode);
			innerNode = span;
		}
		if (szFx) {
			const span = document.createElement('span');
			span.className = `tfx tfx-${szFx}`;
			span.dataset.fx = szFx;
			span.style.fontSize = (parseFloat(szFx.replace('sz-', '')) / 100 * 0.9).toFixed(2) + 'rem';
			span.appendChild(innerNode);
			innerNode = span;
		}
		if (wghtFx) {
			const span = document.createElement('span');
			span.className = `tfx tfx-${wghtFx}`;
			span.dataset.fx = wghtFx;
			span.style.fontWeight = wghtFx.replace('wght-', '');
			span.appendChild(innerNode);
			innerNode = span;
		}
		if (wdthFx) {
			const span = document.createElement('span');
			span.className = `tfx tfx-${wdthFx}`;
			span.dataset.fx = wdthFx;
			span.style.fontStretch = wdthFx.replace('wdth-', '') + '%';
			span.appendChild(innerNode);
			innerNode = span;
		}
		for (let i = animFx.length - 1; i >= 0; i--) {
			const fx = animFx[i];
			const span = document.createElement('span');
			span.className = `tfx tfx-${fx}`;
			span.dataset.fx = fx;
			if (delay) span.style.animationDelay = delay;
			span.appendChild(innerNode);
			innerNode = span;
		}
		return innerNode;
	}

	function ceMarkupToNodes(markup) {
		const segs = markupToSegments(normalizeLegacyMarkup(markup));
		const nodes = [];
		let globalWi = 0;

		function pushText(text, fxStack) {
			if (!text) return;
			if (!fxStack.length) { nodes.push(document.createTextNode(text)); return; }
			if (fxStack.includes('ripple') && _segmenter) {
				const gs = [..._segmenter.segment(text)].map(g => g.segment);
				gs.forEach((g, i) => {
					if (/^\s+$/.test(g)) nodes.push(document.createTextNode(g));
					else nodes.push(makeFxNode(fxStack, g, `${((globalWi + i) * 0.08).toFixed(2)}s`));
				});
				globalWi += gs.filter(g => !/^\s+$/.test(g)).length;
				return;
			}
			if (fxSplitWords && _segmenter) {
				const gs = [..._segmenter.segment(text)].map(g => g.segment);
				if (gs.length > 1 && gs.every(_isEmojiSeg)) {
					gs.forEach((g, i) => nodes.push(makeFxNode(fxStack, g, `${((globalWi + i) * 0.08).toFixed(2)}s`)));
					globalWi += gs.length; return;
				}
				const toks = text.split(/(\s+)/);
				if (toks.length > 1) {
					toks.forEach(tok => {
						if (/^\s+$/.test(tok)) nodes.push(document.createTextNode(tok));
						else nodes.push(makeFxNode(fxStack, tok, `${(globalWi++ * 0.06).toFixed(2)}s`));
					}); return;
				}
				nodes.push(makeFxNode(fxStack, text, `${(globalWi++ * 0.06).toFixed(2)}s`));
				return;
			}
			nodes.push(makeFxNode(fxStack, text));
		}

		for (const seg of segs) {
			pushText(seg.text, seg.fxStack);
		}
		return nodes;
	}

	function serializeCe(el) {
		let result = '';
		for (const node of el.childNodes) {
			if (node.nodeType === Node.TEXT_NODE) {
				result += node.textContent;
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				if (node.dataset?.fx) {
					const fxStack = node.dataset.fx.split(' ').filter(fx => FX_TO_CHAR[fx]);
					result += fxStack.map(fx => FX_TO_CHAR[fx]).join('') + serializeCe(node) + FX_CLOSE_CHAR.repeat(fxStack.length);
				} else if (node.tagName === 'BR') {
					result += '\n';
				} else {
					result += serializeCe(node);
				}
			}
		}
		return result;
	}

	function findDomPos(root, target) {
		let pos = 0;
		function walk(node) {
			if (node.nodeType === Node.TEXT_NODE) {
				const len = node.textContent.length;
				if (pos + len >= target) return { node, offset: target - pos };
				pos += len;
				return null;
			}
			for (const child of node.childNodes) { const r = walk(child); if (r) return r; }
			return null;
		}
		return walk(root) ?? { node: root, offset: root.childNodes.length };
	}

	function cePlainOffset(el, targetNode, targetOffset) {
		let n = 0, done = false;
		function full(node) {
			if (node.nodeType === Node.TEXT_NODE) { n += node.textContent.length; return; }
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			if (node.tagName === 'BR') { n += 1; return; }
			for (const c of node.childNodes) full(c);
		}
		function walk(node) {
			if (done) return;
			if (node === targetNode && node.nodeType === Node.TEXT_NODE) { n += targetOffset; done = true; return; }
			if (node.nodeType === Node.TEXT_NODE) { n += node.textContent.length; return; }
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			if (node === targetNode) {
				let i = 0; for (const c of node.childNodes) { if (i++ >= targetOffset) break; full(c); }
				done = true; return;
			}
			if (node.tagName === 'BR') { n += 1; return; }
			for (const c of node.childNodes) { if (done) break; walk(c); }
		}
		if (el === targetNode) {
			let i = 0; for (const c of el.childNodes) { if (i++ >= targetOffset) break; full(c); }
			return n;
		}
		for (const c of el.childNodes) { if (done) break; walk(c); }
		return n;
	}

	function onCeSelect() {
		const sel = window.getSelection();
		showTextFxBar = !!(sel && !sel.isCollapsed && inputEl?.contains(sel.anchorNode));
		if (sel && !sel.isCollapsed && inputEl?.contains(sel.anchorNode)) {
			const range = sel.getRangeAt(0);
			_savedCeSel = {
				start: cePlainOffset(inputEl, range.startContainer, range.startOffset),
				end: cePlainOffset(inputEl, range.endContainer, range.endOffset)
			};
		}
	}

	function pushUndo() {
		if (undoStack.length >= 50) undoStack.shift();
		undoStack.push(value);
		redoStack.length = 0;
	}

	function applyTextFx(name) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !inputEl || !inputEl.contains(sel.anchorNode)) return;
		pushUndo();
		const range = sel.getRangeAt(0);
		const selStart = cePlainOffset(inputEl, range.startContainer, range.startOffset);
		const selEnd = cePlainOffset(inputEl, range.endContainer, range.endOffset);
		if (selStart >= selEnd) return;

		const markup = serializeCe(inputEl);
		const segs = markupToSegments(markup);

		const isColorFx = name.startsWith('color-') || name === 'rainbow';
		const isFormatFx = name === 'bold' || name === 'italic' || name === 'underline' || name === 'strike' || isColorFx;
		const isFmtFx = (fx) => fx === 'bold' || fx === 'italic' || fx === 'underline' || fx === 'strike' || fx === 'rainbow' || fx.startsWith('color-') || fx.startsWith('wdth-') || fx.startsWith('wght-') || fx.startsWith('sz-');

		let p0 = 0, allHaveIt = true;
		for (const seg of segs) {
			const sEnd = p0 + seg.text.length;
			if (sEnd > selStart && p0 < selEnd && !seg.fxStack.includes(name)) { allHaveIt = false; break; }
			p0 += seg.text.length;
		}

		let plain = 0;
		const newSegs = [];
		for (const seg of segs) {
			const segStart = plain, segEnd = plain + seg.text.length;
			if (segEnd <= selStart || segStart >= selEnd) {
				newSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
			} else {
				const overlapStart = Math.max(segStart, selStart);
				const overlapEnd = Math.min(segEnd, selEnd);
				if (overlapStart > segStart) newSegs.push({ text: seg.text.slice(0, overlapStart - segStart), fxStack: [...seg.fxStack] });
				let newStack;
				if (allHaveIt) {
					newStack = seg.fxStack.filter(fx => fx !== name);
				} else if (allowFxNesting || isFormatFx) {
					newStack = [...seg.fxStack];
					if (isColorFx) newStack = newStack.filter(fx => !fx.startsWith('color-') && fx !== 'rainbow');
					if (allowFxMultiply || !newStack.includes(name)) newStack.push(name);
				} else {
					newStack = seg.fxStack.filter(isFmtFx);
					newStack.push(name);
				}
				newSegs.push({ text: seg.text.slice(overlapStart - segStart, overlapEnd - segStart), fxStack: newStack });
				if (overlapEnd < segEnd) newSegs.push({ text: seg.text.slice(overlapEnd - segStart), fxStack: [...seg.fxStack] });
			}
			plain += seg.text.length;
		}

		const mergedSegs = [];
		for (const seg of newSegs) {
			if (!seg.text) continue;
			const last = mergedSegs[mergedSegs.length - 1];
			if (last && last.fxStack.join(',') === seg.fxStack.join(',')) last.text += seg.text;
			else mergedSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
		}

		const newMarkup = segmentsToMarkup(mergedSegs);
		inputEl.innerHTML = '';
		for (const node of ceMarkupToNodes(newMarkup)) inputEl.appendChild(node);

		const startPos = findDomPos(inputEl, selStart);
		const endPos = findDomPos(inputEl, selEnd);
		const newRange = document.createRange();
		newRange.setStart(startPos.node, startPos.offset);
		newRange.setEnd(endPos.node, endPos.offset);
		sel.removeAllRanges();
		sel.addRange(newRange);

		value = newMarkup;
		inputEl.focus();
	}

	function applyInlineTypo(rawVal, steps, defaultVal, fxMap, prefix) {
		if (!_savedCeSel || !inputEl) return;
		const step = steps.reduce((a, b) => Math.abs(b - rawVal) < Math.abs(a - rawVal) ? b : a);
		if (step === _lastInlineTypo[prefix]) return;
		_lastInlineTypo[prefix] = step;
		const fxName = step !== defaultVal ? (fxMap[step] ?? null) : null;
		const { start: selStart, end: selEnd } = _savedCeSel;
		if (selStart >= selEnd) return;
		pushUndo();
		const markup = serializeCe(inputEl);
		const segs = markupToSegments(markup);
		let plain = 0;
		const newSegs = [];
		for (const seg of segs) {
			const segStart = plain, segEnd = plain + seg.text.length;
			if (segEnd <= selStart || segStart >= selEnd) {
				newSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
			} else {
				const overlapStart = Math.max(segStart, selStart), overlapEnd = Math.min(segEnd, selEnd);
				if (overlapStart > segStart) newSegs.push({ text: seg.text.slice(0, overlapStart - segStart), fxStack: [...seg.fxStack] });
				const newStack = seg.fxStack.filter(fx => !fx.startsWith(prefix));
				if (fxName) newStack.push(fxName);
				newSegs.push({ text: seg.text.slice(overlapStart - segStart, overlapEnd - segStart), fxStack: newStack });
				if (overlapEnd < segEnd) newSegs.push({ text: seg.text.slice(overlapEnd - segStart), fxStack: [...seg.fxStack] });
			}
			plain += seg.text.length;
		}
		const mergedSegs = [];
		for (const seg of newSegs) {
			if (!seg.text) continue;
			const last = mergedSegs[mergedSegs.length - 1];
			if (last && last.fxStack.join(',') === seg.fxStack.join(',')) last.text += seg.text;
			else mergedSegs.push({ text: seg.text, fxStack: [...seg.fxStack] });
		}
		const newMarkup = segmentsToMarkup(mergedSegs);
		inputEl.innerHTML = '';
		for (const node of ceMarkupToNodes(newMarkup)) inputEl.appendChild(node);
		try {
			const startPos = findDomPos(inputEl, selStart);
			const endPos = findDomPos(inputEl, selEnd);
			const newRange = document.createRange();
			newRange.setStart(startPos.node, startPos.offset);
			newRange.setEnd(endPos.node, endPos.offset);
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(newRange);
			showTextFxBar = true;
		} catch {}
		value = newMarkup;
	}

	function applyInlineWidth(val) { applyInlineTypo(val, WDTH_STEPS, 100, WDTH_FX_MAP, 'wdth-'); }
	function applyInlineWeight(val) { applyInlineTypo(val, WGHT_STEPS, 400, WGHT_FX_MAP, 'wght-'); }
	function applyInlineSize(val) { applyInlineTypo(val, SZ_STEPS, 1.0, SZ_FX_MAP, 'sz-'); }

	function renderMarkup(markup) {
		if (!inputEl) return;
		inputEl.innerHTML = '';
		for (const node of ceMarkupToNodes(markup)) inputEl.appendChild(node);
		value = markup;
	}

	function onCeInput() {
		if (!inputEl) return;
		const newMarkup = serializeCe(inputEl);
		if (newMarkup !== value) {
			if (undoStack.length >= 50) undoStack.shift();
			undoStack.push(value);
			redoStack.length = 0;
		}
		value = newMarkup;
		if (!newMarkup) {
			messageFontSize = 1.0; messageFontWeight = 400; messageFontStretch = 100;
			_savedCeSel = null; _lastInlineTypo = {};
		}
	}

	function undo() {
		if (!undoStack.length || !inputEl) return;
		redoStack.push(value);
		const prev = undoStack.pop();
		renderMarkup(prev);
	}

	function redo() {
		if (!redoStack.length || !inputEl) return;
		undoStack.push(value);
		const next = redoStack.pop();
		renderMarkup(next);
	}

	function onCeCopy(e) {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !inputEl) return;
		const range = sel.getRangeAt(0);
		if (!inputEl.contains(range.commonAncestorContainer)) return;
		const tempDiv = document.createElement('div');
		tempDiv.appendChild(range.cloneContents());
		const outerFxStack = [];
		let cur = range.commonAncestorContainer;
		if (cur.nodeType === Node.TEXT_NODE) cur = cur.parentElement;
		while (cur && cur !== inputEl) {
			const fx = cur.dataset?.fx;
			if (fx) fx.split(' ').filter(f => FX_TO_CHAR[f]).forEach(f => outerFxStack.unshift(f));
			cur = cur.parentElement;
		}
		let rawMarkup = serializeCe(tempDiv);
		if (outerFxStack.length) {
			rawMarkup = outerFxStack.map(fx => FX_TO_CHAR[fx]).join('') + rawMarkup + FX_CLOSE_CHAR.repeat(outerFxStack.length);
		}
		const readable = unicodeToReadable(rawMarkup);
		e.preventDefault();
		e.clipboardData.setData('text/plain', readable);
		e.clipboardData.setData('text/x-eating-markup', rawMarkup);
	}

	function onCePaste(e) {
		e.preventDefault();
		const markup = e.clipboardData.getData('text/x-eating-markup');
		const plain = markup || e.clipboardData.getData('text/plain') || '';
		if (!plain) return;
		pushUndo();
		const sel = window.getSelection();
		if (sel && sel.rangeCount) {
			const range = sel.getRangeAt(0);
			range.deleteContents();
			if (markup) {
				const nodes = ceMarkupToNodes(markup);
				const frag = document.createDocumentFragment();
				let lastNode;
				for (const n of nodes) { frag.appendChild(n); lastNode = n; }
				range.insertNode(frag);
				if (lastNode) {
					const r = document.createRange();
					r.setStartAfter(lastNode);
					r.collapse(true);
					sel.removeAllRanges();
					sel.addRange(r);
				}
			} else {
				const tn = document.createTextNode(plain);
				range.insertNode(tn);
				const r = document.createRange();
				r.setStartAfter(tn);
				r.collapse(true);
				sel.removeAllRanges();
				sel.addRange(r);
			}
		}
		value = serializeCe(inputEl);
	}

	function onKeydown(e) {
		if (singleLine && e.key === 'Enter') { e.preventDefault(); return; }
		if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); applyTextFx('bold'); }
		if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); applyTextFx('italic'); }
		if ((e.metaKey || e.ctrlKey) && e.key === 'u') { e.preventDefault(); applyTextFx('underline'); }
		if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
		if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
		if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(); }
	}
</script>

<div class="fi-wrap">
	<div class="fi-editor">
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="fi-ce"
			role="textbox"
			aria-multiline={!singleLine}
			contenteditable="true"
			bind:this={inputEl}
			oninput={onCeInput}
			onkeydown={onKeydown}
			onmouseup={onCeSelect}
			onkeyup={onCeSelect}
			onblur={() => { setTimeout(() => { const ae = document.activeElement; if (!ae?.closest('.fi-wrap')) showTextFxBar = false; }, 120); }}
			oncopy={onCeCopy}
			onpaste={onCePaste}
			data-placeholder={placeholder}
		></div>
		<div class="fi-fmt-row">
			<button class="fi-btn fi-btn-bold" onmousedown={(e) => { e.preventDefault(); applyTextFx('bold'); }} title="Bold (⌘B)"><b>B</b></button>
			<button class="fi-btn fi-btn-italic" onmousedown={(e) => { e.preventDefault(); applyTextFx('italic'); }} title="Italic (⌘I)"><i>I</i></button>
			<button class="fi-btn fi-btn-underline" onmousedown={(e) => { e.preventDefault(); applyTextFx('underline'); }} title="Underline (⌘U)"><u>U</u></button>
			<button class="fi-btn fi-btn-strike" onmousedown={(e) => { e.preventDefault(); applyTextFx('strike'); }} title="Strikethrough"><s>S</s></button>
			<div class="fi-color-wrap">
				<button class="fi-btn fi-btn-color" class:active={showFormatPanel} onmousedown={(e) => { e.preventDefault(); showFormatPanel = !showFormatPanel; }} title="Text color">A</button>
				{#if showFormatPanel}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<div class="fi-backdrop" onclick={() => showFormatPanel = false}></div>
					<div class="fi-color-pop">
						<div class="fi-color-grid">
							{#each TEXT_COLORS as c}
								<button class="fi-swatch" style="background:{c.hex}" onmousedown={(e) => { e.preventDefault(); applyTextFx(c.name); showFormatPanel = false; }} title={c.name.replace('color-', '')}></button>
							{/each}
						</div>
						<button class="fi-rainbow-btn" onmousedown={(e) => { e.preventDefault(); applyTextFx('rainbow'); showFormatPanel = false; }}>Rainbow</button>
					</div>
				{/if}
			</div>
		</div>
	</div>

	{#if showTextFxBar}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fi-typo-bar" onfocusin={() => { showTextFxBar = true; }}>
			<div class="fi-typo-row">
				<span class="fi-typo-label">Size</span>
				<input class="fi-typo-range" type="range" min="0.55" max="5" step="0.05"
					bind:value={messageFontSize}
					oninput={() => { if (_savedCeSel) { applyInlineSize(messageFontSize); showTextFxBar = true; } }} />
				{#if messageFontSize !== 1.0}<button class="fi-typo-reset" onmousedown={(e) => { e.preventDefault(); messageFontSize = 1.0; _lastInlineTypo['sz-'] = null; if (_savedCeSel) applyInlineSize(1.0); }}>↺</button>{/if}
			</div>
			<div class="fi-typo-row">
				<span class="fi-typo-label">Weight</span>
				<input class="fi-typo-range" type="range" min="100" max="700" step="50"
					bind:value={messageFontWeight}
					oninput={() => { if (_savedCeSel) { applyInlineWeight(messageFontWeight); showTextFxBar = true; } }} />
				{#if messageFontWeight !== 400}<button class="fi-typo-reset" onmousedown={(e) => { e.preventDefault(); messageFontWeight = 400; _lastInlineTypo['wght-'] = null; if (_savedCeSel) applyInlineWeight(400); }}>↺</button>{/if}
			</div>
			<div class="fi-typo-row">
				<span class="fi-typo-label">Width</span>
				<input class="fi-typo-range" type="range" min="25" max="150" step="1"
					bind:value={messageFontStretch}
					oninput={() => { if (_savedCeSel) { applyInlineWidth(messageFontStretch); showTextFxBar = true; } }} />
				{#if messageFontStretch !== 100}<button class="fi-typo-reset" onmousedown={(e) => { e.preventDefault(); messageFontStretch = 100; _lastInlineTypo['wdth-'] = null; if (_savedCeSel) applyInlineWidth(100); }}>↺</button>{/if}
			</div>
			<button class="fi-default-btn" onmousedown={(e) => {
				e.preventDefault();
				messageFontSize = 1.0; messageFontWeight = 400; messageFontStretch = 100;
				_lastInlineTypo = {};
				if (_savedCeSel) { applyInlineSize(1.0); applyInlineWeight(400); applyInlineWidth(100); }
			}}>Default</button>
		</div>
		<div class="fi-fx-bar">
			<button class="fi-layer-toggle" class:fi-layer-on={allowFxNesting} onmousedown={(e) => { e.preventDefault(); allowFxNesting = !allowFxNesting; }} title="Stack different effects on the same text">
				<span class="fi-toggle-track"><span class="fi-toggle-knob"></span></span>
				Layer
			</button>
			<button class="fi-layer-toggle" class:fi-layer-on={allowFxMultiply} onmousedown={(e) => { e.preventDefault(); allowFxMultiply = !allowFxMultiply; }} title="Apply the same effect multiple times on the same text">
				<span class="fi-toggle-track"><span class="fi-toggle-knob"></span></span>
				Multiply
			</button>
			<button class="fi-layer-toggle" class:fi-layer-on={fxSplitWords} onmousedown={(e) => { e.preventDefault(); fxSplitWords = !fxSplitWords; }} title="Apply effect to each word separately">
				<span class="fi-toggle-track"><span class="fi-toggle-knob"></span></span>
				Per word
			</button>
			<span class="fi-divider"></span>
			{#each TEXT_FXS as fx}
				<button class="fi-fx-btn" onmousedown={(e) => { e.preventDefault(); applyTextFx(fx.name); }}>
					{#if fx.name === 'ripple'}
						{@html [...fx.label].map((c, i) => `<span class="tfx tfx-ripple" style="animation-delay:${(i * 0.08).toFixed(2)}s;display:inline-block">${c}</span>`).join('')}
					{:else}
						<span class="tfx tfx-{fx.name}">{fx.label}</span>
					{/if}
				</button>
			{/each}
			<button class="fi-fx-close" onmousedown={(e) => { e.preventDefault(); showTextFxBar = false; }}>✕</button>
		</div>
	{/if}
</div>

<style>
	.fi-wrap { display: flex; flex-direction: column; }
	.fi-editor {
		border: 1.5px solid var(--border); border-radius: 10px;
		background: var(--paper); transition: border-color 0.15s;
	}
	.fi-editor:focus-within { border-color: var(--ink, var(--ink)); }
	.fi-ce {
		padding: 0.6rem 0.85rem 0.35rem;
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif, 'Noto Color Emoji'; font-optical-sizing: auto;
		font-size: 0.9rem; color: var(--ink, var(--ink));
		outline: none; max-height: 120px; overflow-y: auto;
		line-height: 1.45; white-space: pre-wrap; word-break: break-word;
		min-height: calc(1.45em + 0.95rem); scrollbar-width: none;
	}
	.fi-ce::-webkit-scrollbar { display: none; }
	.fi-ce:empty::before {
		content: attr(data-placeholder);
		color: var(--muted-fg); pointer-events: none;
	}
	.fi-fmt-row {
		display: flex; align-items: center; gap: 0.1rem;
		padding: 0.2rem 0.5rem 0.3rem; border-top: 1px solid #ede9e3;
	}
	.fi-btn {
		display: flex; align-items: center; justify-content: center;
		width: 26px; height: 26px; flex-shrink: 0;
		border: none; border-radius: 6px;
		background: none; cursor: pointer; color: var(--ink, var(--ink)); opacity: 0.45;
		font-size: 0.85rem; line-height: 1; font-family: inherit;
		transition: opacity 0.15s, background 0.1s;
	}
	.fi-btn:hover, .fi-btn.active { opacity: 1; background: var(--surface-2); }
	.fi-btn-bold { font-weight: 700; }
	.fi-btn-italic { font-style: italic; font-weight: 600; }
	.fi-btn-underline { text-decoration: underline; text-underline-offset: 2px; }
	.fi-btn-strike { text-decoration: line-through; }
	.fi-btn-color {
		font-weight: 700; font-size: 0.8rem;
		text-decoration: underline; text-decoration-color: #e74c3c;
		text-decoration-thickness: 2px; text-underline-offset: 1px;
	}
	.fi-color-wrap { position: relative; flex-shrink: 0; }
	.fi-backdrop { position: fixed; inset: 0; z-index: 40; }
	.fi-color-pop {
		position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 10px;
		box-shadow: 0 4px 16px rgba(0,0,0,0.12); z-index: 50;
		padding: 0.5rem; display: flex; flex-direction: column; gap: 0.35rem; min-width: 152px;
	}
	.fi-color-grid { display: flex; gap: 0.3rem; flex-wrap: wrap; }
	.fi-swatch {
		width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
		border: 2px solid transparent; cursor: pointer;
		transition: transform 0.12s, border-color 0.12s;
	}
	.fi-swatch:hover { transform: scale(1.2); border-color: rgba(0,0,0,0.25); }
	.fi-rainbow-btn {
		background: none; border: 1.5px solid var(--border); border-radius: 6px;
		padding: 0.25rem 0.5rem; font-size: 0.78rem; font-family: inherit;
		cursor: pointer; text-align: left; color: var(--ink, var(--ink)); transition: background 0.1s;
	}
	.fi-rainbow-btn:hover { background: var(--surface-2); }

	.fi-typo-bar {
		display: flex; gap: 0.5rem; padding: 0.35rem 0.85rem;
		border-top: 1px solid var(--border); background: var(--surface-2);
		flex-wrap: wrap;
	}
	.fi-typo-row { display: flex; align-items: center; gap: 0.35rem; flex: 1; min-width: 100px; }
	.fi-typo-label {
		font-size: 0.65rem; font-weight: 600; color: var(--muted-fg);
		text-transform: uppercase; letter-spacing: 0.03em; width: 2.5rem; flex-shrink: 0;
	}
	.fi-typo-range { flex: 1; height: 3px; accent-color: var(--ink, var(--ink)); cursor: pointer; }
	.fi-typo-reset {
		background: none; border: none; color: var(--muted-fg); font-size: 0.7rem;
		cursor: pointer; padding: 0 0.15rem; line-height: 1; flex-shrink: 0;
		transition: color 0.1s;
	}
	.fi-typo-reset:hover { color: var(--ink, var(--ink)); }
	.fi-default-btn {
		padding: 0.15rem 0.5rem; border: 1px solid var(--border); border-radius: 5px;
		background: none; font-family: inherit; font-size: 0.62rem; font-weight: 600;
		color: var(--muted-fg); cursor: pointer; white-space: nowrap; flex-shrink: 0;
		transition: background 0.1s, color 0.1s;
	}
	.fi-default-btn:hover { background: var(--surface-2); color: var(--ink, var(--ink)); }

	.fi-fx-bar {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.35rem 0.85rem; background: var(--paper, #faf6ef); border-top: 1px solid var(--border);
		flex-wrap: wrap;
	}
	.fi-layer-toggle {
		display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;
		background: none; border: none; padding: 0; cursor: pointer;
		font-size: 0.72rem; font-weight: 600; color: var(--muted-fg); font-family: inherit;
		transition: color 0.15s;
	}
	.fi-layer-toggle:hover { color: var(--ink, var(--ink)); }
	.fi-layer-on { color: var(--ink, var(--ink)) !important; }
	.fi-toggle-track {
		position: relative; width: 2rem; height: 1.1rem; flex-shrink: 0;
		background: var(--border); border-radius: 999px; transition: background 0.2s;
	}
	.fi-layer-on .fi-toggle-track { background: var(--ink, var(--ink)); }
	.fi-toggle-knob {
		position: absolute; top: 0.15rem; left: 0.15rem;
		width: 0.8rem; height: 0.8rem;
		background: white; border-radius: 50%;
		transition: transform 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.18);
	}
	.fi-layer-on .fi-toggle-knob { transform: translateX(0.9rem); }
	.fi-divider { width: 1px; height: 1.1rem; background: var(--border); flex-shrink: 0; margin: 0 0.1rem; }
	.fi-fx-btn {
		padding: 0.18rem 0.5rem; background: var(--surface-2); border: 1.5px solid var(--border);
		border-radius: 5px; font-size: 0.76rem; font-weight: 600; color: var(--ink, var(--ink));
		font-family: 'Google Sans Flex', 'Space Grotesk', sans-serif; font-optical-sizing: auto;
		cursor: pointer; transition: background 0.1s;
	}
	.fi-fx-btn:hover { background: var(--ink, var(--ink)); color: var(--paper, #faf6ef); border-color: var(--ink, var(--ink)); }
	.fi-fx-bar :global(.tfx) { animation-iteration-count: infinite !important; }
	.fi-fx-close { margin-left: auto; background: none; border: none; font-size: 0.78rem; color: var(--muted-fg); cursor: pointer; padding: 0.1rem 0.25rem; line-height: 1; }
</style>
