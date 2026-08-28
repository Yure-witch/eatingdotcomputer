// Marquee — the ricky.now kinetic-type reel, as live scenes.
//
// These are the EXACT eight looks in the ricky.now header carousel, in the
// order they run there (the site serves pre-rendered 1280x720 H.264; the
// canonical archive is artifacts/kinetic-type/). Here they run live off the
// same gen-art engine so the text can be swapped at runtime — which is the
// whole point of the marquee: the animation is ours, the words are the room's.
//
// Not included: `blobc3` (Blob 3-C). It's a ninth preset on ricky.now's
// /kinetictype page but was never part of the rendered reel, and the reel is
// what this mirrors.
//
// `opts` is copied from artifacts/kinetic-type/variations.json, which pins the
// render-true options per mode (with one exception — see `duration` below). Do
// not "tidy" the values: several modes have
// no selectMode branch in the studio, so their canonical look only exists as
// these explicit numbers (see the kinetic-render-pipeline notes). Every scene
// reads its options with `?? default`, so a partial object is fine — but a
// wrong one is silently a different look.
//
// Two things that are NOT free parameters:
//
//   `duration` is the loop PERIOD, not a length — the flip scenes divide it by
//   their segment count (`phase * n` in sceneCoin / sceneSphere / sceneTypeOrb)
//   to get seconds-per-segment. A fixed duration would make a nine-word
//   submission flicker past at 0.3s a word, so Coin and Sphere derive theirs
//   from the text at 1.5s a word. Type Orbit does NOT: its segments are pipe
//   GROUPS, not words, and there are always two of them (see orbitText).
//
//   variations.json is wrong about Coin and Sphere specifically — it says
//   duration 3 and 6, but the reel's files are 1.5s and 3.0s and both loop
//   seamlessly, which is only possible at duration = file length (verified by
//   stepping both scenes: at duration 1.5/3 the last frame is bit-identical to
//   frame 0; at 3/6 it differs as much as any unrelated frame). Coin's `pitch`
//   also swings over the FULL period (gen-art.js:4859), so a half-period trim
//   could never have been seamless. Trust the file lengths for those two.
//
//   `fps` is a look, not a smoothness setting. Garble's reel frame is 4fps and
//   that chunky shuffle IS the effect; run it at display rate and it turns to
//   fizz. The sims (BZ) advance per CALL rather than per second and have to
//   keep their fixed step. Everything else is genuinely time-based and looks
//   better at whatever the display can give it.

const words = (t) => String(t ?? '').trim().split(/\s+/).filter(Boolean);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Type Orbit's text syntax (gen-art.js ~5493): with a `|` anywhere in the text
// the unit stops being the word and becomes the pipe-separated GROUP — the
// whole group displays at once, `/` breaks a line inside it, and the ring
// hands off from group to group. So the segment count is the GROUP count, not
// the word count.
//
// Pack the phrase into a lockup of two or three lines, then put the SAME
// lockup in both groups, which is what the reel does ("YOUR TEXT | YOUR TEXT"
// with one phrase in both slots). Two identical lockups make the hand-off read
// as one piece rotating through itself; two different halves turn that
// rotation into a content change, and the reader never sees the whole phrase
// at once.
function orbitLockup(text) {
	const w = words(text);
	if (!w.length) return String(text ?? '');
	const chars = w.join(' ').length;
	// ~10 characters a line, which is the reel's own shape: 26 characters over
	// the three lines of ARE SOME / KINETIC / TYPOGRAPHY.
	const lines = clamp(Math.round(chars / 10), 1, 3);
	const budget = chars / lines;
	const out = [[]];
	let len = 0;
	for (const word of w) {
		// Break when this line has met its share AND there are still enough
		// words left to fill every remaining line — otherwise the last line
		// comes out empty.
		if (len >= budget && out.length < lines && w.length - out.flat().length >= lines - out.length) {
			out.push([]);
			len = 0;
		}
		out[out.length - 1].push(word);
		len += word.length + 1;
	}
	return out.map((l) => l.join(' ')).join('/');
}
function orbitText(text) {
	const lockup = orbitLockup(text);
	return `${lockup} | ${lockup}`;
}

