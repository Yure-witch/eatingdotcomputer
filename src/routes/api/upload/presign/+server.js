import { json, error } from '@sveltejs/kit';
import { presignPutToR2 } from '$lib/server/r2.js';
import { allowedTypesFor, maxBytesFor, maxLabelFor } from '$lib/submission-types.js';

/**
 * Hand the browser a short-lived URL to PUT a submission straight to R2.
 *
 * Submissions used to travel inside the form POST, which put the whole file in
 * a serverless function's request body — capped at ~4.5MB on Vercel. A photo
 * off a phone is 3-8MB and a video is far more, so the platform rejected the
 * request before any of our code ran: no error to catch, nothing in the logs,
 * and a student who simply could not hand anything in.
 *
 * The KEY is built here, never taken from the client: it pins the upload to
 * this student and this item, which is what lets the action that records the
 * submission trust the key it is handed back.
 */
export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session?.user?.id) error(401, 'Not logged in');

	const body = await request.json().catch(() => null);
	const itemId = String(body?.itemId ?? '').trim();
	const kind = String(body?.kind ?? '').trim();          // 'image' | 'video'
	const contentType = String(body?.contentType ?? '').trim();
	const size = Number(body?.size ?? 0);
	const filename = String(body?.filename ?? '');

	if (!itemId || !/^[A-Za-z0-9_-]{1,64}$/.test(itemId)) error(400, 'Bad item');
	const allowed = allowedTypesFor(kind);
	if (!allowed.length) error(400, 'Bad submission kind');
	if (!allowed.includes(contentType)) error(415, `That file type isn't accepted for ${kind}`);
	if (!Number.isFinite(size) || size <= 0) error(400, 'Bad size');
	if (size > maxBytesFor(kind)) error(413, `File too large (max ${maxLabelFor(kind)})`);

	// Same shape the action has always written, so nothing downstream changes.
	const ext = (filename.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
	const key = `submissions/${itemId}/${session.user.id}/${crypto.randomUUID()}.${ext}`;

	try {
		const url = await presignPutToR2(key, contentType);
		return json({ url, key });
	} catch {
		// The caller falls back to posting the file through the action, which
		// still works for anything under the platform's body cap.
		error(503, 'Direct upload unavailable');
	}
}
