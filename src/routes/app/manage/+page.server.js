import { redirect, fail } from '@sveltejs/kit';
import { getAssignments, createAssignment, updateAssignment, deleteAssignment } from '$lib/server/assignments.js';
import { getSubmissionsForAssignment } from '$lib/server/submissions.js';
import { getWeekPlans, getAllProgressForClass, getStudentCountForClass, deleteWeekPlan } from '$lib/server/week-plans.js';
import { getDb } from '$lib/server/turso.js';
import { getAdminDb } from '$lib/server/firebase-admin.js';
import { notifyInactiveStudents } from '$lib/server/notify-inactive.js';
import { sendApprovalEmail } from '$lib/server/email.js';

export async function load({ locals, parent }) {
	const parentData = await parent();
	const session = await locals.auth();
	if (!session || session.user.role !== 'instructor') redirect(303, '/app');

	const classId = parentData.currentClass?.id ?? 'idc-fall-2026';

	// Assignments tab reads from the same `week_plans` table the home
	// page writes to — the legacy `assignments` table is no longer
	// being populated, so this page sat empty for every class that
	// only ever used the newer flow. Each week_plan rolls up to one
	// row in the UI (week number, headline, due date, item count +
	// completion ratio for instructors).
	const plans = await getWeekPlans(classId);
	const allProgress = await getAllProgressForClass(classId);
	const studentCount = await getStudentCountForClass(classId);

	const weeks = [...plans]
		.sort((a, b) => a.week - b.week)
		.map((p) => {
			const itemProgress = allProgress[p.id] ?? {};
			let totalSubs = 0;
			for (const it of p.items ?? []) totalSubs += Number(itemProgress[it.id] ?? 0);
			return {
				week: p.week,
				assignments: [{
					id: p.id,
					week: p.week,
					title: p.headline,
					description: p.topicPreview ?? '',
					dueDate: p.dueDate ?? '',
					important: !!p.important,
					itemCount: (p.items ?? []).length,
					items: (p.items ?? []).map((it) => ({
						id: it.id,
						label: it.label,
						requiresSubmission: it.requiresSubmission,
						acceptedTypes: it.acceptedTypes,
						completedCount: Number(itemProgress[it.id] ?? 0)
					})),
					submissionCount: totalSubs,
					studentCount
				}]
			};
		});

	const maxWeek = weeks.length ? Math.max(...weeks.map((w) => w.week)) : 0;

	// All members + online status — scoped to current class (instructors always included)
	const db = getDb();
	const usersResult = db ? await db.execute({
		sql: `SELECT u.id, u.name, u.email, u.role, u.created_at, u.avatar_kind, u.avatar_value, u.gemma_digest, u.interests FROM users u
		      WHERE u.role = 'instructor'
		         OR EXISTS (
		              SELECT 1 FROM class_memberships cm
		              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
		            )
		      ORDER BY u.created_at ASC`,
		args: [classId]
	}) : { rows: [] };

	const PRESENCE_TTL = 5 * 60 * 1000;
	const presenceSnap = await getAdminDb().ref('presence').get();
	const presenceData = {};
	if (presenceSnap.exists()) {
		const now = Date.now();
		for (const [uid, val] of Object.entries(presenceSnap.val())) {
			if (!val || typeof val !== 'object') continue;
			// Per-device if any child is an object; mixed format (stale flat + live devices) → per-device.
			const deviceObjects = Object.values(val).filter(d => d && typeof d === 'object');
			const devices = deviceObjects.length > 0 ? deviceObjects : [val];
			let online = false, lastSeen = null, ua = null, screen = null, pwa = null, mobile = null, notif = null;
			for (const d of devices) {
				if (d.online && (d.lastSeen ?? 0) > now - PRESENCE_TTL) online = true;
				if (d.lastSeen && (!lastSeen || d.lastSeen > lastSeen)) {
					lastSeen = d.lastSeen;
					ua = d.ua ?? null;
					screen = d.screen ?? null;
					pwa = d.pwa ?? null;
					mobile = d.mobile ?? null;
				}
				if (d.notif != null) notif = d.notif;
			}
			presenceData[uid] = { online, lastSeen, ua, screen, pwa, mobile, notif };
		}
	}

	// Most recent session per user from Turso (archived sessions — more reliable than presence heartbeats)
	const lastSessionRows = db ? await db.execute({
		sql: `SELECT user_id,
		             MAX(COALESCE(session_end, datetime('now'))) AS last_active
		      FROM user_sessions GROUP BY user_id`
	}) : { rows: [] };
	const lastSessionMap = {};
	for (const r of lastSessionRows.rows) {
		lastSessionMap[String(r.user_id)] = new Date(String(r.last_active)).getTime();
	}

	const members = usersResult.rows.map((r) => {
		const uid = String(r.id);
		const presence = presenceData[uid];
		// Use the most recent timestamp from either Firebase presence or Turso sessions
		const presenceLastSeen = presence?.lastSeen ?? null;
		const sessionLastSeen = lastSessionMap[uid] ?? null;
		const lastSeen = Math.max(presenceLastSeen ?? 0, sessionLastSeen ?? 0) || null;
		return {
			id: uid,
			name: String(r.name ?? ''),
			email: String(r.email ?? ''),
			role: String(r.role ?? 'student'),
			joinedAt: String(r.created_at ?? ''),
			avatarKind: r.avatar_kind ? String(r.avatar_kind) : 'gen',
			avatarValue: r.avatar_value ? String(r.avatar_value) : null,
			gemmaDigest: Number(r.gemma_digest) === 1,
			interests: r.interests ? String(r.interests) : '',
			online: presence?.online ?? false,
			lastSeen,
			ua: presence?.ua ?? null,
			screen: presence?.screen ?? null,
			pwa: presence?.pwa ?? null,
			mobile: presence?.mobile ?? null,
			notif: presence?.notif ?? null
		};
	});

	// Activity: hourly for last 7 days (drives 12h / 1d / 7d views)
	// Uses user_sessions (session ranges) — each hour a session overlaps counts as 1.
	const hourlyRows = db ? await db.execute({
		sql: `WITH RECURSIVE hours(h) AS (
		        SELECT strftime('%Y-%m-%dT%H:00', datetime('now', '-7 days'))
		        UNION ALL
		        SELECT strftime('%Y-%m-%dT%H:00', datetime(h, '+1 hour'))
		        FROM hours WHERE h < strftime('%Y-%m-%dT%H:00', 'now')
		      )
		      SELECT u.id AS user_id, u.name, hours.h AS bucket, COUNT(DISTINCT us.id) AS count
		      FROM user_sessions us
		      JOIN users u ON us.user_id = u.id
		      JOIN hours ON us.session_start <= datetime(hours.h, '+1 hour')
		               AND (us.session_end IS NULL OR us.session_end >= datetime(hours.h))
		      WHERE u.role != 'instructor'
		        AND us.session_start >= datetime('now', '-7 days')
		        AND EXISTS (
		              SELECT 1 FROM class_memberships cm
		              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
		            )
		      GROUP BY u.id, hours.h
		      ORDER BY hours.h ASC`,
		args: [classId]
	}) : { rows: [] };

	// Activity: daily for last 6 months (drives 1m / 6m views)
	const dailyRows = db ? await db.execute({
		sql: `WITH RECURSIVE days(d) AS (
		        SELECT date('now', '-180 days')
		        UNION ALL
		        SELECT date(d, '+1 day') FROM days WHERE d < date('now')
		      )
		      SELECT u.id AS user_id, u.name, days.d AS bucket, COUNT(DISTINCT us.id) AS count
		      FROM user_sessions us
		      JOIN users u ON us.user_id = u.id
		      JOIN days ON date(us.session_start) <= days.d
		              AND (us.session_end IS NULL OR date(us.session_end) >= days.d)
		      WHERE u.role != 'instructor'
		        AND us.session_start >= datetime('now', '-180 days')
		        AND EXISTS (
		              SELECT 1 FROM class_memberships cm
		              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
		            )
		      GROUP BY u.id, days.d
		      ORDER BY days.d ASC`,
		args: [classId]
	}) : { rows: [] };

	// ── Derive activity from RTDB presence for recent sessions ──
	// RTDB has current sessions (last ≤24h); Turso user_sessions has archived ones (>24h).
	// Synthesize hourly rows from RTDB so charts populate immediately, even before the
	// nightly archive cron has written anything to Turso.
	const rtdbActRows = [];  // { user_id, name, bucket, count }
	const rtdbDevRows = [];  // { user_id, name, bucket, device_type, has_notif, pings }

	if (presenceSnap.exists()) {
		const now = Date.now();
		const dayAgo = now - 24 * 3600_000;

		// All non-instructor users — not restricted to approved members so activity
		// from pending/unapproved accounts still shows up in charts.
		const allUsersResult = db ? await db.execute({
			sql: `SELECT id, name FROM users WHERE role != 'instructor'`,
			args: []
		}) : { rows: [] };
		const studentMap = {};
		for (const r of allUsersResult.rows) {
			studentMap[String(r.id)] = String(r.name ?? '');
		}

		// Push notification status per user
		const notifSet = new Set();
		if (db) {
			const notifRows = await db.execute('SELECT DISTINCT user_id FROM push_subscriptions').catch(() => ({ rows: [] }));
			for (const r of notifRows.rows) notifSet.add(String(r.user_id));
		}

		for (const [uid, userVal] of Object.entries(presenceSnap.val())) {
			if (!userVal || typeof userVal !== 'object') continue;
			if (!studentMap[uid]) continue; // not an approved student in this class

			const name = studentMap[uid];
			const hasNotif = notifSet.has(uid) ? 1 : 0;

			const deviceObjects = Object.values(userVal).filter(d => d && typeof d === 'object');
			const devicesToProcess = deviceObjects.length > 0 ? deviceObjects : [userVal];

			// Track seen buckets per user to avoid double-counting multiple devices in same hour
			const seenAct = new Set();
			const seenDev = new Set();

			for (const d of devicesToProcess) {
				const sessionStart = Math.max(d.sessionStart ?? d.lastSeen ?? now, dayAgo);
				const sessionEnd = d.online ? now : Math.min(d.lastSeen ?? now, now);
				if (!sessionStart || sessionEnd < sessionStart) continue;

				const deviceType = d.mobile ? 'mobile' : 'desktop';

				// Walk hour by hour across this session
				let cursor = Math.floor(sessionStart / 3600_000) * 3600_000;
				while (cursor <= sessionEnd) {
					const bucket = new Date(cursor).toISOString().slice(0, 13) + ':00';

					if (!seenAct.has(bucket)) {
						seenAct.add(bucket);
						rtdbActRows.push({ user_id: uid, name, bucket, count: 1 });
					}
					const devKey = `${bucket}|${deviceType}`;
					if (!seenDev.has(devKey)) {
						seenDev.add(devKey);
						rtdbDevRows.push({ user_id: uid, name, bucket, device_type: deviceType, has_notif: hasNotif, pings: 1 });
					}

					cursor += 3600_000;
				}
			}
		}
	}

	// Merge Turso rows with RTDB-derived rows. Turso has archived sessions (>24h),
	// RTDB has current sessions (≤24h). Deduplicate by (uid, bucket) so if both sources
	// have data for the same hour, Turso's archived row wins.
	function mergeActRows(turso, rtdb) {
		const seen = new Set(turso.map(r => `${r.user_id}|${r.bucket}`));
		return [...turso, ...rtdb.filter(r => !seen.has(`${r.user_id}|${r.bucket}`))];
	}
	function mergeDevRows(turso, rtdb) {
		const seen = new Set(turso.map(r => `${r.user_id}|${r.bucket}|${r.device_type}`));
		return [...turso, ...rtdb.filter(r => !seen.has(`${r.user_id}|${r.bucket}|${r.device_type}`))];
	}

	function buildSeries(rows) {
		const map = {};
		for (const r of rows) {
			const uid = String(r.user_id);
			if (!map[uid]) map[uid] = { userId: uid, name: String(r.name ?? ''), points: [] };
			map[uid].points.push({ bucket: String(r.bucket), count: Number(r.count) });
		}
		return Object.values(map);
	}

	const activityByUser = {
		hourly: buildSeries(mergeActRows(hourlyRows.rows, rtdbActRows)),
		daily:  buildSeries(dailyRows.rows)
	};

	// User device breakdown: hourly (drives 12h/1d/7d)
	const udHourlyRows = db ? await db.execute({
		sql: `WITH RECURSIVE hours(h) AS (
		        SELECT strftime('%Y-%m-%dT%H:00', datetime('now', '-7 days'))
		        UNION ALL
		        SELECT strftime('%Y-%m-%dT%H:00', datetime(h, '+1 hour'))
		        FROM hours WHERE h < strftime('%Y-%m-%dT%H:00', 'now')
		      )
		      SELECT u.id AS user_id, u.name, hours.h AS bucket,
		             COALESCE(us.device_type, 'unknown') AS device_type,
		             CASE WHEN ps.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_notif,
		             COUNT(DISTINCT us.id) AS pings
		      FROM user_sessions us
		      JOIN users u ON us.user_id = u.id
		      JOIN hours ON us.session_start <= datetime(hours.h, '+1 hour')
		               AND (us.session_end IS NULL OR us.session_end >= datetime(hours.h))
		      LEFT JOIN (SELECT DISTINCT user_id FROM push_subscriptions) ps ON us.user_id = ps.user_id
		      WHERE u.role != 'instructor'
		        AND us.session_start >= datetime('now', '-7 days')
		        AND EXISTS (
		              SELECT 1 FROM class_memberships cm
		              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
		            )
		      GROUP BY us.user_id, hours.h, device_type, has_notif
		      ORDER BY hours.h ASC`,
		args: [classId]
	}) : { rows: [] };

	// User device breakdown: daily (drives 1m/6m)
	const udDailyRows = db ? await db.execute({
		sql: `WITH RECURSIVE days(d) AS (
		        SELECT date('now', '-180 days')
		        UNION ALL
		        SELECT date(d, '+1 day') FROM days WHERE d < date('now')
		      )
		      SELECT u.id AS user_id, u.name, days.d AS bucket,
		             COALESCE(us.device_type, 'unknown') AS device_type,
		             CASE WHEN ps.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_notif,
		             COUNT(DISTINCT us.id) AS pings
		      FROM user_sessions us
		      JOIN users u ON us.user_id = u.id
		      JOIN days ON date(us.session_start) <= days.d
		              AND (us.session_end IS NULL OR date(us.session_end) >= days.d)
		      LEFT JOIN (SELECT DISTINCT user_id FROM push_subscriptions) ps ON us.user_id = ps.user_id
		      WHERE u.role != 'instructor'
		        AND us.session_start >= datetime('now', '-180 days')
		        AND EXISTS (
		              SELECT 1 FROM class_memberships cm
		              WHERE cm.user_id = u.id AND cm.status = 'approved' AND cm.class_id = ?
		            )
		      GROUP BY us.user_id, days.d, device_type, has_notif
		      ORDER BY days.d ASC`,
		args: [classId]
	}) : { rows: [] };

	function mapUdRows(rows) {
		return rows.map((r) => ({
			userId: String(r.user_id),
			name: String(r.name ?? ''),
			bucket: String(r.bucket),
			deviceType: String(r.device_type),
			hasNotif: Number(r.has_notif) === 1,
			pings: Number(r.pings)
		}));
	}

	const userDeviceActivity = {
		hourly: mapUdRows(mergeDevRows(udHourlyRows.rows, rtdbDevRows)),
		daily: mapUdRows(udDailyRows.rows)
	};

	// Pending class membership requests — scoped to current class
	const pendingResult = db ? await db.execute({
		sql: `SELECT cm.id, cm.class_id, cm.user_id, cm.requested_at,
		             c.name AS class_name, c.term,
		             u.name AS user_name, u.email, u.pronouns, u.bio, u.website,
		             u.avatar_kind, u.avatar_value
		      FROM class_memberships cm
		      JOIN classes c ON cm.class_id = c.id
		      JOIN users u ON cm.user_id = u.id
		      WHERE cm.status = 'pending' AND cm.class_id = ?
		      ORDER BY cm.requested_at ASC`,
		args: [classId]
	}) : { rows: [] };

	const pendingRequests = pendingResult.rows.map((r) => ({
		id: String(r.id),
		userId: String(r.user_id),
		className: String(r.class_name),
		term: String(r.term),
		requestedAt: String(r.requested_at ?? ''),
		userName: String(r.user_name ?? ''),
		email: String(r.email ?? ''),
		pronouns: String(r.pronouns ?? ''),
		bio: String(r.bio ?? ''),
		website: String(r.website ?? ''),
		avatarKind: r.avatar_kind ? String(r.avatar_kind) : 'gen',
		avatarValue: r.avatar_value ? String(r.avatar_value) : null
	}));

	// Avg session length (minutes) grouped by device_type × is_pwa × notifications on/off
	const deviceNotifRows = db ? await db.execute({
		sql: `SELECT
		          us.device_type,
		          us.is_pwa,
		          CASE WHEN ps.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_notif,
		          AVG(
		            CAST((julianday(COALESCE(us.session_end, datetime('now'))) - julianday(us.session_start)) * 1440 AS REAL)
		          ) AS avg_minutes
		      FROM user_sessions us
		      LEFT JOIN (SELECT DISTINCT user_id FROM push_subscriptions) ps ON us.user_id = ps.user_id
		      WHERE us.session_start >= datetime('now', '-30 days')
		        AND us.device_type IS NOT NULL
		      GROUP BY us.device_type, us.is_pwa, has_notif`,
		args: []
	}) : { rows: [] };

	const deviceNotifData = deviceNotifRows.rows.map((r) => ({
		deviceType: String(r.device_type ?? ''),
		isPwa: Number(r.is_pwa) === 1,
		hasNotif: Number(r.has_notif) === 1,
		avgMinutes: Number(r.avg_minutes ?? 0)
	}));

	// Non-blocking: send reminders to inactive students for assignments posted 3+ days ago
	notifyInactiveStudents().catch(() => {});

	// ── DM conversations for moderation ──
	// Read all userChats from Firebase RTDB to discover DM conversations
	const userChatsSnap = await getAdminDb().ref('userChats').get();
	const dmConvMap = {}; // convId → { convId, participantIds, lastMessage, lastAt }

	if (userChatsSnap.exists()) {
		for (const [uid, convs] of Object.entries(userChatsSnap.val())) {
			if (!convs || typeof convs !== 'object') continue;
			for (const [convId, meta] of Object.entries(convs)) {
				if (!meta || typeof meta !== 'object') continue;
				if (!dmConvMap[convId]) {
					dmConvMap[convId] = {
						convId,
						participantIds: new Set(),
						lastMessage: meta.lastMessage ?? '',
						lastAt: meta.lastAt ?? 0
					};
				}
				dmConvMap[convId].participantIds.add(uid);
				if (meta.otherUserId) dmConvMap[convId].participantIds.add(meta.otherUserId);
				// Keep the most recent lastAt / lastMessage
				if ((meta.lastAt ?? 0) > dmConvMap[convId].lastAt) {
					dmConvMap[convId].lastAt = meta.lastAt;
					dmConvMap[convId].lastMessage = meta.lastMessage ?? '';
				}
			}
		}
	}

	// Build a name lookup from members
	const memberNameMap = {};
	for (const m of members) memberNameMap[m.id] = m.name;

	// Get archived message counts per DM conversation from Turso
	const dmMsgCountRows = db ? await db.execute({
		sql: `SELECT conversation_id, COUNT(*) as msg_count FROM chat_messages
		      WHERE conversation_id NOT IN (SELECT id FROM conversations WHERE type = 'channel')
		      GROUP BY conversation_id`
	}) : { rows: [] };
	const dmMsgCounts = {};
	for (const r of dmMsgCountRows.rows) {
		dmMsgCounts[String(r.conversation_id)] = Number(r.msg_count);
	}

	// Assemble and sort
	const dmConversations = Object.values(dmConvMap)
		.map((d) => {
			const ids = [...d.participantIds];
			return {
				convId: d.convId,
				participants: ids.map((id) => ({ id, name: memberNameMap[id] || id })),
				lastMessage: d.lastMessage,
				lastAt: d.lastAt,
				msgCount: dmMsgCounts[d.convId] ?? 0
			};
		})
		.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));

	// Enrollment window for the currently selected class. Surfaces
	// the toggle + start/end dates that drive the student onboarding
	// picker — only classes with enrollment_open=1 AND today inside
	// the window show up there.
	let enrollment = { open: false, start: null, end: null };
	if (db && classId) {
		const r = await db.execute({
			sql: 'SELECT enrollment_open, enrollment_start, enrollment_end FROM classes WHERE id = ?',
			args: [classId]
		});
		const row = r.rows[0];
		if (row) {
			enrollment = {
				open: Number(row.enrollment_open) === 1,
				start: row.enrollment_start ? String(row.enrollment_start) : null,
				end: row.enrollment_end ? String(row.enrollment_end) : null
			};
		}
	}

	return { weeks, maxWeek, members, activityByUser, userDeviceActivity, deviceNotifData, pendingRequests, classId, dmConversations, enrollment };
}