// The reel's word-flip cadence, generalised: 1.5s per word for Coin and Sphere.
const perWord = (secs, lo, hi) => (text) => clamp(Math.max(1, words(text).length) * secs, lo, hi);

export const MARQUEE_SET = [
	{
		id: 'clouds',
		name: 'Clouds',
		mode: 'clouds',
		dwell: 12000, // one drift lap — it's already the longest loop in the set
		opts: {
			preset: 'spotlight', cycles: 1, duration: 12, reactionSpeed: 1.5,
			cloudSeedM: 0, cloudSeedP: 0, cloudScatter: 1, cloudEnv: 0.6, cloudEnvAll: false,
			cloudTilt: 0.25, cloudLightX: -0.15, cloudLightZ: 0.9, cloudWisp: 0.4,
			cloudSolid: 0, cloudShadow: 0.05, cloudSeedT: 0, cloudWispSpread: 0.3,
			cloudVeil: 0.35, cloudTime: 0.3333, cloudTimeText: 0.3333, cloudTimeLink: true,
			cloudDayCycle: false, cloudRain: 0, cloudSnow: 0, cloudFog: 0,
			bg: '#0b0b10', bg2: '#1a1030', fg: '#ffffff', accent: '#7c9cff', bgType: 'radial'
		}
	},
	{
		id: 'coin',
		name: 'Coin',
		mode: 'coin',
		duration: perWord(1.5, 1.5, 12),
		opts: {
			preset: 'spotlight', cycles: 1, reactionSpeed: 1.5,
			coinInk: '#0000ff', coinInk2: '#ff2d2d', coinInkGrad: false, coinInkAnim: false,
			coinBg: 'light', coinBodyMode: 'auto', coinBodyColor: '#ffffff', coinBodyColor2: '#ffe3e3',
			bg: '#ffffff', bg2: '#1a1030', fg: '#0000ff', accent: '#7c9cff', bgType: 'solid'
		}
	},
	{
		id: 'typeorbit',
		name: 'Type Orbit',
		mode: 'typeorb',
		text: orbitText,
		// FIXED, not scaled by word count. The segment count here is the group
		// count (always 2 — the lockup is duplicated), so the reel's 8s over two
		// groups is 4s a group whatever the phrase is. Scaling this with the
		// word count would give a nine-word submission an 8s hand-off, i.e. a
		// lockup that just sits there.
		duration: 8,
		laps: 1,
		opts: {
			preset: 'spotlight', cycles: 1, reactionSpeed: 1.5,
			orbSize: 1, orbWrongDelay: false, orbBez: [0.28, 0, 0.1, 1],
			bg: '#000000', bg2: '#1a1030', fg: '#ffffff', accent: '#7c9cff', bgType: 'solid'
		}
	},
	{
		id: 'bz',
		name: 'BZ Waves',
		mode: 'bz',
		// Reaction-diffusion, so it advances per step rather than per second.
		fps: 30,
		// Long dwell on purpose: a cold start spends its first seconds igniting,
		// and cutting away early shows only the ignition.
		dwell: 16000,
		opts: {
			preset: 'spotlight', cycles: 1, duration: 6, reactionSpeed: 1.5,
			bzRound: 6, bzBands: 20, bzSpacing: 0.4, bzFade: 0.5,
			bg: '#000000', bg2: '#1a1030', fg: '#ffffff', accent: '#7c9cff', bgType: 'solid'
		}
	},
	{
		id: 'sphere',
		name: 'Sphere',
		mode: 'sphere',
		duration: perWord(1.5, 1.5, 12),
		opts: {
			preset: 'spotlight', cycles: 1, reactionSpeed: 1.5,
			sphereTilt: 10,
			coinInk: '#0000ff', coinInk2: '#ff2d2d', coinInkGrad: false, coinInkAnim: false,
			coinBg: 'light', coinBodyMode: 'auto', coinBodyColor: '#ffffff', coinBodyColor2: '#ffe3e3',
			bg: '#ffffff', bg2: '#1a1030', fg: '#0000ff', accent: '#7c9cff', bgType: 'solid'
		}
	},
	{
		id: 'blobc125',
		name: 'Blob 12-5',
		mode: 'blobc125',
		dwell: 12000,
		opts: {
			preset: 'spotlight', cycles: 1, duration: 6, reactionSpeed: 1,
			cmAmount: 0.5, cmGate: 0.12, b3Rows: 1, b3Cols: 1, b3Gap: 0.02, b3Speed: 1,
			bg: '#ffffff', bg2: '#1a1030', fg: '#9ba1a8', accent: '#7c9cff', bgType: 'solid'
		}
	},
	{
		id: 'garble',
		name: 'Garble',
		mode: 'garble',
		fps: 4, // the reel's frame rate, and the reason the shuffle reads as shuffle
		dwell: 16000,
		opts: {
			preset: 'spotlight', cycles: 1, duration: 8, reactionSpeed: 1.5,
			garbleSeed: 0, garbleInks: 4, garbleScheme: 'candy', garbleAmt: 0.6,
			garbleClean: false, garbleAnim: 'shuffle', garbleRecolor: 0.75,
			garbleDrift: 0.35, garbleDriftMag: 0.5, garbleDriftLen: 0.5, garbleVariety: 0.35,
			garbleLeading: 1.25, garbleSize: 'random', garbleShape: 'random',
			garbleUniform: false, garbleForm: 'ellipse', garbleFormStretch: false,
			garbleFormPool: ['ellipse', 'quad', 'star'],
			garbleSizePool: ['xs', 's'],
			garbleShapePool: ['round', 'tall', 'xtall'],
			bg: '#ffffff', bg2: '#1a1030', fg: '#111111', accent: '#7c9cff', bgType: 'solid'
		}
	},
	{
		id: 'heatmap',
		name: 'Heatmap',
		mode: 'heatmap',
		dwell: 12000,
		opts: {
			preset: 'spotlight', cycles: 1, duration: 6, reactionSpeed: 1.5,
			htSize: 1,
			bg: '#ffffff', bg2: '#1a1030', fg: '#111111', accent: '#7c9cff', bgType: 'solid'
		}
	}
];

