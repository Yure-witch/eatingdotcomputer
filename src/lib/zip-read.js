// Minimal in-browser .zip reader for the Work Archive uploader — enough to
// read what an AI agent, macOS "Compress", or Python's zipfile produces
// (stored + deflate, zip64 sizes), with no dependency. Entries decompress
// lazily via DecompressionStream, so a zip of large videos is never held in
// memory all at once.
//
//   const entries = await readZip(file);   // [{ path, size, getBlob }]

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

async function bytesAt(file, start, length) {
	return new DataView(await file.slice(start, start + length).arrayBuffer());
}
const u64 = (v, o) => Number(v.getBigUint64(o, true));

export async function readZip(file) {
	// End-of-central-directory sits in the last 22..(22 + 65535 comment) bytes.
	const tailLen = Math.min(file.size, 22 + 65535);
	const tail = await bytesAt(file, file.size - tailLen, tailLen);
	let eocd = -1;
	for (let i = tailLen - 22; i >= 0; i--) {
		if (tail.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
	}
	if (eocd < 0) throw new Error('Not a .zip file (no central directory found)');

	let count = tail.getUint16(eocd + 10, true);
	let cdSize = tail.getUint32(eocd + 12, true);
	let cdOffset = tail.getUint32(eocd + 16, true);

	// Zip64: the classic record holds 0xFFFF/0xFFFFFFFF and a locator points
	// at the real numbers.
	if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
		const locAt = eocd - 20;
		if (locAt >= 0 && tail.getUint32(locAt, true) === SIG_EOCD64_LOC) {
			const rec = await bytesAt(file, u64(tail, locAt + 8), 56);
			count = u64(rec, 32);
			cdSize = u64(rec, 40);
			cdOffset = u64(rec, 48);
		}
	}

	const cd = await bytesAt(file, cdOffset, cdSize);
	const utf8 = new TextDecoder('utf-8');
	const entries = [];
	let p = 0;
	for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
		if (cd.getUint32(p, true) !== SIG_CEN) throw new Error('Corrupt .zip central directory');
		const flags = cd.getUint16(p + 8, true);
		const method = cd.getUint16(p + 10, true);
		let compSize = cd.getUint32(p + 20, true);
		let size = cd.getUint32(p + 24, true);
		const nameLen = cd.getUint16(p + 28, true);
		const extraLen = cd.getUint16(p + 30, true);
		const commentLen = cd.getUint16(p + 32, true);
		let localOffset = cd.getUint32(p + 42, true);
		const path = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));

		// Zip64 extended info (header 0x0001) carries whichever fields overflowed,
		// in this fixed order.
		let e = p + 46 + nameLen;
		const eEnd = e + extraLen;
		while (e + 4 <= eEnd) {
			const id = cd.getUint16(e, true);
			const len = cd.getUint16(e + 2, true);
			if (id === 0x0001) {
				let q = e + 4;
				if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
				if (compSize === 0xffffffff) { compSize = u64(cd, q); q += 8; }
				if (localOffset === 0xffffffff) { localOffset = u64(cd, q); }
			}
			e += 4 + len;
		}
		p = eEnd + commentLen;

		if (path.endsWith('/')) continue;           // directory
		if (flags & 1) throw new Error(`"${path}" is encrypted — zip without a password`);
		if (method !== 0 && method !== 8) throw new Error(`"${path}" uses an unsupported compression method`);

		entries.push({
			path,
			size,
			async getBlob() {
				const loc = await bytesAt(file, localOffset, 30);
				if (loc.getUint32(0, true) !== SIG_LOC) throw new Error(`Corrupt entry "${path}"`);
				const start = localOffset + 30 + loc.getUint16(26, true) + loc.getUint16(28, true);
				const raw = file.slice(start, start + compSize);
				if (method === 0) return raw;
				return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
			}
		});
	}
	return entries;
}
