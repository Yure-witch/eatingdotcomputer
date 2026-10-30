// Work Archive — server side: who is calling (session OR personal upload
// token), manifest validation, and submission bookkeeping. Rules shared with
// the browser live in $lib/work-archive.js; the agent-facing spec is
// static/work-archive/PROTOCOL.md.

import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/turso.js';
import { sweepR2Prefix } from '$lib/server/r2.js';
import {
	ARCHIVE_SCHEMA, ATTRIBUTIONS, PROJECT_STATUSES, MANIFEST_PATH,
	collectAssetRefs
} from '$lib/work-archive.js';

export const TOKEN_PREFIX = 'ecwa_';
export const TOKEN_TTL_DAYS = 30;

async function sha256Hex(text) {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fresh token: returned raw ONCE to the student, stored only as a hash. */
export async function mintToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const raw = TOKEN_PREFIX + Buffer.from(bytes).toString('base64url');
	return { raw, hash: await sha256Hex(raw), last4: raw.slice(-4) };
}

export function requireDb() {
	const db = getDb();
	if (!db) error(503, 'Database unavailable');
	return db;
}

async function approvedClassId(db, userId) {
	const r = await db.execute({
		sql: `SELECT class_id FROM class_memberships WHERE user_id = ? AND status = 'approved'
		      ORDER BY requested_at DESC LIMIT 1`,
		args: [userId]
	});
	return r.rows[0] ? String(r.rows[0].class_id) : null;
}

/**
 * Who is calling: { userId, name, role, classId, via }.
 *
 * `allowToken` routes accept `Authorization: Bearer ecwa_…` — that is how a
 * student's agent (Claude Code, a script) authenticates with no browser
 * session. Token management itself is session-only, so a leaked token can't
 * mint its successor. Students must be approved class members either way.
 */
export async function archiveCaller({ request, locals, cookies }, { allowToken = false } = {}) {
	const db = requireDb();
	const header = request.headers.get('authorization') ?? '';
	const bearer = header.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;

	if (bearer) {
		if (!allowToken) error(403, 'This endpoint needs a signed-in browser session, not an upload token');
		if (!bearer.startsWith(TOKEN_PREFIX)) error(401, 'Not a Work Archive token (they start with ecwa_)');
		const hash = await sha256Hex(bearer);
		const r = await db.execute({
			sql: `SELECT t.id, t.user_id, t.expires_at, t.revoked_at, u.name, u.email, u.role
			      FROM archive_tokens t JOIN users u ON u.id = t.user_id
			      WHERE t.token_hash = ?`,
			args: [hash]
		});
		const row = r.rows[0];
		if (!row) error(401, 'Unknown token — generate a new one at /app/archive');
		if (row.revoked_at) error(401, 'This token was revoked — generate a new one at /app/archive');
		if (Date.parse(String(row.expires_at).replace(' ', 'T') + 'Z') < Date.now()) {
			error(401, 'This token expired — generate a new one at /app/archive');
		}
		db.execute({ sql: `UPDATE archive_tokens SET last_used_at = datetime('now') WHERE id = ?`, args: [row.id] }).catch(() => {});
		const userId = String(row.user_id);
		const role = String(row.role ?? 'student');
		const classId = await approvedClassId(db, userId);
		if (role !== 'instructor' && !classId) error(403, 'Not an approved class member');
		return { userId, name: String(row.name ?? row.email ?? ''), role, classId, via: 'token' };
	}

	const session = await locals.auth();
	if (!session?.user?.id) error(401, 'Not signed in — agents should send Authorization: Bearer <your ecwa_ token>');
	const userId = session.user.id;
	const role = session.user.role ?? 'student';
	let classId = await approvedClassId(db, userId);
	if (role === 'instructor') classId = cookies?.get('selected_class_id') ?? classId;
	else if (!classId) error(403, 'Not an approved class member');
	return { userId, name: session.user.name ?? session.user.email ?? '', role, classId, via: 'browser' };
}

export function assetKey(userId, submissionId, path) {
	return `work-archive/${userId}/${submissionId}/${path}`;
}

