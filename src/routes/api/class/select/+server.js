import { json, error } from '@sveltejs/kit';

export async function POST({ request, locals, cookies }) {
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') error(403, 'Forbidden');

	const { class_id } = await request.json();
	if (!class_id) error(400, 'class_id required');

	cookies.set('selected_class_id', class_id, {
		path: '/',
		httpOnly: true,
		maxAge: 60 * 60 * 24 * 365,
		sameSite: 'lax'
	});

	return json({ ok: true });
}