const ALL_TYPES = ['link', 'image', 'video'];

function parseTypes(data) {
	const types = data.getAll('accepted_types').map(String).filter((t) => ALL_TYPES.includes(t));
	return types.length ? types : ['link'];
}

export const actions = {
	resetStudent: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const userId = String(data.get('user_id') ?? '');
		if (!userId) return fail(400, { error: 'Missing user_id' });

		const db = getDb();
		if (!db) return fail(503, { error: 'Database unavailable' });

		await db.execute({ sql: 'DELETE FROM class_memberships WHERE user_id = ?', args: [userId] });
		await db.execute({ sql: "UPDATE users SET onboarding_step = 'profile' WHERE id = ?", args: [userId] });
	},

	approve: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const membershipId = String(data.get('id') ?? '');
		if (!membershipId) return fail(400, { error: 'Missing id' });

		const db = getDb();
		if (!db) return fail(503, { error: 'Database unavailable' });

		const membership = await db.execute({
			sql: 'SELECT user_id FROM class_memberships WHERE id = ?',
			args: [membershipId]
		});
		if (!membership.rows.length) return fail(404, { error: 'Not found' });

		const userId = String(membership.rows[0].user_id);
		await db.execute({
			sql: `UPDATE class_memberships SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`,
			args: [session.user.id, membershipId]
		});
		await db.execute({
			sql: `UPDATE users SET onboarding_step = 'complete' WHERE id = ?`,
			args: [userId]
		});

		// Fetch user info + class info for the email and RTDB signal
		const [userRow, classRow] = await Promise.all([
			db.execute({ sql: `SELECT name, email FROM users WHERE id = ?`, args: [userId] }),
			db.execute({
				sql: `SELECT c.name, c.term FROM class_memberships cm JOIN classes c ON cm.class_id = c.id WHERE cm.id = ?`,
				args: [membershipId]
			})
		]);
		const user = userRow.rows[0];
		const cls = classRow.rows[0];

		// Signal the student's pending screen to auto-refresh (non-blocking)
		getAdminDb().ref(`approvals/${userId}`).set(Date.now()).catch(() => {});

		// Send approval email (non-blocking)
		if (user?.email) {
			sendApprovalEmail({
				toEmail: String(user.email),
				toName: String(user.name ?? ''),
				className: String(cls?.name ?? 'your class'),
				term: String(cls?.term ?? '')
			}).catch(() => {});
		}
	},

	deny: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const membershipId = String(data.get('id') ?? '');
		if (!membershipId) return fail(400, { error: 'Missing id' });

		const db = getDb();
		if (!db) return fail(503, { error: 'Database unavailable' });

		const membership = await db.execute({
			sql: 'SELECT user_id FROM class_memberships WHERE id = ?',
			args: [membershipId]
		});
		if (!membership.rows.length) return fail(404, { error: 'Not found' });

		const userId = String(membership.rows[0].user_id);
		await db.execute({
			sql: `UPDATE class_memberships SET status = 'denied', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?`,
			args: [session.user.id, membershipId]
		});
		await db.execute({
			sql: `UPDATE users SET onboarding_step = 'denied' WHERE id = ?`,
			args: [userId]
		});
	},

	create: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const week = parseInt(data.get('week'));
		const title = String(data.get('title') ?? '').trim();
		const description = String(data.get('description') ?? '').trim();
		const dueDate = String(data.get('due_date') ?? '').trim();
		const acceptedTypes = parseTypes(data);
		const classId = String(data.get('class_id') ?? 'idc-fall-2026');

		if (!week || !title) return fail(400, { error: 'Week and title are required', action: 'create' });

		await createAssignment({ week, title, description, dueDate, acceptedTypes, createdBy: session.user.id, classId });
	},

	update: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		const week = parseInt(data.get('week'));
		const title = String(data.get('title') ?? '').trim();
		const description = String(data.get('description') ?? '').trim();
		const dueDate = String(data.get('due_date') ?? '').trim();
		const acceptedTypes = parseTypes(data);

		if (!id || !week || !title) return fail(400, { error: 'Week and title are required', action: 'update', id });

		await updateAssignment(id, { week, title, description, dueDate, acceptedTypes });
	},

	delete: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'Missing id' });
		await deleteAssignment(id);
	},

	// Open/close enrollment for the currently selected class and set
	// the optional [start, end] window. Drives the student
	// onboarding/class picker — only classes with enrollment_open=1
	// AND today inside the window are listed there. Blank date fields
	// store as NULL ("no lower / upper bound"), so the instructor can
	// run an open-ended window if they want.
	setEnrollment: async ({ request, locals, cookies }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });
		const db = getDb();
		if (!db) return fail(503, { error: 'Database unavailable' });

		const data = await request.formData();
		const open = data.get('enrollment_open') === '1';
		const start = String(data.get('enrollment_start') ?? '').trim() || null;
		const end = String(data.get('enrollment_end') ?? '').trim() || null;
		// Operate on the same class the loader pulled. The instructor's
		// active class is the cookie-resolved one, falling back to the
		// first class — mirror that lookup here so the action can't be
		// confused by a stale form posted from another tab.
		const selectedId = cookies.get('selected_class_id');
		const cls = await db.execute({
			sql: 'SELECT id FROM classes WHERE id = ? OR ? IS NULL LIMIT 1',
			args: [selectedId ?? null, selectedId ?? null]
		});
		const targetId = String(cls.rows[0]?.id ?? '');
		if (!targetId) return fail(400, { error: 'No class selected' });

		if (start && end && start > end) {
			return fail(400, { error: 'Enrollment start date must be on or before the end date.', action: 'setEnrollment' });
		}

		await db.execute({
			sql: 'UPDATE classes SET enrollment_open = ?, enrollment_start = ?, enrollment_end = ? WHERE id = ?',
			args: [open ? 1 : 0, start, end, targetId]
		});
	},

	// Delete a week_plan (the assignments tab now lists these instead
	// of the legacy `assignments` table). FK cascades wipe the plan's
	// items + every student completion attached to them.
	deleteWeekPlan: async ({ request, locals }) => {
		const session = await locals.auth();
		if (!session || session.user.role !== 'instructor') return fail(403, { error: 'Forbidden' });

		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: 'Missing id' });
		await deleteWeekPlan(id);
	}
};
