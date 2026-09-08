const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function fitBox(box, width, height) {
	const w = clamp(box.w, Math.min(48, width), width);
	const h = clamp(box.h, Math.min(48, height), height);
	return { x: clamp(box.x, 0, width - w), y: clamp(box.y, 0, height - h), w, h };
}

export function dragBox(box, handle, dx, dy, width, height) {
	if (handle === 'move') return fitBox({ ...box, x: box.x + dx, y: box.y + dy }, width, height);
	let left = box.x, top = box.y, right = box.x + box.w, bottom = box.y + box.h;
	const minW = Math.min(48, width), minH = Math.min(48, height);
	if (handle.includes('w')) left = clamp(left + dx, 0, right - minW);
	if (handle.includes('e')) right = clamp(right + dx, left + minW, width);
	if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minH);
	if (handle.includes('s')) bottom = clamp(bottom + dy, top + minH, height);
	return { x: left, y: top, w: right - left, h: bottom - top };
}

function axisSlices(source, target, scale, middle) {
	const center = clamp(Math.round(source * middle), 1, source);
	const first = Math.floor((source - center) / 2), last = source - center - first;
	// Compress the caps together when squashing; the middle never becomes negative.
	const capScale = Math.min(scale, Math.max(0, target - 1) / Math.max(1, first + last));
	const a = Math.round(first * capScale), b = Math.round(target - last * capScale);
	return { source: [0, first, first + center, source], target: [0, a, b, target] };
}

export function stretchPatches(sourceW, sourceH, width, height, baseSize = 160, middle = 0.08) {
	const scale = baseSize / Math.max(sourceW, sourceH);
	const x = axisSlices(sourceW, width, scale, middle);
	const y = axisSlices(sourceH, height, scale, middle);
	const patches = [];
	for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
		const sw = x.source[col + 1] - x.source[col], sh = y.source[row + 1] - y.source[row];
		const dw = x.target[col + 1] - x.target[col], dh = y.target[row + 1] - y.target[row];
		if (sw > 0 && sh > 0 && dw > 0 && dh > 0) {
			patches.push([x.source[col], y.source[row], sw, sh, x.target[col], y.target[row], dw, dh]);
		}
	}
	return patches;
}

export function drawStretched(canvas, source, width, height, baseSize = 160, middle = 0.08) {
	canvas.width = Math.max(1, Math.round(width));
	canvas.height = Math.max(1, Math.round(height));
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	for (const patch of stretchPatches(source.width, source.height, canvas.width, canvas.height, baseSize, middle)) {
		ctx.drawImage(source, ...patch);
	}
}

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const mixPoint = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function resampleTrail(points, spacing = 3, limit = 700) {
	const clean = [];
	for (const p of points) {
		if (Number.isFinite(p.x) && Number.isFinite(p.y) && (!clean.length || distance(clean.at(-1), p) > 0.001)) clean.push(p);
	}
	if (clean.length < 2) return clean.map((p) => ({ ...p }));
	const lengths = [0];
	for (let i = 1; i < clean.length; i++) lengths.push(lengths[i - 1] + distance(clean[i - 1], clean[i]));
	const total = lengths.at(-1);
	const steps = Math.max(1, Math.min(limit - 1, Math.ceil(total / spacing)));
	const result = [{ ...clean[0] }];
	let segment = 1;
	for (let i = 1; i < steps; i++) {
		const at = total * i / steps;
		while (segment < clean.length - 1 && lengths[segment] < at) segment++;
		result.push(mixPoint(clean[segment - 1], clean[segment], (at - lengths[segment - 1]) / (lengths[segment] - lengths[segment - 1])));
	}
	result.push({ ...clean.at(-1) });
	return result;
}

export function appendTrail(points, point) {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return points;
	let next = points.slice();
	if (next.length > 2 && distance(next.at(-2), point) < 4) next[next.length - 1] = point;
	else if (!next.length || distance(next.at(-1), point) > 0.1) next.push(point);
	// Bound long drawing sessions without dropping the anchored end of the emoji.
	if (next.length > 2048) next = resampleTrail(next, 1, 1536);
	return next;
}

export function trailBounds(points, padding = 0) {
	if (!points.length) return { x: 0, y: 0, w: 1, h: 1 };
	let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
	for (const p of points) {
		left = Math.min(left, p.x); right = Math.max(right, p.x);
		top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
	}
	return { x: left - padding, y: top - padding, w: Math.max(1, right - left + padding * 2), h: Math.max(1, bottom - top + padding * 2) };
}

export function fitTrail(points, thickness, width, height) {
	const padding = Math.min(thickness / 2 + 2, width / 2 - 1, height / 2 - 1);
	const b = trailBounds(points);
	const scale = Math.min(1, (width - padding * 2) / b.w, (height - padding * 2) / b.h);
	const x = clamp(b.x, padding, width - padding - b.w * scale);
	const y = clamp(b.y, padding, height - padding - b.h * scale);
	return points.map((p) => ({ x: x + (p.x - b.x) * scale, y: y + (p.y - b.y) * scale }));
}

