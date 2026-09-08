// Students the instructor has pre-cleared, matched on their display name.
//
// A join request normally waits for a human. These names skip that queue: the
// membership is approved the moment the request is filed and the student goes
// straight into the app instead of the "waiting for approval" screen.
//
// ── Read this before adding a name ────────────────────────────────────────
// The name is SELF-DECLARED. It comes from the onboarding profile step, so
// anyone who signs up and types "Yuval" gets into the class without review.
// That is the deal this rule makes, and it is only sane for a short list the
// instructor is actively expecting. It is not an identity check.
//
// Two things blunt it: matching is on WHOLE name tokens, so "Harelson" or
// "Yuvalov" don't match; and every auto-approval pushes a notification to the
// instructors saying who came in this way, so an impostor is visible rather
// than silent. Neither makes it an authentication boundary — if this list ever
// grows past a handful of expected people, swap it for invite codes or an
// email-domain rule.
//
// Remove a name once the person is in. A stale entry is a standing hole.
export const PRE_APPROVED_NAMES = [
	// Added 2026-09-08 at Ricky's request — joins as "Yuval Harel" or
	// "Harel Yuval", and either name alone should match.
	'yuval',
	'harel'
];

/**
 * Normalise for comparison: lowercase, strip diacritics, split on anything
 * that isn't a letter or digit. "Yuval-Harel" and "Yuval  Harel" both become
 * ['yuval','harel'].
 */
function tokens(name) {
	return String(name ?? '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

/**
 * Does this display name match the pre-cleared list?
 *
 * Whole-token equality, in either order and in any position, so "Yuval Harel",
 * "Harel Yuval", "Yuval" and "Harel" all match while "Harelson" does not.
 *
 * @param {string} name
 * @returns {string | null} the token that matched, for the audit line, or null
 */
export function preApprovedMatch(name) {
	const list = new Set(PRE_APPROVED_NAMES.map((n) => n.toLowerCase()));
	for (const t of tokens(name)) if (list.has(t)) return t;
	return null;
}
