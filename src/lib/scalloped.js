const K1 = 0.36, K2 = 0.64;
const r = n => Math.round(n * 100) / 100;

function starburstPath(w, h, amp) {
	if (!amp || amp < 1 || w < 1 || h < 1) return null;
	const wl = amp * 3;
	const topN = Math.max(1, Math.round(w / wl));
	const rightN = Math.max(1, Math.round(h / wl));
	const topWl = w / topN;
	const rightWl = h / rightN;

	let d = 'M 0 0';
	for (let i = 0; i < topN; i++) {
		const x0 = i * topWl;
		d += ` C ${r(x0 + topWl * K1)} ${r(amp)} ${r(x0 + topWl * K2)} ${r(amp)} ${r(x0 + topWl)} 0`;
	}
	for (let i = 0; i < rightN; i++) {
		const y0 = i * rightWl;
		d += ` C ${r(w - amp)} ${r(y0 + rightWl * K1)} ${r(w - amp)} ${r(y0 + rightWl * K2)} ${r(w)} ${r(y0 + rightWl)}`;
	}
	for (let i = 0; i < topN; i++) {
		const x0 = w - i * topWl;
		d += ` C ${r(x0 - topWl * K1)} ${r(h - amp)} ${r(x0 - topWl * K2)} ${r(h - amp)} ${r(x0 - topWl)} ${r(h)}`;
	}
	for (let i = 0; i < rightN; i++) {
		const y0 = h - i * rightWl;
		d += ` C ${r(amp)} ${r(y0 - rightWl * K1)} ${r(amp)} ${r(y0 - rightWl * K2)} 0 ${r(y0 - rightWl)}`;
	}
	return d + ' Z';
}

function scallopPath(w, h, amp) {
	if (!amp || amp < 1 || w < 1 || h < 1) return null;
	const a = amp;
	const d2 = a / 2;
	const pk = d2 + 2 * a;

	const spanX = w - a;
	const spanY = h - a;
	if (spanX < 4 * a || spanY < 4 * a) return null;

	const topN = 2 * Math.max(1, Math.round(spanX / (4 * a)));
	const sideN = 2 * Math.max(1, Math.round(spanY / (4 * a)));
	const tw = spanX / topN;
	const sw = spanY / sideN;
	const topMid = topN - 2;
	const sideMid = sideN - 2;

	let d = `M ${r(d2)} ${r(d2)}`;

	d += ` C ${r(a)} 0 ${r(d2 + K2 * tw)} ${r(pk)} ${r(d2 + tw)} ${r(pk)}`;
	for (let i = 0; i < topMid; i++) {
		const x = d2 + (i + 1) * tw;
		if (i % 2 === 0)
			d += ` C ${r(x + K1 * tw)} ${r(pk)} ${r(x + K2 * tw)} ${r(d2)} ${r(x + tw)} ${r(d2)}`;
		else
			d += ` C ${r(x + K1 * tw)} ${r(d2)} ${r(x + K2 * tw)} ${r(pk)} ${r(x + tw)} ${r(pk)}`;
	}
	d += ` C ${r(w - d2 - K2 * tw)} ${r(pk)} ${r(w - a)} 0 ${r(w - d2)} ${r(d2)}`;

	d += ` C ${r(w)} ${r(a)} ${r(w - pk)} ${r(d2 + K2 * sw)} ${r(w - pk)} ${r(d2 + sw)}`;
	for (let i = 0; i < sideMid; i++) {
		const y = d2 + (i + 1) * sw;
		if (i % 2 === 0)
			d += ` C ${r(w - pk)} ${r(y + K1 * sw)} ${r(w - d2)} ${r(y + K2 * sw)} ${r(w - d2)} ${r(y + sw)}`;
		else
			d += ` C ${r(w - d2)} ${r(y + K1 * sw)} ${r(w - pk)} ${r(y + K2 * sw)} ${r(w - pk)} ${r(y + sw)}`;
	}
	d += ` C ${r(w - pk)} ${r(h - d2 - K2 * sw)} ${r(w)} ${r(h - a)} ${r(w - d2)} ${r(h - d2)}`;

	d += ` C ${r(w - a)} ${r(h)} ${r(w - d2 - K2 * tw)} ${r(h - pk)} ${r(w - d2 - tw)} ${r(h - pk)}`;
	for (let i = 0; i < topMid; i++) {
		const x = w - d2 - (i + 1) * tw;
		if (i % 2 === 0)
			d += ` C ${r(x - K1 * tw)} ${r(h - pk)} ${r(x - K2 * tw)} ${r(h - d2)} ${r(x - tw)} ${r(h - d2)}`;
		else
			d += ` C ${r(x - K1 * tw)} ${r(h - d2)} ${r(x - K2 * tw)} ${r(h - pk)} ${r(x - tw)} ${r(h - pk)}`;
	}
	d += ` C ${r(d2 + K2 * tw)} ${r(h - pk)} ${r(a)} ${r(h)} ${r(d2)} ${r(h - d2)}`;

	d += ` C 0 ${r(h - a)} ${r(pk)} ${r(h - d2 - K2 * sw)} ${r(pk)} ${r(h - d2 - sw)}`;
	for (let i = 0; i < sideMid; i++) {
		const y = h - d2 - (i + 1) * sw;
		if (i % 2 === 0)
			d += ` C ${r(pk)} ${r(y - K1 * sw)} ${r(d2)} ${r(y - K2 * sw)} ${r(d2)} ${r(y - sw)}`;
		else
			d += ` C ${r(d2)} ${r(y - K1 * sw)} ${r(pk)} ${r(y - K2 * sw)} ${r(pk)} ${r(y - sw)}`;
	}
	d += ` C ${r(pk)} ${r(d2 + K2 * sw)} 0 ${r(a)} ${r(d2)} ${r(d2)}`;

	return d + ' Z';
}

function makeAction(pathFn) {
	return function (node, params = {}) {
		let ws = typeof params === 'number' ? params : (params.ws ?? 6);
		let active = typeof params === 'number' ? true : (params.active ?? false);
		let ro = null;

		function refresh() {
			if (!active) {
				if (ro) { ro.disconnect(); ro = null; }
				node.style.clipPath = '';
				return;
			}
			const w = node.offsetWidth;
			const h = node.offsetHeight;
			const path = pathFn(w, h, ws);
			node.style.clipPath = path ? `path('${path}')` : '';
			if (!ro) {
				ro = new ResizeObserver(() => refresh());
				ro.observe(node);
			}
		}

		refresh();

		return {
			update(newParams) {
				ws = typeof newParams === 'number' ? newParams : (newParams.ws ?? 6);
				active = typeof newParams === 'number' ? true : (newParams.active ?? false);
				refresh();
			},
			destroy() {
				if (ro) ro.disconnect();
				node.style.clipPath = '';
			}
		};
	};
}

export const starburstClip = makeAction(starburstPath);
export const scallopedClip = makeAction(scallopPath);