export function publicBase() {
	return (env.R2_PUBLIC_BASE_URL ?? env.PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
}

export function publicUrl(key) {
	const base = publicBase();
	return base ? `${base}/${key.split('/').map(encodeURIComponent).join('/')}` : null;
}

/** The submission row, if the caller may see it (owner, or any instructor). */
export async function loadSubmission(db, id, caller) {
	if (!/^[0-9a-f-]{36}$/.test(id)) error(404, 'No such submission');
	const r = await db.execute({ sql: 'SELECT * FROM archive_submissions WHERE id = ?', args: [id] });
	const row = r.rows[0];
	if (!row) error(404, 'No such submission');
	if (String(row.user_id) !== caller.userId && caller.role !== 'instructor') error(404, 'No such submission');
	return row;
}

/** Remove a submission entirely — R2 objects first, then its rows. */
export async function deleteSubmission(db, row) {
	await sweepR2Prefix(`work-archive/${row.user_id}/${row.id}/`, 0);
	await db.batch([
		{ sql: 'DELETE FROM archive_assets WHERE submission_id = ?', args: [row.id] },
		{ sql: 'DELETE FROM archive_submissions WHERE id = ?', args: [row.id] }
	], 'write');
}

// ── Validation ──────────────────────────────────────────────────────────

// Credentials that must never land in an archive. Matching any of them is a
// hard error: the agent scrubs and re-uploads the manifest.
const SECRET_PATTERNS = [
	['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
	['OpenAI-style API key', /\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{24,}/],
	['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
	['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
	['GitHub token', /\bgithub_pat_[A-Za-z0-9_]{30,}/],
	['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
	['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
	['Hugging Face token', /\bhf_[A-Za-z0-9]{30,}/],
	['Replicate token', /\br8_[A-Za-z0-9]{30,}/],
	['Stripe key', /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}/],
	['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
	['JSON Web Token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
	['Work Archive upload token', /\becwa_[A-Za-z0-9_-]{20,}/],
	['password assignment', /\b(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{6,}/i]
];

function eachString(node, at, fn) {
	if (typeof node === 'string') fn(node, at);
	else if (Array.isArray(node)) node.forEach((v, i) => eachString(v, `${at}[${i}]`, fn));
	else if (node && typeof node === 'object') {
		for (const [k, v] of Object.entries(node)) eachString(v, at ? `${at}.${k}` : k, fn);
	}
}

const str = (v) => typeof v === 'string' && v.trim().length > 0;
const arr = (v) => Array.isArray(v);
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Check a manifest against the protocol. `uploaded` is a Map(path → size) of
 * what is actually in storage (or, for a dry run, what the agent says it will
 * upload). Errors block completion; warnings are reported back to the agent so
 * it can make the archive more complete, but don't block.
 */
export function validateManifest(m, uploaded) {
	const errors = [];
	const warnings = [];
	const E = (code, message, at) => errors.push({ code, message, ...(at ? { at } : {}) });
	const W = (code, message, at) => warnings.push({ code, message, ...(at ? { at } : {}) });

	if (!obj(m)) {
		E('not_object', 'manifest.json must be a JSON object');
		return { errors, warnings, stats: {}, digest: null };
	}
	if (m.schema !== ARCHIVE_SCHEMA) E('schema', `"schema" must be exactly "${ARCHIVE_SCHEMA}"`, 'schema');
	if (!str(m.generated_at) || Number.isNaN(Date.parse(m.generated_at))) W('generated_at', '"generated_at" should be an ISO-8601 timestamp', 'generated_at');
	if (!obj(m.generator) || !str(m.generator.agent)) W('generator', 'Say which agent/model built this in generator.agent / generator.model', 'generator');

	// Student
	if (!obj(m.student) || !str(m.student.name)) E('student_name', 'student.name is required', 'student.name');

	// Consent — asked of the student, never assumed by the agent.
	const c = m.consent;
	if (!obj(c)) E('consent', 'A consent object is required — ask the student each question', 'consent');
	else {
		if (c.archive_for_instructor !== true) E('consent_archive', 'consent.archive_for_instructor must be true — the student has to agree before anything is uploaded', 'consent.archive_for_instructor');
		for (const k of ['use_in_funding_reports', 'use_in_public_showcase', 'quote_permission']) {
			if (typeof c[k] !== 'boolean') E('consent_' + k, `consent.${k} must be true or false — ask the student`, `consent.${k}`);
		}
		if (!ATTRIBUTIONS.includes(c.attribution)) E('consent_attribution', `consent.attribution must be one of ${ATTRIBUTIONS.join(', ')}`, 'consent.attribution');
		if (!str(c.confirmed_by_student_at) || Number.isNaN(Date.parse(c.confirmed_by_student_at))) {
			E('consent_confirmed', 'consent.confirmed_by_student_at must be the ISO time the student reviewed the archive and said yes', 'consent.confirmed_by_student_at');
		}
	}

	// Projects
	const projects = arr(m.projects) ? m.projects : null;
	if (!projects) E('projects', '"projects" must be an array (use [] only if there truly are none)', 'projects');
	const ideas = arr(m.ideas) ? m.ideas : [];
	if (m.ideas !== undefined && !arr(m.ideas)) E('ideas', '"ideas" must be an array', 'ideas');
	if (projects && !projects.length && !ideas.length) E('empty', 'The archive has no projects and no ideas — there is nothing to archive');

	const ids = new Set();
	(projects ?? []).forEach((p, i) => {
		const at = `projects[${i}]`;
		if (!obj(p)) { E('project', 'Each project must be an object', at); return; }
		if (!str(p.id) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(p.id)) E('project_id', 'project.id must be a lowercase kebab-case slug (a-z, 0-9, -)', `${at}.id`);
		else if (ids.has(p.id)) E('project_id_dup', `Duplicate project id "${p.id}"`, `${at}.id`);
		else ids.add(p.id);
		const label = str(p.title) ? `"${p.title}"` : at;
		if (!str(p.title)) E('project_title', 'project.title is required', `${at}.title`);
		if (!str(p.description)) E('project_description', 'project.description is required', `${at}.description`);
		else if (p.description.trim().length < 280) W('project_thin', `${label}: description is under ~280 characters — say what it is, how it works, and why it exists`, `${at}.description`);
		if (p.status !== undefined && !PROJECT_STATUSES.includes(p.status)) W('project_status', `${label}: status should be one of ${PROJECT_STATUSES.join(', ')}`, `${at}.status`);
		if (!obj(p.ai_usage)) W('project_ai', `${label}: no ai_usage — which AI tools, what they did, what the student did`, `${at}.ai_usage`);
		else if (!str(p.ai_usage.role_of_student)) W('project_student_role', `${label}: ai_usage.role_of_student is empty — what did the student decide, design or make?`, `${at}.ai_usage.role_of_student`);
		if (!arr(p.assets) || !p.assets.length) W('project_no_assets', `${label}: no images or media — capture screenshots, photos, sketches or a short recording`, `${at}.assets`);
		if (!obj(p.provenance) || !arr(p.provenance.sources) || !p.provenance.sources.length) W('project_provenance', `${label}: provenance.sources is empty — where did this information come from?`, `${at}.provenance`);
		if (!obj(p.learning)) W('project_learning', `${label}: no learning section (skills, challenges, reflection)`, `${at}.learning`);
	});
	ideas.forEach((d, i) => {
		if (!obj(d) || !str(d.title)) E('idea_title', 'Each idea needs a title', `ideas[${i}].title`);
	});
	if (!ideas.length) W('no_ideas', 'No ideas listed — include unbuilt ideas, parked directions and abandoned experiments too', 'ideas');
	if (!obj(m.reflections)) W('reflections', 'No reflections — ask the student about AI, the class, and what they would tell a future student', 'reflections');
	if (!arr(m.sources_searched) || !m.sources_searched.length) W('sources_searched', 'List every place you looked in sources_searched, so gaps are visible', 'sources_searched');
	if (!arr(m.omissions)) W('omissions', 'Add an omissions array (things found but left out, and why) — [] if nothing was left out', 'omissions');

	// Files: every reference must be uploaded; every upload should be referenced.
	const refs = collectAssetRefs(m);
	for (const [path, at] of refs) {
		if (!uploaded.has(path)) E('missing_asset', `"${path}" is referenced but was not uploaded`, at);
	}
	for (const path of uploaded.keys()) {
		if (path !== MANIFEST_PATH && !refs.has(path)) W('unreferenced_asset', `"${path}" was uploaded but nothing in the manifest points to it — add it to a project's or idea's assets with a caption`);
	}

	// Secrets anywhere in the text.
	eachString(m, '', (s, at) => {
		for (const [name, re] of SECRET_PATTERNS) {
			const hit = s.match(re)?.[0];
			if (hit) { E('secret', `Looks like a secret (${name}: "${hit.slice(0, 7)}…") — remove it`, at); break; }
		}
	});

	const assetCount = [...uploaded.keys()].filter((p) => p !== MANIFEST_PATH).length;
	const stats = {
		projects: projects?.length ?? 0,
		ideas: ideas.length,
		assets: assetCount,
		bytes: [...uploaded.values()].reduce((a, b) => a + (Number(b) || 0), 0)
	};

	const tools = new Set();
	for (const p of projects ?? []) for (const t of (obj(p?.ai_usage) && arr(p.ai_usage.tools) ? p.ai_usage.tools : [])) {
		const n = typeof t === 'string' ? t : t?.name;
		if (str(n)) tools.add(n.trim());
	}
	const digest = {
		student: str(m.student?.name) ? m.student.name : null,
		consent: obj(c) ? {
			funding: c.use_in_funding_reports === true,
			showcase: c.use_in_public_showcase === true,
			quotes: c.quote_permission === true,
			attribution: c.attribution ?? null
		} : null,
		generator: obj(m.generator) ? [m.generator.agent, m.generator.model].filter(str).join(' · ').slice(0, 120) : null,
		summary: str(m.overview?.summary) ? m.overview.summary.slice(0, 600) : null,
		projects: (projects ?? []).slice(0, 80).map((p) => ({
			id: String(p?.id ?? '').slice(0, 64),
			title: String(p?.title ?? '').slice(0, 140),
			status: PROJECT_STATUSES.includes(p?.status) ? p.status : null,
			hero: typeof p?.hero_asset === 'string' ? normalizeRef(p.hero_asset) : firstAsset(p)
		})),
		tools: [...tools].slice(0, 24)
	};

	return { errors: errors.slice(0, 200), warnings: warnings.slice(0, 200), stats, digest };
}

function normalizeRef(s) {
	return s.trim().replace(/^\.\//, '');
}
function firstAsset(p) {
	const a = arr(p?.assets) ? p.assets[0] : null;
	const path = typeof a === 'string' ? a : a?.path;
	return typeof path === 'string' ? normalizeRef(path) : null;
}

/** Parse a JSON column, tolerating null/garbage. */
export function parseJson(v, fallback = null) {
	if (v == null) return fallback;
	try { return JSON.parse(String(v)); } catch { return fallback; }
}

/** A submission row in the shape pages and the API hand out. */
export function shapeSubmission(r) {
	return {
		id: String(r.id),
		userId: String(r.user_id),
		status: String(r.status),
		via: String(r.via),
		agent: r.agent ? String(r.agent) : null,
		createdAt: String(r.created_at),
		completedAt: r.completed_at ? String(r.completed_at) : null,
		projects: Number(r.project_count ?? 0),
		ideas: Number(r.idea_count ?? 0),
		assets: Number(r.asset_count ?? 0),
		bytes: Number(r.total_bytes ?? 0),
		digest: parseJson(r.digest),
		lastReport: parseJson(r.last_report)
	};
}

/** Submission + its files (with public URLs) + the manifest itself from R2. */
export async function loadSubmissionDetail(db, row, { getText }) {
	const assets = (await db.execute({
		sql: `SELECT path, r2_key, content_type, kind, size, sha256, uploaded FROM archive_assets
		      WHERE submission_id = ? ORDER BY path`,
		args: [row.id]
	})).rows.map((a) => ({
		path: String(a.path),
		url: publicUrl(String(a.r2_key)),
		contentType: String(a.content_type),
		kind: String(a.kind),
		size: Number(a.size),
		sha256: a.sha256 ? String(a.sha256) : null,
		uploaded: Number(a.uploaded) === 1
	}));
	let manifest = null;
	try {
		const text = await getText(assetKey(String(row.user_id), String(row.id), MANIFEST_PATH));
		manifest = text ? JSON.parse(text) : null;
	} catch { /* shown as "manifest unavailable" */ }
	return { submission: shapeSubmission(row), assets, manifest };
}