export function moveTrail(points, dx, dy, thickness, width, height) {
	const b = trailBounds(points, thickness / 2 + 2);
	dx = clamp(dx, -b.x, width - b.x - b.w);
	dy = clamp(dy, -b.y, height - b.y - b.h);
	return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function snakeGeometry(points, sourceW, sourceH, thickness, middle = 0.08) {
	let curve = resampleTrail(points, 5, 900);
	// Two corner-cutting passes soften pointer jitter while preserving both tips.
	for (let pass = 0; pass < 2 && curve.length > 2; pass++) {
		const smooth = [curve[0]];
		for (let i = 0; i < curve.length - 1; i++) {
			smooth.push(mixPoint(curve[i], curve[i + 1], 0.25), mixPoint(curve[i], curve[i + 1], 0.75));
		}
		smooth.push(curve.at(-1)); curve = smooth;
	}
	curve = resampleTrail(curve, 3, 700);
	if (curve.length < 2) return { sections: [], bounds: trailBounds(curve, thickness / 2), length: 0 };
	const lengths = [0];
	for (let i = 1; i < curve.length; i++) lengths.push(lengths[i - 1] + distance(curve[i - 1], curve[i]));
	const total = lengths.at(-1);
	const cap = sourceW * (1 - clamp(middle, 0.02, 1)) / 2;
	const capLength = Math.min(cap * thickness / sourceH, total * 0.49);
	const sourceX = (at) => {
		if (capLength > 0 && at < capLength) return at / capLength * cap;
		if (capLength > 0 && at > total - capLength) return sourceW - (total - at) / capLength * cap;
		return cap + (at - capLength) / (total - capLength * 2) * (sourceW - cap * 2);
	};
	const sections = curve.map((p, i) => {
		let a = curve[Math.max(0, i - 1)], b = curve[Math.min(curve.length - 1, i + 1)];
		if (distance(a, b) < 0.001) { a = p; b = curve[i + 1] || curve[i - 1]; }
		const length = distance(a, b) || 1;
		const nx = -(b.y - a.y) / length * thickness / 2, ny = (b.x - a.x) / length * thickness / 2;
		return { u: sourceX(lengths[i]), top: { x: p.x - nx, y: p.y - ny }, bottom: { x: p.x + nx, y: p.y + ny } };
	});
	return { sections, bounds: trailBounds(sections.flatMap((s) => [s.top, s.bottom]), 2), length: total };
}

function drawTriangle(ctx, source, vertices, transform) {
	ctx.save();
	ctx.beginPath();
	// Tiny overlap hides canvas clip antialias seams between adjacent mesh triangles.
	const center = { x: vertices.reduce((n, p) => n + p.x, 0) / 3, y: vertices.reduce((n, p) => n + p.y, 0) / 3 };
	vertices.forEach((p, i) => {
		const len = distance(center, p) || 1;
		const x = p.x + (p.x - center.x) / len * 0.35, y = p.y + (p.y - center.y) / len * 0.35;
		if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
	});
	ctx.closePath(); ctx.clip(); ctx.transform(...transform);
	ctx.drawImage(source, 0, 0); ctx.restore();
}

export function drawSnake(canvas, source, points, thickness, middle, { width, height, scale = 1, offsetX = 0, offsetY = 0 }) {
	canvas.width = Math.max(1, Math.ceil(width * scale));
	canvas.height = Math.max(1, Math.ceil(height * scale));
	const ctx = canvas.getContext('2d');
	ctx.setTransform(scale, 0, 0, scale, offsetX * scale, offsetY * scale);
	ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
	const geometry = snakeGeometry(points, source.width, source.height, thickness, middle);
	const { sections } = geometry;
	// Map narrow pieces of ONE image along the curve, rather than stamping copies.
	for (let i = 1; i < sections.length; i++) {
		const a = sections[i - 1], b = sections[i], du = b.u - a.u, h = source.height;
		if (du < 0.000001) continue;
		let xx = (b.top.x - a.top.x) / du, xy = (b.top.y - a.top.y) / du;
		let yx = (b.bottom.x - b.top.x) / h, yy = (b.bottom.y - b.top.y) / h;
		drawTriangle(ctx, source, [a.top, b.top, b.bottom], [xx, xy, yx, yy, a.top.x - xx * a.u, a.top.y - xy * a.u]);
		xx = (b.bottom.x - a.bottom.x) / du; xy = (b.bottom.y - a.bottom.y) / du;
		yx = (a.bottom.x - a.top.x) / h; yy = (a.bottom.y - a.top.y) / h;
		drawTriangle(ctx, source, [a.top, b.bottom, a.bottom], [xx, xy, yx, yy, a.top.x - xx * a.u, a.top.y - xy * a.u]);
	}
	return geometry;
}

export function rasterizeEmoji(emoji) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 512;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.font = '380px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(emoji, 256, 256);
	const { data } = ctx.getImageData(0, 0, 512, 512);
	let left = 512, top = 512, right = 0, bottom = 0;
	for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
		if (data[(y * 512 + x) * 4 + 3] > 0) {
			left = Math.min(left, x); top = Math.min(top, y);
			right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
		}
	}
	if (right <= left || bottom <= top) throw new Error('Choose an emoji to stretch.');
	const cropped = document.createElement('canvas');
	cropped.width = right - left; cropped.height = bottom - top;
	cropped.getContext('2d').drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
	return cropped;
}