/** The loop period this variation wants for a given phrase, in seconds. */
export function durationFor(v, text) {
	return typeof v.duration === 'function' ? v.duration(text) : (v.duration ?? v.opts.duration ?? 6);
}

// A slot should be long enough to read and short enough that the reel keeps
// moving. Between these, whole loops decide the exact length.
const MIN_SLOT = 8, MAX_SLOT = 16;

/**
 * How long this variation should hold the screen for a given phrase, in ms.
 *
 * Always a WHOLE number of loops where the look has a period: these animations
 * are built to return to frame 0, and cutting mid-period throws away the one
 * frame where the cut is invisible. A one-word Coin has a 1.5s period, so it
 * gets six flips rather than one lonely one; an eight-word Coin takes 12s to
 * get through the phrase once and gets exactly that.
 */
export function dwellMs(v, text) {
	if (typeof v.dwell === 'function') return v.dwell(text);
	if (v.dwell) return v.dwell;
	const period = durationFor(v, text);
	if (v.laps) return Math.round(period * v.laps * 1000);
	let n = Math.max(1, Math.ceil(MIN_SLOT / period));
	while (n > 1 && period * n > MAX_SLOT) n--;
	return Math.round(period * n * 1000);
}

/**
 * Full option bag for a variation + phrase, in the shape gen-art scenes read
 * (the studio's `liveOpts()`). `hasStretch` comes from the host page —
 * `ctx.fontStretch` support decides whether the `wdth` axis animates at all.
 *
 * Text goes in as typed: casing is a scene transform, not an input. Clouds,
 * Coin, Type Orbit and Sphere upper-case it themselves; BZ, Blob, Garble and
 * Heatmap render it as written. That mixed-case reel is the intended look.
 */
export function optsFor(v, text, { hasStretch = true, fontFrac = 0.3 } = {}) {
	return {
		...v.opts,
		duration: durationFor(v, text),
		text: (v.text ? v.text(text) : text) || ' ',
		subtitle: '',
		fontFamily: "'Google Sans Flex'",
		fontFrac,
		hasStretch
	};
}
