#!/usr/bin/env node
// eating.computer Work Archive: reference uploader (protocol eating.computer/work-archive@1)
// Spec: https://www.eating.computer/work-archive/PROTOCOL.md
//
// Zero dependencies, Node 18+.
//
//   EATING_ARCHIVE_TOKEN=ecwa_… node upload.mjs <archive-folder> [--check] [--agent "Claude Code · model"]
//
//   <archive-folder>  folder with manifest.json at its top level, plus images/…
//   --check           dry run: validate the manifest against the files, upload nothing
//   --agent "…"       who built the archive (recorded with the submission)
//
// What it does:
//   1. Lists the folder; skips hidden files and unsupported types (and says so).
//   2. Sends the manifest + file list to /api/archive/validate. Stops on errors.
//   3. Creates a submission, presigns files in batches of 50, PUTs each one
//      straight to storage, and uploads manifest.json last.
//   4. Calls /complete, which re-validates against what actually arrived.
//      On success, prints the archive URL. On failure, prints the errors and
//      deletes the unfinished submission so a re-run starts clean.
//
// Only talks to EATING_ARCHIVE_URL (default https://www.eating.computer) and to
// the presigned storage URLs that server hands back. The token is read from the
// environment and is never printed or written anywhere.

import { readdir, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep, resolve } from 'node:path';

const BASE = (process.env.EATING_ARCHIVE_URL || 'https://www.eating.computer').replace(/\/$/, '');
const TOKEN = process.env.EATING_ARCHIVE_TOKEN || '';
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const agentIdx = args.indexOf('--agent');
const AGENT = agentIdx >= 0 ? String(args[agentIdx + 1] || '') : 'upload.mjs';
const dirArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--agent');

const TYPES = {
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
	avif: 'image/avif', svg: 'image/svg+xml', heic: 'image/heic',
	mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
	pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain'
};
const BATCH = 50;
const CONCURRENCY = 4;

function die(msg, code = 2) {
	console.error(`✗ ${msg}`);
	process.exit(code);
}
if (!dirArg) die('usage: EATING_ARCHIVE_TOKEN=ecwa_… node upload.mjs <archive-folder> [--check] [--agent "…"]');
if (!/^ecwa_[A-Za-z0-9_-]{20,}$/.test(TOKEN)) die('Set EATING_ARCHIVE_TOKEN to the student\'s token (it starts with ecwa_). Get one at https://www.eating.computer/app/archive');

const ROOT = resolve(dirArg);

function validPath(p) {
	if (p.length > 200) return false;
	const segs = p.split('/');
	return segs.length <= 6 && segs.every((s) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) && !s.includes('..'));
}

async function walk(dir, out = []) {
	for (const ent of await readdir(dir, { withFileTypes: true })) {
		if (ent.name.startsWith('.') || ent.name === '__MACOSX' || ent.name === 'node_modules') continue;
		const full = join(dir, ent.name);
		if (ent.isDirectory()) await walk(full, out);
		else if (ent.isFile()) out.push(full);
	}
	return out;
}

async function api(method, path, body) {
	const res = await fetch(BASE + path, {
		method,
		headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined
	});
	let data = null;
	try { data = await res.json(); } catch { /* non-JSON */ }
	return { status: res.status, ok: res.ok, data };
}

function report(data) {
	for (const e of data?.errors ?? []) console.log(`  ERROR   ${e.message}${e.at ? `  (${e.at})` : ''}`);
	for (const w of data?.warnings ?? []) console.log(`  warning ${w.message}${w.at ? `  (${w.at})` : ''}`);
}

function sha256File(full) {
	return new Promise((res, rej) => {
		const h = createHash('sha256');
		createReadStream(full).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej);
	});
}

async function putWithRetry(u, bytes) {
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(u.url, { method: 'PUT', headers: u.headers, body: bytes });
			if (res.ok) return;
			if (attempt >= 3 || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) {
				throw new Error(`storage returned ${res.status}`);
			}
		} catch (e) {
			if (attempt >= 3) throw e;
		}
		await new Promise((r) => setTimeout(r, 800 * attempt));
	}
}

