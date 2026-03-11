/**
 * Generates 192x192 and 512x512 PNG icons for the PWA manifest.
 * Uses only Node.js built-ins (no extra deps).
 * Color matches --ink (#0c0c0c) on --paper (#f7f2ea).
 */

import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dir, '../static');
mkdirSync(outDir, { recursive: true });

const BG = [247, 242, 234];  // #f7f2ea
const FG = [12, 12, 12];     // #0c0c0c

function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) {
		c ^= b;
		for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
	}
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const typeBytes = Buffer.from(type, 'ascii');
	const crcBytes = Buffer.alloc(4);
	crcBytes.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
	return Buffer.concat([len, typeBytes, data, crcBytes]);
}

function makePNG(size) {
	// Draw a rounded square letter "e" as a simple dot-in-square icon
	const pixels = [];

	const pad = Math.round(size * 0.18);   // background padding
	const r   = Math.round(size * 0.12);   // corner radius of inner square

	for (let y = 0; y < size; y++) {
		pixels.push(0); // filter byte
		for (let x = 0; x < size; x++) {
			const ix = x - pad, iy = y - pad;
			const iw = size - pad * 2;

			// Rounded rect hit test
			const cx = Math.max(r, Math.min(iw - r, ix));
			const cy = Math.max(r, Math.min(iw - r, iy));
			const inside = ix >= 0 && iy >= 0 && ix < iw && iy < iw &&
				Math.hypot(ix - cx, iy - cy) <= r;

			pixels.push(...(inside ? FG : BG));
		}
	}

	const raw = Buffer.from(pixels);
	const compressed = deflateSync(raw);

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8;  // bit depth
	ihdr[9] = 2;  // RGB
	ihdr[10] = ihdr[11] = ihdr[12] = 0;

	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
		chunk('IHDR', ihdr),
		chunk('IDAT', compressed),
		chunk('IEND', Buffer.alloc(0))
	]);
}

for (const size of [192, 512]) {
	const out = join(outDir, `icon-${size}.png`);
	writeFileSync(out, makePNG(size));
	console.log(`wrote ${out}`);
}
