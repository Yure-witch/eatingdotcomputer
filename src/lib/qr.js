import qrcode from 'qrcode-generator';

/**
 * QR code as a self-contained SVG string.
 *
 * SVG rather than canvas because the marquee draws its QR at wildly different
 * sizes — a corner chip while something is playing, then a half-screen "scan
 * me" panel between phrases — and a rasterised QR that gets scaled up is
 * exactly the kind of soft-edged QR phones give up on.
 *
 * Error-correction level M with a 4-module quiet zone: the code is being read
 * off a projector across a room, so it needs to survive both keystone
 * distortion and whatever the projector does to contrast.
 *
 * @param {string} text     what the code encodes (a URL, here)
 * @param {object} [opts]
 * @param {string} [opts.dark]   module colour
 * @param {string} [opts.light]  background colour ('none' for transparent)
 * @param {number} [opts.margin] quiet zone, in modules
 */
export function qrSvg(text, { dark = '#000000', light = '#ffffff', margin = 4 } = {}) {
	// typeNumber 0 = pick the smallest version that fits the data.
	const qr = qrcode(0, 'M');
	qr.addData(String(text ?? ''));
	qr.make();

	const n = qr.getModuleCount();
	const size = n + margin * 2;

	// One path for every dark module, with runs merged along each row: a QR of
	// ~1000 modules as 1000 <rect>s is a lot of DOM for something that redraws
	// on every room-code change.
	let d = '';
	for (let r = 0; r < n; r++) {
		let run = 0;
		for (let c = 0; c <= n; c++) {
			const on = c < n && qr.isDark(r, c);
			if (on) { run++; continue; }
			if (run) {
				d += `M${c - run + margin} ${r + margin}h${run}v1h-${run}z`;
				run = 0;
			}
		}
	}

	const bg = light === 'none' ? '' : `<rect width="${size}" height="${size}" fill="${light}"/>`;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
		`shape-rendering="crispEdges" role="img" aria-label="QR code">` +
		`${bg}<path d="${d}" fill="${dark}"/></svg>`
	);
}
