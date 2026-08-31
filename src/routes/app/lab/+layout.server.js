import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

// The Lab is hidden from App Store review accounts.
//
// Everything in here is in-progress coursework tooling — half-built
// experiments, a projector marquee, GIF renderers. To a reviewer with no
// class context it reads as unfinished software (Guideline 2.1), and it isn't
// what the app is being reviewed for. They get a placeholder instead.
//
// The signal is the DEMO CLASS, not a hardcoded account: `classes.auto_approve
// = 1` is what marks a self-contained review class (currently `idc-review`),
// and it's how the reviewer gets in whether they use the demo credentials or
// exercise Sign in with Apple themselves. A real student is never in one.
export async function load({ locals, url }) {
	const session = await locals.auth();

	// Instructors always see the real Lab — they're never in the demo class,
	// but this makes that explicit rather than implied by the query.
	if (!session?.user || session.user.role === 'instructor') return { labPlaceholder: false };

	const db = getDb();
	if (!db) return { labPlaceholder: false };

	const demo = await db.execute({
		sql: `SELECT 1 FROM class_memberships cm
		      JOIN classes c ON c.id = cm.class_id
		      WHERE cm.user_id = ? AND cm.status = 'approved' AND c.auto_approve = 1
		      LIMIT 1`,
		args: [session.user.id]
	});
	const labPlaceholder = demo.rows.length > 0;

	// The index renders the placeholder in place of the tool grid; every tool
	// underneath it is sent back there, so a deep link doesn't walk around it.
	if (labPlaceholder && url.pathname !== '/app/lab') redirect(303, '/app/lab');

	return { labPlaceholder };
}
