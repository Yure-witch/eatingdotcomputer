import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';

function parseBlocks(rawBlocks) {
	return Object.entries(rawBlocks ?? {})
		.map(([id, b]) => ({ id, type: b.type, content: b.content ?? '', position: Number(b.position ?? 0), hidden: !!b.hidden, ...(b.type === 'section' && b.border === false ? { border: false } : {}) }))
		.sort((a, b) => a.position - b.position);
}

export async function GET({ url, locals }) {
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') error(403, 'Forbidden');

	const classId = url.searchParams.get('classId');
	if (!classId) error(400, 'classId required');

	const syllabusId = url.searchParams.get('syllabusId');
	const db = getAdminDb();

	if (syllabusId) {
		// Load one full syllabus
		const snap = await db.ref(`syllabi/${classId}/${syllabusId}`).get();
		if (!snap.exists()) return json({ blocks: [], font: 'Georgia, serif', margins: 'normal', name: 'Untitled' });
		const val = snap.val();
		const m = val.margins;
		const margins = (m && typeof m === 'object')
			? { top: m.top ?? 64, right: m.right ?? 64, bottom: m.bottom ?? 64, left: m.left ?? 64 }
			: { top: 64, right: 64, bottom: 64, left: 64 };
		const fs = val.fontSizes;
		const fontSizes = (fs && typeof fs === 'object')
			? { title: fs.title ?? 24, section: fs.section ?? 14, text: fs.text ?? 12, weekHeader: fs.weekHeader ?? 12, weekTopic: fs.weekTopic ?? 11 }
			: { title: 24, section: 14, text: 12, weekHeader: 12, weekTopic: 11 };
		const sp = val.spacing;
		const spacing = (sp && typeof sp === 'object')
			? { title: sp.title ?? 0, section: sp.section ?? 6, text: sp.text ?? 6, week: sp.week ?? 8 }
			: { title: 0, section: 6, text: 6, week: 8 };
		const lh = val.lineHeights;
		const lineHeights = (lh && typeof lh === 'object')
			? { title: lh.title ?? 1.2, section: lh.section ?? 1.3, text: lh.text ?? 1.75, weekHeader: lh.weekHeader ?? 1.3, weekTopic: lh.weekTopic ?? 1.65 }
			: { title: 1.2, section: 1.3, text: 1.75, weekHeader: 1.3, weekTopic: 1.65 };
		return json({ blocks: parseBlocks(val.blocks), font: val.font ?? 'Georgia, serif', customFonts: Array.isArray(val.customFonts) ? val.customFonts : [], margins, fontSizes, spacing, lineHeights, name: val.name ?? 'Untitled' });
	} else {
		// List all syllabi for class
		const snap = await db.ref(`syllabi/${classId}`).get();
		if (!snap.exists()) return json({ syllabi: [] });
		const syllabi = Object.entries(snap.val())
			.map(([id, s]) => ({ id, name: s.name ?? 'Untitled', updatedAt: s.updatedAt ?? 0 }))
			.sort((a, b) => b.updatedAt - a.updatedAt);
		return json({ syllabi });
	}
}

export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') error(403, 'Forbidden');

	const { classId, syllabusId, name, blocks, font, customFonts, margins, fontSizes, spacing, lineHeights } = await request.json();
	if (!classId || !syllabusId) error(400, 'classId and syllabusId required');

	const blocksObj = {};
	for (const b of (blocks ?? [])) {
		blocksObj[b.id] = { type: b.type, content: b.content ?? '', position: b.position ?? 0, hidden: b.hidden ? true : false, ...(b.type === 'section' && b.border === false ? { border: false } : {}) };
	}

	await getAdminDb().ref(`syllabi/${classId}/${syllabusId}`).set({
		name: name ?? 'Untitled',
		font: font ?? 'Georgia, serif',
		margins: (margins && typeof margins === 'object') ? margins : { top: 64, right: 64, bottom: 64, left: 64 },
		fontSizes: (fontSizes && typeof fontSizes === 'object') ? fontSizes : { title: 24, section: 14, text: 12, weekHeader: 12, weekTopic: 11 },
		customFonts: Array.isArray(customFonts) ? customFonts : [],
		spacing: (spacing && typeof spacing === 'object') ? spacing : { title: 0, section: 6, text: 6, week: 8 },
		lineHeights: (lineHeights && typeof lineHeights === 'object') ? lineHeights : { title: 1.2, section: 1.3, text: 1.75, weekHeader: 1.3, weekTopic: 1.65 },
		updatedAt: Date.now(),
		blocks: blocksObj
	});

	return json({ ok: true });
}

export async function DELETE({ url, locals }) {
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') error(403, 'Forbidden');

	const classId = url.searchParams.get('classId');
	const syllabusId = url.searchParams.get('syllabusId');
	if (!classId || !syllabusId) error(400, 'classId and syllabusId required');

	await getAdminDb().ref(`syllabi/${classId}/${syllabusId}`).remove();
	return json({ ok: true });
}
