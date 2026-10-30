import { json } from '@sveltejs/kit';
import { archiveCaller, requireDb, parseJson } from '$lib/server/work-archive.js';
import { ARCHIVE_SCHEMA, ARCHIVE_LIMITS, PROTOCOL_URL } from '$lib/work-archive.js';

// Work Archive entry point — the agent's first call. Confirms the token works,
// says whose archive it is writing, and lists that student's submissions so a
// re-run can tell what is already there.
export async function GET(event) {
	const caller = await archiveCaller(event, { allowToken: true });
	const db = requireDb();
	const rows = (await db.execute({
		sql: `SELECT id, status, via, agent, created_at, completed_at, project_count, idea_count, asset_count, total_bytes, last_report
		      FROM archive_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
		args: [caller.userId]
	})).rows;
	return json({
		protocol: ARCHIVE_SCHEMA,
		docs: PROTOCOL_URL,
		you: { name: caller.name, role: caller.role },
		limits: ARCHIVE_LIMITS,
		submissions: rows.map((r) => ({
			id: String(r.id),
			status: String(r.status),
			via: String(r.via),
			agent: r.agent ? String(r.agent) : null,
			createdAt: String(r.created_at),
			completedAt: r.completed_at ? String(r.completed_at) : null,
			projects: Number(r.project_count),
			ideas: Number(r.idea_count),
			assets: Number(r.asset_count),
			bytes: Number(r.total_bytes),
			lastReport: r.status === 'open' ? parseJson(r.last_report) : undefined
		}))
	});
}
