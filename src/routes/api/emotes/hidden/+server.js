import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { requireClassAccess } from '$lib/server/access.js';

// RTDB keys may not contain these. Our keys are `t:<cp>` / `c:<short>:<id>`,
// which are safe, but validate defensively against a spoofed request.
const FORBIDDEN = /[.#$/[\]]/;

// GET: list hidden emotes (any class member — needed to filter their picker).
export async function GET({ locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);
	const snap = await getAdminDb().ref('hiddenEmotes').get().catch(() => null);
	const val = snap?.exists() ? snap.val() : {};
	const hidden = Object.entries(val).map(([key, v]) => ({ key, ...v }));
	return json({ hidden });
}

// POST { action: 'hide'|'unhide', ... }: instructor-only mutation.
export async function POST({ request, locals }) {
	const session = await locals.auth();
	await requireClassAccess(session);
	if (session.user.role !== 'instructor') error(403, 'Instructors only');

	const b = await request.json();
	const action = b.action === 'unhide' ? 'unhide' : 'hide';

	// Resolve the RTDB key from either an explicit key (unhide) or the emote
	// descriptor (hide).
	let key = b.key ? String(b.key) : null;
	if (!key) {
		if (b.type === 'custom' && b.short != null && b.id != null) key = `c:${b.short}:${b.id}`;
		else if (b.cp != null) key = `t:${b.cp}`;
	}
	if (!key || FORBIDDEN.test(key) || key.length > 200) error(400, 'Invalid emote key');

	const node = getAdminDb().ref(`hiddenEmotes/${key}`);
	if (action === 'unhide') {
		await node.remove();
	} else {
		await node.set({
			type: key.startsWith('c:') ? 'custom' : 'tg',
			cp: b.cp ?? null,
			short: b.short ?? null,
			id: b.id != null ? String(b.id) : null,
			alt: (b.alt || '').slice(0, 120),
			by: session.user.id,
			at: Date.now()
		});
	}
	return json({ ok: true, key });
}
