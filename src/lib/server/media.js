import sharp from 'sharp';

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

// Convert any image buffer to WebP, returns { buffer, mimetype, ext }
export async function toWebp(inputBuffer) {
	const buf = await sharp(inputBuffer).webp({ quality: 90 }).toBuffer();
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
