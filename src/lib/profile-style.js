/**
 * Profile customization presets — shared by the profile page (render +
 * customizer UI) and /api/profile-style (server-side validation).
 *
 * A user's style is a JSON blob on users.profile_style:
 *   { bg, font, fx, sig }
 *   bg   — gradient preset id from GRADIENTS
 *   font — display font id from FONTS (applies to the profile name)
 *   fx   — mouse-effect id from EFFECTS (canvas particles on the page)
 *   sig  — signature expression: an emoji or inline emote token
 *          ([tg:..] / [tgc:pack:id] / [ce:short] / emoji-kitchen), shown
 *          big next to the name and animated when the emote is animated.
 */

export const GRADIENTS = [
	{ id: 'none',    label: 'Plain',      css: null },
	{ id: 'sunset',  label: 'Sunset',     css: 'linear-gradient(135deg, #ff9a8b 0%, #ff6a88 40%, #ff99ac 70%, #fecfef 100%)' },
	{ id: 'ocean',   label: 'Ocean',      css: 'linear-gradient(135deg, #2e3192 0%, #1bffff 100%)' },
	{ id: 'candy',   label: 'Candy',      css: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 55%, #f68084 100%)' },
	{ id: 'vapor',   label: 'Vaporwave',  css: 'linear-gradient(135deg, #ff71ce 0%, #b967ff 35%, #01cdfe 70%, #05ffa1 100%)' },
	{ id: 'forest',  label: 'Forest',     css: 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)' },
	{ id: 'lava',    label: 'Lava',       css: 'linear-gradient(135deg, #f83600 0%, #f9d423 100%)' },
	{ id: 'aurora',  label: 'Aurora',     css: 'linear-gradient(135deg, #12002a 0%, #4e03ca 30%, #0090ff 60%, #05ffa1 100%)' },
	{ id: 'goth',    label: 'Goth',       css: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' }
];

export const FONTS = [
	// 'default' keeps the pre-customization look (profile names were
	// always Avara), so untouched profiles render exactly as before.
	{ id: 'default',    label: 'Avara',      css: "'Avara', serif" },
	{ id: 'sans',       label: 'Sans',       css: "'Google Sans Flex', 'Space Grotesk', sans-serif" },
	{ id: 'cambridge',  label: 'Cambridge',  css: "'Cambridge', serif" },
	{ id: 'grotesk',    label: 'Grotesk',    css: "'Space Grotesk', sans-serif" },
	{ id: 'typewriter', label: 'Typewriter', css: "'Courier New', monospace" },
	{ id: 'comic',      label: 'Comic',      css: "'Comic Sans MS', 'Comic Sans', cursive" },
	{ id: 'impact',     label: 'Impact',     css: "'Impact', 'Arial Black', sans-serif" }
];

export const EFFECTS = [
	{ id: 'none',     label: 'None',     emoji: '🚫' },
	{ id: 'sparkles', label: 'Sparkles', emoji: '✨' },
	{ id: 'hearts',   label: 'Hearts',   emoji: '💗' },
	{ id: 'confetti', label: 'Confetti', emoji: '🎉' },
	{ id: 'bubbles',  label: 'Bubbles',  emoji: '🫧' },
	{ id: 'trail',    label: 'Glow trail', emoji: '🌠' }
];

const gradientIds = new Set(GRADIENTS.map(g => g.id));
const fontIds = new Set(FONTS.map(f => f.id));
const effectIds = new Set(EFFECTS.map(e => e.id));

/** Clamp an arbitrary object down to a valid style. Unknown ids fall
 *  back to defaults; sig is length-capped (tokens are short — a 200-char
 *  "sig" is someone pasting a paragraph, not an emote). */
export function sanitizeStyle(raw) {
	const s = raw && typeof raw === 'object' ? raw : {};
	return {
		bg: gradientIds.has(s.bg) ? s.bg : 'none',
		font: fontIds.has(s.font) ? s.font : 'default',
		fx: effectIds.has(s.fx) ? s.fx : 'none',
		sig: typeof s.sig === 'string' ? s.sig.slice(0, 200) : ''
	};
}

export function parseStyle(json) {
	try { return sanitizeStyle(JSON.parse(json ?? '')); }
	catch { return sanitizeStyle(null); }
}
