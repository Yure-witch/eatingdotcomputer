#!/usr/bin/env node
/**
 * Download every student's Work Archive to a local folder: manifests, every
 * image/video/PDF, plus class-level indexes for reporting.
 *
 *   node scripts/export-work-archive.js                  # latest archive per student → ./work-archive-export
 *   node scripts/export-work-archive.js --out ~/Documents/ica-archive
 *   node scripts/export-work-archive.js --history        # every completed submission, not just the latest
 *
 * Output:
 *   <out>/index.html      offline gallery: every student, project, hero image (open it in a browser)
 *   <out>/index.json      one entry per archive: student, consent, counts, folder
 *   <out>/projects.csv    one row per project — for funding reports / spreadsheets
 *   <out>/<student>/<date>-<id>/manifest.json + images/…   exactly as uploaded
 *
 * Re-runnable: files already on disk at the right size are skipped. Student
 * work is personal data — the default folder is gitignored; keep it that way.
 */
import { config } from 'dotenv';
import { createClient } from '@libsql/client';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

config({ path: '.env', quiet: true });

const args = process.argv.slice(2);
const outArg = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'work-archive-export';
const OUT = resolve(outArg.replace(/^~(?=\/|$)/, homedir()));
const HISTORY = args.includes('--history');
const SITE = 'https://www.eating.computer';

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const r2 = new S3Client({
	region: 'auto',
	endpoint: process.env.R2_ENDPOINT ?? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
});
const Bucket = process.env.R2_BUCKET;

