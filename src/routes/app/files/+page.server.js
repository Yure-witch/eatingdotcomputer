import { getDb } from '$lib/server/turso.js';

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]()]+/gi;

function cleanUrl(url) {
	return url.replace(/[.,;:!?)'"\]]+$/, '');
}

export async function load({ parent }) {
	const parentData = await parent();
	const db = getDb();
	const classId = parentData.currentClass?.id ?? 'idc-fall-2026';
	const userId = parentData.currentUser?.id;

	if (!db) return { links: [], uploadedFiles: [], starredMessages: [] };

	// All messages from channels scoped to this class, newest first
	const result = await db.execute({
		sql: `SELECT cm.content, cm.user_name, cm.created_at, c.id as conv_id, c.name as conv_name
		      FROM chat_messages cm
		      JOIN conversations c ON cm.conversation_id = c.id
		      WHERE c.type = 'channel' AND c.class_id = ?
		      ORDER BY cm.created_at DESC`,
		args: [classId]
	});

	// Extract unique URLs (newest occurrence wins for metadata, but we dedupe by URL)
	const seen = new Map();
	for (const row of result.rows) {
		const matches = String(row.content).match(URL_RE);
		if (!matches) continue;
		for (const raw of matches) {
			const url = cleanUrl(raw);
			if (seen.has(url)) continue;
			seen.set(url, {
				url,
				sharedBy: String(row.user_name),
				sharedAt: new Date(String(row.created_at).endsWith('Z') ? row.created_at : row.created_at + 'Z').getTime(),
				convId: String(row.conv_id),
				convName: String(row.conv_name ?? row.conv_id),
				title: null
			});
		}
	}

	const links = [...seen.values()];

	// Fill in cached titles
	if (links.length) {
		const placeholders = links.map(() => '?').join(',');
		const metaResult = await db.execute({
			sql: `SELECT url, title FROM link_previews WHERE url IN (${placeholders})`,
			args: links.map((l) => l.url)
		});
		const meta = {};
		for (const r of metaResult.rows) meta[String(r.url)] = r.title ? String(r.title) : null;
		for (const link of links) link.title = meta[link.url] ?? null;
	}

	// Uploaded files: channel uploads for this class + DM uploads involving current user
	const filesResult = await db.execute({
		sql: `SELECT uf.id, uf.url, uf.filename, uf.mimetype, uf.size,
		             uf.uploaded_by_name, uf.uploaded_at, uf.context_type, uf.context_id,
		             c.name as conv_name
		      FROM uploaded_files uf
		      LEFT JOIN conversations c ON uf.context_id = c.id
		      WHERE (uf.class_id = ? AND uf.context_type = 'channel')
		         OR (uf.context_type = 'dm' AND uf.context_id LIKE ?)
		      ORDER BY uf.uploaded_at DESC
		      LIMIT 200`,
		args: [classId, userId ? `%${userId}%` : '__no_match__']
	});

	const uploadedFiles = filesResult.rows.map((r) => ({
		id: String(r.id),
		url: String(r.url),
		filename: String(r.filename),
		mimetype: String(r.mimetype ?? ''),
		size: Number(r.size),
		uploadedByName: String(r.uploaded_by_name),
		uploadedAt: new Date(String(r.uploaded_at).endsWith('Z') ? r.uploaded_at : r.uploaded_at + 'Z').getTime(),
		contextType: String(r.context_type),
		convName: r.conv_name ? String(r.conv_name) : String(r.context_id)
	}));

	const starredResult = userId ? await db.execute({
		sql: `SELECT id, message_id, conv_id, conv_name, content, author_name, author_id,
		             attachment_url, attachment_filename, attachment_mimetype, starred_at
		      FROM starred_messages WHERE user_id = ? ORDER BY starred_at DESC`,
		args: [userId]
	}) : { rows: [] };

	const starredMessages = starredResult.rows.map((r) => ({
		id: String(r.id),
		messageId: String(r.message_id),
		convId: String(r.conv_id),
		convName: r.conv_name ? String(r.conv_name) : null,
		content: r.content ? String(r.content) : null,
		authorName: String(r.author_name ?? ''),
		attachment: r.attachment_url ? {
			url: String(r.attachment_url),
			filename: String(r.attachment_filename ?? ''),
			mimetype: String(r.attachment_mimetype ?? '')
		} : null,
		starredAt: new Date(String(r.starred_at).endsWith('Z') ? r.starred_at : r.starred_at + 'Z').getTime()
	}));

	return { links, uploadedFiles, starredMessages };
}
