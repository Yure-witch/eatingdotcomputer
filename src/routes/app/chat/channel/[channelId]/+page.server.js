import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';

export async function load({ params, parent }) {
	const { currentUser } = await parent();
	const { channelId } = params;
	const db = getDb();
	const PAGE_SIZE = 40;
	const EMPTY = { rows: [] };

	// Run all queries CONCURRENTLY instead of awaiting one after another — each
	// is a separate Turso round-trip, so serial waits stacked the latency you
	// feel when opening a chat. The 404 check is evaluated after they resolve.
	const [conv, result, reactionsResult, starredResult] = db ? await Promise.all([
		db.execute({
			sql: "SELECT id FROM conversations WHERE id = ? AND type = 'channel'",
			args: [channelId]
		}),
		db.execute({
			sql: `SELECT * FROM (
			        SELECT id, conversation_id, user_id, user_name, user_role, content, created_at,
			               attachment_url, attachment_filename, attachment_mimetype, attachment_size,
			               fx, font_size, font_weight, font_stretch, no_split, is_edited, mentions, tg_fx
			        FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
			      ) sub ORDER BY created_at ASC`,
			args: [channelId, PAGE_SIZE]
		}),
		db.execute({
			sql: `SELECT mr.message_id, mr.emoji, mr.user_id
			      FROM message_reactions mr
			      JOIN chat_messages cm ON mr.message_id = cm.id
			      WHERE cm.conversation_id = ?`,
			args: [channelId]
		}),
		currentUser ? db.execute({
			sql: 'SELECT message_id FROM starred_messages WHERE user_id = ?',
			args: [currentUser.id]
		}) : Promise.resolve(EMPTY)
	]) : [EMPTY, EMPTY, EMPTY, EMPTY];

	if (db && !conv.rows.length) error(404, 'Channel not found');

	const initialReactions = {};
	for (const r of reactionsResult.rows) {
		const mid = String(r.message_id), e = String(r.emoji), uid = String(r.user_id);
		if (!initialReactions[mid]) initialReactions[mid] = {};
		if (!initialReactions[mid][e]) initialReactions[mid][e] = {};
		initialReactions[mid][e][uid] = true;
	}

	const starredMessageIds = starredResult.rows.map((r) => String(r.message_id));

	return {
		channelId,
		initialReactions,
		starredMessageIds,
		hasMoreHistory: result.rows.length >= PAGE_SIZE,
		history: result.rows.map((r) => ({
			id: String(r.id),
			userId: String(r.user_id),
			userName: String(r.user_name),
			userRole: String(r.user_role),
			content: String(r.content),
			createdAt: new Date(String(r.created_at)).getTime(),
			edited: Number(r.is_edited) === 1,
			fx: r.fx ? String(r.fx) : null,
			fontSize: r.font_size != null ? Number(r.font_size) : 1,
			fontWeight: r.font_weight != null ? Number(r.font_weight) : 400,
			fontStretch: r.font_stretch != null ? Number(r.font_stretch) : 100,
			noSplit: Number(r.no_split) === 1,
			tgFx: Number(r.tg_fx) === 1,
			attachment: r.attachment_url ? {
				url: String(r.attachment_url),
				filename: String(r.attachment_filename ?? ''),
				mimetype: String(r.attachment_mimetype ?? ''),
				size: Number(r.attachment_size ?? 0)
			} : null,
			mentions: r.mentions ? (() => { try { return JSON.parse(String(r.mentions)); } catch { return []; } })() : []
		}))
	};
}