const slug = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'student';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const csv = (v) => {
	const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const t = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const list = (v) => (Array.isArray(v) ? v : []);
const o = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

async function download(key, dest, size) {
	const have = await stat(dest).catch(() => null);
	if (have && have.size === size) return false;
	await mkdir(dirname(dest), { recursive: true });
	const res = await r2.send(new GetObjectCommand({ Bucket, Key: key }));
	await pipeline(res.Body, createWriteStream(dest));
	return true;
}

const rows = (await db.execute(`
	SELECT s.*, u.name AS user_name, u.email AS user_email
	FROM archive_submissions s JOIN users u ON u.id = s.user_id
	WHERE s.status = 'complete'
	ORDER BY u.name COLLATE NOCASE, s.completed_at DESC`)).rows;
const picked = HISTORY ? rows : rows.filter((r, i) => i === 0 || String(rows[i - 1].user_id) !== String(r.user_id));
console.log(`${picked.length} archive${picked.length === 1 ? '' : 's'} → ${OUT}`);

await mkdir(OUT, { recursive: true });
const index = [];
const csvRows = [[
	'student', 'credit_as', 'funding_ok', 'public_ok', 'quotes_ok', 'project_id', 'title', 'status', 'one_liner',
	'kind', 'assignment', 'self_initiated', 'started', 'completed', 'hours', 'ai_tools', 'share_ai_generated',
	'role_of_student', 'live_url', 'repo_url', 'media_files', 'archive_folder', 'archive_url'
]];
let fetched = 0;
let skipped = 0;

for (const r of picked) {
	const name = String(r.user_name ?? r.user_email ?? 'student');
	const folderRel = `${slug(name)}/${String(r.completed_at).slice(0, 10)}-${String(r.id).slice(0, 8)}`;
	const folder = join(OUT, folderRel);
	const assets = (await db.execute({
		sql: 'SELECT path, r2_key, size FROM archive_assets WHERE submission_id = ? AND uploaded = 1 ORDER BY path',
		args: [r.id]
	})).rows;
	for (const a of assets) {
		const changed = await download(String(a.r2_key), join(folder, String(a.path)), Number(a.size));
		changed ? fetched++ : skipped++;
	}

	let m = {};
	try {
		m = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
	} catch { console.warn(`  ! ${name}: manifest unreadable`); }
	const c = o(m.consent);
	const projects = list(m.projects).filter((p) => p && typeof p === 'object');
	index.push({
		student: name,
		email: String(r.user_email ?? ''),
		submissionId: String(r.id),
		completedAt: String(r.completed_at),
		folder: folderRel,
		url: `${SITE}/app/archive/${r.id}`,
		consent: {
			funding: c.use_in_funding_reports === true,
			showcase: c.use_in_public_showcase === true,
			quotes: c.quote_permission === true,
			attribution: c.attribution ?? null
		},
		counts: { projects: Number(r.project_count), ideas: Number(r.idea_count), files: Number(r.asset_count), bytes: Number(r.total_bytes) },
		projects: projects.map((p) => ({ id: t(p.id), title: t(p.title), status: t(p.status), one_liner: t(p.one_liner), hero: t(p.hero_asset) || t(o(list(p.assets)[0]).path) || t(list(p.assets)[0]) }))
	});
	for (const p of projects) {
		const ai = o(p.ai_usage);
		const tech = o(p.technical);
		csvRows.push([
			name, c.attribution, c.use_in_funding_reports, c.use_in_public_showcase, c.quote_permission,
			t(p.id), t(p.title), t(p.status), t(p.one_liner),
			list(p.kind).map(t), t(o(p.course_connection).assignment), o(p.course_connection).self_initiated ?? '',
			t(o(p.dates).started), t(o(p.dates).completed), p.time_spent_hours ?? '',
			list(ai.tools).map((x) => (typeof x === 'string' ? x : t(o(x).name))), t(ai.share_ai_generated), t(ai.role_of_student),
			t(tech.live_url), t(tech.repo_url), list(p.assets).length, folderRel, `${SITE}/app/archive/${r.id}`
		].map(csv));
	}
	console.log(`  ✓ ${name}: ${projects.length} projects, ${assets.length} files`);
}

await writeFile(join(OUT, 'index.json'), JSON.stringify({ exportedAt: new Date().toISOString(), archives: index }, null, 2));
await writeFile(join(OUT, 'projects.csv'), csvRows.map((row) => row.join(',')).join('\n') + '\n');

const totals = index.reduce((a, x) => ({ p: a.p + x.counts.projects, i: a.i + x.counts.ideas, f: a.f + x.counts.files }), { p: 0, i: 0, f: 0 });
const isImg = (p) => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(p);
await writeFile(join(OUT, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Work Archive export</title>
<style>
:root{--ink:#111;--paper:#faf7f2;--muted:#6b645c;--line:#ddd6cc}
@media (prefers-color-scheme:dark){:root{--ink:#eee;--paper:#141414;--muted:#a49c92;--line:#333}}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{margin:0 0 4px}h2{margin:40px 0 4px;border-top:1px solid var(--line);padding-top:24px}
.dim{color:var(--muted)}.chip{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:99px;padding:1px 8px;margin:2px 4px 2px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:16px;margin-top:12px}
.card{border:1px solid var(--line);border-radius:12px;overflow:hidden}.card img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:var(--line)}
.card div{padding:8px 10px}.card b{display:block}a{color:inherit}
</style></head><body><main>
<h1>Work Archive</h1>
<p class="dim">Exported ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} · ${index.length} students · ${totals.p} projects · ${totals.i} ideas · ${totals.f} files</p>
${index.map((x) => `<h2>${esc(x.student)}</h2>
<p class="dim">${esc(x.completedAt.slice(0, 10))} · ${x.counts.projects} projects · ${x.counts.ideas} ideas · ${x.counts.files} files ·
<a href="${esc(x.folder)}/manifest.json">manifest.json</a> · <a href="${esc(x.url)}">online</a></p>
<p><span class="chip">funding ${x.consent.funding ? '✓' : '✗'}</span><span class="chip">public ${x.consent.showcase ? '✓' : '✗'}</span><span class="chip">quotes ${x.consent.quotes ? '✓' : '✗'}</span><span class="chip">credit: ${esc(x.consent.attribution ?? '—')}</span></p>
<div class="grid">${x.projects.map((p) => `<div class="card">${p.hero && isImg(p.hero) ? `<a href="${esc(x.folder)}/${esc(p.hero)}"><img src="${esc(x.folder)}/${esc(p.hero)}" alt="" loading="lazy"></a>` : ''}<div><b>${esc(p.title || p.id)}</b><span class="dim">${esc(p.status)}</span><br>${esc(p.one_liner)}</div></div>`).join('')}</div>`).join('\n')}
</main></body></html>
`);

console.log(`\n${fetched} files downloaded, ${skipped} already present.`);
console.log(`Open ${join(OUT, 'index.html')}`);