// ── 1. Inventory ──────────────────────────────────────────────────────────
const st = await stat(ROOT).catch(() => null);
if (!st?.isDirectory()) die(`${ROOT} is not a folder`);
const files = [];
const skipped = [];
for (const full of await walk(ROOT)) {
	const rel = relative(ROOT, full).split(sep).join('/');
	const ext = rel.split('.').pop().toLowerCase();
	if (rel !== 'manifest.json' && !TYPES[ext]) { skipped.push(`${rel} (type not accepted)`); continue; }
	if (!validPath(rel)) { skipped.push(`${rel} (rename: letters, digits, . _ - only, no spaces)`); continue; }
	const { size } = await stat(full);
	if (!size) { skipped.push(`${rel} (empty)`); continue; }
	files.push({ path: rel, full, size });
}
const manifestFile = files.find((f) => f.path === 'manifest.json');
if (!manifestFile) die(`No manifest.json at the top of ${ROOT}`);
let manifest;
try {
	manifest = JSON.parse(await readFile(manifestFile.full, 'utf8'));
} catch (e) {
	die(`manifest.json is not valid JSON: ${e.message}`, 1);
}
const totalBytes = files.reduce((a, f) => a + f.size, 0);
console.log(`• ${files.length} files, ${(totalBytes / 1048576).toFixed(1)} MB in ${ROOT}`);
for (const s of skipped) console.log(`  skipped ${s}`);

// ── 2. Who am I + dry-run validation ──────────────────────────────────────
const me = await api('GET', '/api/archive');
if (!me.ok) die(`Token check failed (${me.status}): ${me.data?.message ?? 'unknown error'}`);
console.log(`• Uploading as ${me.data.you?.name ?? '?'} to ${BASE}`);

if (manifestFile.size < 3.5 * 1048576) {
	const v = await api('POST', '/api/archive/validate', {
		manifest,
		files: files.map((f) => ({ path: f.path, size: f.size }))
	});
	if (v.status !== 200 && v.status !== 422) die(`Validation call failed (${v.status}): ${v.data?.message ?? ''}`);
	console.log(`• Validation: ${v.data.errors.length} errors, ${v.data.warnings.length} warnings`);
	report(v.data);
	if (!v.data.ok) die('Fix the errors above, then run again. Nothing was uploaded.', 1);
} else {
	console.log('• manifest.json is over 3.5 MB; skipping the dry run (the server still validates on complete)');
}
if (CHECK) {
	console.log('✓ Dry run passed. Run again without --check to upload.');
	process.exit(0);
}

// ── 3. Upload ─────────────────────────────────────────────────────────────
const created = await api('POST', '/api/archive/submissions', { agent: AGENT });
if (!created.ok) die(`Could not start a submission (${created.status}): ${created.data?.message ?? ''}`);
const id = created.data.id;
console.log(`• Submission ${id}`);

const ordered = [...files.filter((f) => f.path !== 'manifest.json'), manifestFile];
let done = 0;
try {
	for (let i = 0; i < ordered.length; i += BATCH) {
		const batch = ordered.slice(i, i + BATCH);
		// Hash by streaming and read bytes only at PUT time, so a batch of
		// large videos never sits in memory at once.
		const withHash = await Promise.all(batch.map(async (f) => ({ ...f, sha256: await sha256File(f.full) })));
		const pre = await api('POST', `/api/archive/submissions/${id}/files`, {
			files: withHash.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 }))
		});
		if (!pre.ok) throw new Error(`presign failed (${pre.status}): ${pre.data?.message ?? ''}`);
		for (const r of pre.data.rejected ?? []) console.log(`  rejected ${r.path}: ${r.reason}`);
		const byPath = new Map(withHash.map((f) => [f.path, f]));
		const queue = [...pre.data.uploads];
		await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
			for (let u = queue.shift(); u; u = queue.shift()) {
				await putWithRetry(u, await readFile(byPath.get(u.path).full));
				done++;
				// Agents capture output rather than watching a terminal: a \r
				// progress line reads as one run-on line there, so log milestones.
				if (process.stdout.isTTY) process.stdout.write(`\r• Uploaded ${done}/${ordered.length}`);
				else if (done === ordered.length || done % 25 === 0) console.log(`• Uploaded ${done}/${ordered.length}`);
			}
		}));
	}
	if (process.stdout.isTTY) process.stdout.write('\n');
} catch (e) {
	if (process.stdout.isTTY) process.stdout.write('\n');
	await api('DELETE', `/api/archive/submissions/${id}`);
	die(`Upload failed: ${e.message}. The unfinished submission was removed; run again.`);
}

// ── 4. Complete ───────────────────────────────────────────────────────────
const fin = await api('POST', `/api/archive/submissions/${id}/complete`);
if (fin.status === 200 && fin.data?.ok) {
	report(fin.data);
	console.log(`✓ Archived: ${fin.data.stats.projects} projects, ${fin.data.stats.ideas} ideas, ${fin.data.stats.assets} files`);
	console.log(`  ${fin.data.url}`);
	console.log(JSON.stringify({ ok: true, id, url: fin.data.url, stats: fin.data.stats, warnings: fin.data.warnings.length }));
	process.exit(0);
}
report(fin.data);
await api('DELETE', `/api/archive/submissions/${id}`);
die(`Complete was rejected (${fin.status}${fin.data?.message ? `: ${fin.data.message}` : ''}). Fix the errors above and run again.`, 1);
