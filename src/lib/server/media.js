import sharp from 'sharp';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;

// Returns true if the image has any non-fully-opaque pixels
export async function hasTransparency(inputBuffer) {
	const { data, info } = await sharp(inputBuffer)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	if (info.channels < 4) return false;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] < 255) return true;
	}
	return false;
}

// Remove solid-color background by making pixels matching `bgColor` transparent.
// bgColor: [r, g, b] — the color to remove. If null, auto-detect from corner pixels.
// tolerance: max per-channel difference (0–255) to still count as "background".
// Supports animated GIFs when passed with { animated: true }.
// Returns { buffer, mimetype, ext } with background removed.
export async function removeBackground(inputBuffer, bgColor = null, tolerance = 30) {
	const meta = await sharp(inputBuffer, { animated: true }).metadata();
	const isAnimated = (meta.pages ?? 1) > 1;

	const { data, info } = await sharp(inputBuffer, { animated: true })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { width, height, channels } = info;
	if (channels < 4) return { buffer: inputBuffer, mimetype: 'image/png', ext: 'png' };

	let bgR, bgG, bgB;
	if (bgColor) {
		[bgR, bgG, bgB] = bgColor;
	} else {
		const frameH = isAnimated ? Math.round(height / meta.pages) : height;
		const corners = [[0, 0], [width - 1, 0], [0, frameH - 1], [width - 1, frameH - 1]];
		const samples = corners.map(([x, y]) => {
			const i = (y * width + x) * 4;
			return [data[i], data[i + 1], data[i + 2]];
		});
		const colorKey = c => `${c[0]},${c[1]},${c[2]}`;
		const freq = {};
		for (const s of samples) { const k = colorKey(s); freq[k] = (freq[k] || 0) + 1; }
		const bgKey = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
		[bgR, bgG, bgB] = bgKey.split(',').map(Number);
	}

	const out = Buffer.from(data);
	for (let i = 0; i < out.length; i += 4) {
		if (Math.abs(out[i] - bgR) <= tolerance &&
			Math.abs(out[i + 1] - bgG) <= tolerance &&
			Math.abs(out[i + 2] - bgB) <= tolerance) {
			out[i + 3] = 0;
		}
	}

	if (isAnimated) {
		const frameH = Math.round(height / meta.pages);
		const delays = meta.delay ?? [];
		const gif = GIFEncoder();
		for (let f = 0; f < meta.pages; f++) {
			const offset = f * width * frameH * 4;
			const rgba = new Uint8Array(out.buffer, out.byteOffset + offset, width * frameH * 4);
			// Ensure fully-transparent pixels have a consistent RGB so they quantize to one entry
			const cleaned = new Uint8Array(rgba.length);
			cleaned.set(rgba);
			for (let i = 0; i < cleaned.length; i += 4) {
				if (cleaned[i + 3] === 0) { cleaned[i] = 0; cleaned[i + 1] = 0; cleaned[i + 2] = 0; }
			}
			const palette = quantize(cleaned, 256, { format: 'rgba4444', oneBitAlpha: true });
			const index = applyPalette(cleaned, palette, 'rgba4444');
			// Find the transparent palette index
			let transparentIndex = 0;
			for (let p = 0; p < palette.length; p += 4) {
				if (palette[p + 3] < 128) { transparentIndex = p / 4; break; }
			}
			gif.writeFrame(index, width, frameH, { palette, delay: delays[f] ?? delays[0] ?? 100, transparent: true, transparentIndex, dispose: 2 });
		}
		gif.finish();
		return { buffer: Buffer.from(gif.bytes()), mimetype: 'image/gif', ext: 'gif' };
	}
	const buf = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
	return { buffer: buf, mimetype: 'image/png', ext: 'png' };
}

// Convert any image buffer to WebP, returns { buffer, mimetype, ext }.
// `animated: true` reads every frame of a GIF / APNG / animated WebP, so the
// output preserves the animation (a dropped GIF → an animated WebP). Static
// images are single-page, so this is a no-op for them.
export async function toWebp(inputBuffer) {
	const buf = await sharp(inputBuffer, { animated: true }).webp({ quality: 90 }).toBuffer();
	return { buffer: buf, mimetype: 'image/webp', ext: 'webp' };
}

// Resize to maxSize×maxSize, convert to WebP
export async function resizeToWebp(inputBuffer, maxSize = 512) {
	const buf = await sharp(inputBuffer)
		.resize(maxSize, maxSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.webp({ quality: 90 })
		.toBuffer();
	return { buffer: buf, mimetype: 'image/webp', ext: 'webp' };
}
