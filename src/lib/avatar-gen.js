// Deterministic generative avatar palette. One seed (uid or name)
// hashes into a stable palette entry + angle so the same user always
// gets the same gradient, no DB write needed.
//
// Aesthetic: edgy. High-chroma electric pairs (hot pink + lime,
// cyan + magenta, ultraviolet + acid yellow) instead of pastel
// dinner-mints. Every entry packs at least one near-saturated stop
// so a member list reads like a strip of stickers — not boilerplate.
//
// Each entry is { a, b, ink } where `ink` is the colour the letter
// uses on top — pre-chosen per palette so contrast holds without a
// runtime calc that occasionally lands on a flat / muddy choice.

const PALETTES = [
	{ a: '#FF0080', b: '#7928CA', ink: '#FFFFFF' }, // hot pink → violet
	{ a: '#00F5A0', b: '#00D9F5', ink: '#0A2E2E' }, // mint → cyan (acid)
	{ a: '#FBD786', b: '#F7797D', ink: '#3A0A1F' }, // peach blush
	{ a: '#FF4E50', b: '#F9D423', ink: '#2A0A00' }, // tomato → marigold
	{ a: '#12C2E9', b: '#C471ED', ink: '#FFFFFF' }, // cyan → orchid
	{ a: '#F953C6', b: '#B91D73', ink: '#FFFFFF' }, // magenta deep
	{ a: '#00C9FF', b: '#92FE9D', ink: '#053D33' }, // sky → fresh lime
	{ a: '#FC466B', b: '#3F5EFB', ink: '#FFFFFF' }, // sunset crush
	{ a: '#FFE000', b: '#799F0C', ink: '#1A1A00' }, // acid yellow
	{ a: '#A8FF78', b: '#78FFD6', ink: '#0A3D2E' }, // green plasma
	{ a: '#FF5F6D', b: '#FFC371', ink: '#330A0A' }, // grapefruit
	{ a: '#7F00FF', b: '#E100FF', ink: '#FFFFFF' }, // ultraviolet
	{ a: '#F0F2F0', b: '#000C40', ink: '#0A1133' }, // ice → midnight
	{ a: '#FF6E7F', b: '#BFE9FF', ink: '#1A0A2E' }, // candy
	{ a: '#43E97B', b: '#38F9D7', ink: '#0A3D2E' }, // mantis → aqua
	{ a: '#FA709A', b: '#FEE140', ink: '#2A0A1F' }, // flamingo flame
	{ a: '#30CFD0', b: '#330867', ink: '#FFFFFF' }, // turquoise abyss
	{ a: '#FF0844', b: '#FFB199', ink: '#FFFFFF' }, // siren
	{ a: '#00DBDE', b: '#FC00FF', ink: '#FFFFFF' }, // electric
	{ a: '#FDFC47', b: '#24FE41', ink: '#0A3D00' }, // hi-vis
	{ a: '#FF9A8B', b: '#FF6A88', ink: '#FFFFFF' }, // coral pop
	{ a: '#74EBD5', b: '#9FACE6', ink: '#0A2E33' }, // mint chrome
	{ a: '#FAACA8', b: '#DDD6F3', ink: '#3D0A2E' }, // wisteria
	{ a: '#08AEEA', b: '#2AF598', ink: '#053D33' }, // arcade blue
	{ a: '#F77062', b: '#FE5196', ink: '#FFFFFF' }, // fuchsia heat
	{ a: '#FEE140', b: '#FA709A', ink: '#2A0A1F' }, // sour blossom
	{ a: '#5EE7DF', b: '#B490CA', ink: '#0A2E33' }, // mermaid
	{ a: '#FAD961', b: '#F76B1C', ink: '#2A0A00' }, // mango
	{ a: '#B721FF', b: '#21D4FD', ink: '#FFFFFF' }, // hyperspace
	{ a: '#F761A1', b: '#8C1BAB', ink: '#FFFFFF' }, // disco pink
	{ a: '#0BA360', b: '#3CBA92', ink: '#FFFFFF' }, // emerald
	{ a: '#FF512F', b: '#DD2476', ink: '#FFFFFF' }  // ruby fire
];

// djb2-style hash. Stable across runs and across SSR / hydration so
// the first paint matches the client.
function hash(seed) {
	let h = 5381;
	for (let i = 0; i < seed.length; i++) {
		h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
	}
	return Math.abs(h);
}

/**
 * Return { a, b, ink, angle } for a given uid (or any stable seed
 * string). Same seed → same result, forever.
 *
 * `angle` is the linear-gradient angle in degrees, hashed off a
 * second-pass salted seed so two users with similar uids don't end
 * up with identical gradient orientations.
 */
export function genPalette(seed) {
	const s = (seed || '').toString() || 'anon';
	const idx = hash(s) % PALETTES.length;
	const angleHash = hash('angle:' + s);
	const angle = (angleHash % 24) * 15; // snap to 15° steps — feels intentional
	return { ...PALETTES[idx], angle };
}

/**
 * Shorthand for components that just want the CSS background string.
 */
export function genBackground(seed) {
	const { a, b, angle } = genPalette(seed);
	return `linear-gradient(${angle}deg, ${a} 0%, ${b} 100%)`;
}
