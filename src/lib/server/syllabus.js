import { getAdminDb } from '$lib/server/firebase-admin.js';

/**
 * Week titles from the class's KEY syllabus, keyed by sequential week
 * number (1-based, non-hidden week blocks in position order — the same
 * numbering the syllabus document renders).
 *
 * Used to give class week plans their default subtitle: the week's
 * heading stays whatever the instructor entered ("Week of …"), and the
 * subtitle underneath is derived from the key syllabus.
 *
 * Returns {} when no key syllabus is set (or on any failure) — callers
 * treat subtitles as strictly optional.
 */
/**
 * Full week outline from the class's KEY syllabus, in document order:
 * [{ week, title, weekOf, topics: [text, …] }]. Hidden week blocks and
 * hidden/empty topics are excluded — this mirrors exactly what the
 * rendered syllabus document shows.
 *
 * Used by the Roadmap (/app/orbit) syllabus section. Returns [] when no
 * key syllabus is set (or on any failure) — callers treat it as optional.
 */
export async function getKeySyllabusOutline(classId) {
	try {
		const db = getAdminDb();
		const keySnap = await db.ref(`syllabiKey/${classId}`).get();
		const keyId = keySnap.val();
		if (!keyId) return [];
		const [snap, wdSnap] = await Promise.all([
			db.ref(`syllabi/${classId}/${keyId}/blocks`).get(),
			db.ref(`syllabi/${classId}/${keyId}/weekDatesJson`).get()
		]);
		if (!snap.exists()) return [];
		let weekDates = {};
		try { weekDates = JSON.parse(wdSnap.val() ?? '{}'); } catch { /**/ }
		const blocks = Object.values(snap.val() ?? {})
			.filter((b) => b && b.type === 'week' && !b.hidden)
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
		const out = [];
		let n = 0;
		for (const b of blocks) {
			n += 1;
			let d = {};
			try { d = JSON.parse(b.content); } catch { /**/ }
			out.push({
				week: n,
				title: d.title ?? '',
				weekOf: weekDates[n] ?? d.weekOf ?? null,
				topics: (d.topics ?? [])
					.filter((t) => t && !t.hidden && (t.text ?? '').trim())
					.map((t) => t.text.trim())
			});
		}
		return out;
	} catch {
		return [];
	}
}

export async function getKeySyllabusWeeks(classId) {
	try {
		const db = getAdminDb();
		const keySnap = await db.ref(`syllabiKey/${classId}`).get();
		const keyId = keySnap.val();
		if (!keyId) return {};
		const [snap, wdSnap] = await Promise.all([
			db.ref(`syllabi/${classId}/${keyId}/blocks`).get(),
			db.ref(`syllabi/${classId}/${keyId}/weekDatesJson`).get()
		]);
		if (!snap.exists()) return {};
		let weekDates = {};
		try { weekDates = JSON.parse(wdSnap.val() ?? '{}'); } catch { /**/ }
		const blocks = Object.values(snap.val() ?? {})
			.filter((b) => b && b.type === 'week' && !b.hidden)
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
		const out = {};
		let n = 0;
		for (const b of blocks) {
			n += 1;
			try {
				const d = JSON.parse(b.content);
				out[n] = { title: d.title ?? '', weekOf: weekDates[n] ?? d.weekOf ?? null };
			} catch {
				out[n] = { title: '', weekOf: weekDates[n] ?? null };
			}
		}
		return out;
	} catch {
		return {};
	}
}
