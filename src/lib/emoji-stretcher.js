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
