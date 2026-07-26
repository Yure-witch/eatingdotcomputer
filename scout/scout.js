#!/usr/bin/env node
// Scout — eating.computer research worker.
//
// Runs on kahan (or any box with outbound HTTPS). Polls the app for
// queued search jobs, looks things up on are.na + Wikipedia, and posts
// link results back. No inbound ports needed, no npm install needed —
// plain Node 18+ (global fetch).
//
//   EATING_URL=https://eating.computer SCOUT_TOKEN=... node scout.js
//
// Politeness rules baked in: identified User-Agent, ≥1s between requests
// to the same host, 12s timeouts, official/public APIs only.

const APP = (process.env.EATING_URL ?? 'https://eating.computer').replace(/\/$/, '');
const TOKEN = process.env.SCOUT_TOKEN;
const POLL_MS = Number(process.env.POLL_MS ?? 15000);
const UA = 'eating.computer-scout/1.0 (Cooper Union class project; contact: richardyurewitch@gmail.com)';

if (!TOKEN) {
	console.error('SCOUT_TOKEN is required (same value as the app\'s SCOUT_TOKEN env var)');
	process.exit(1);
}

// ── polite fetch: per-host spacing + timeout ─────────────────────────────
const lastHit = new Map();
async function politeFetch(url, opts = {}) {
	const host = new URL(url).host;
	const wait = (lastHit.get(host) ?? 0) + 1000 - Date.now();
	if (wait > 0) await sleep(wait);
	lastHit.set(host, Date.now());
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 12000);
	try {
		return await fetch(url, {
			...opts,
			signal: ctrl.signal,
			headers: { 'User-Agent': UA, ...(opts.headers ?? {}) }
		});
	} finally { clearTimeout(t); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── sources ──────────────────────────────────────────────────────────────
async function searchArenaChannels(q) {
	const r = await politeFetch(`https://api.are.na/v2/search/channels?q=${encodeURIComponent(q)}&per=4`);
	if (!r.ok) return [];
	const d = await r.json();
	return (d.channels ?? []).map((c) => ({
		title: c.title,
		url: `https://www.are.na/${c.owner_slug}/${c.slug}`,
		snippet: `are.na channel — ${c.length ?? 0} blocks, ${c.follower_count ?? 0} followers`,
		source: 'are.na',
		image: null
	}));
}

async function searchArenaBlocks(q) {
	const r = await politeFetch(`https://api.are.na/v2/search/blocks?q=${encodeURIComponent(q)}&per=4`);
	if (!r.ok) return [];
	const d = await r.json();
	return (d.blocks ?? [])
		.map((b) => ({
			title: b.title || b.generated_title || '(untitled block)',
			url: b.source?.url || `https://www.are.na/block/${b.id}`,
			snippet: [b.class, b.description ? String(b.description).slice(0, 160) : null].filter(Boolean).join(' — '),
			source: 'are.na',
			image: b.image?.thumb?.url ?? null
		}))
		.filter((b) => b.url);
}

async function searchWikipedia(q) {
	const r = await politeFetch(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=3`);
	if (!r.ok) return [];
	const d = await r.json();
	return (d.pages ?? []).map((p) => ({
		title: p.title,
		url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
		snippet: String(p.excerpt ?? '').replace(/<[^>]+>/g, '').slice(0, 200),
		source: 'wikipedia',
		image: p.thumbnail?.url ? (p.thumbnail.url.startsWith('//') ? 'https:' + p.thumbnail.url : p.thumbnail.url) : null
	}));
}

// A student's interests field is often a comma list ("riso printing,
// generative art, techno"). Search each phrase, cap total sub-queries.
function splitQuery(q) {
	const parts = String(q).split(/[,;/]| and /i).map((s) => s.trim()).filter((s) => s.length > 2);
	return (parts.length ? parts : [q]).slice(0, 3);
}

async function runSearch(query) {
	const out = [];
	for (const part of splitQuery(query)) {
		const [chans, blocks, wiki] = await Promise.all([
			searchArenaChannels(part).catch(() => []),
			searchArenaBlocks(part).catch(() => []),
			searchWikipedia(part).catch(() => [])
		]);
		out.push(...chans, ...blocks, ...wiki);
	}
	// de-dupe by URL, keep order
	const seen = new Set();
	return out.filter((r) => r.url && !seen.has(r.url) && seen.add(r.url)).slice(0, 18);
}

// ── job loop ─────────────────────────────────────────────────────────────
async function poll() {
	const r = await fetch(`${APP}/api/scout/jobs`, {
		headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA }
	});
	if (!r.ok) throw new Error(`poll ${r.status}`);
	const { jobs } = await r.json();
	for (const job of jobs ?? []) {
		console.log(`[${new Date().toISOString()}] job #${job.id} (${job.kind}): ${job.query}`);
		let payload;
		try {
			if (job.kind !== 'search') throw new Error(`unknown kind: ${job.kind}`);
			payload = { id: job.id, result: await runSearch(job.query) };
			console.log(`  → ${payload.result.length} results`);
		} catch (e) {
			payload = { id: job.id, error: String(e?.message ?? e) };
			console.log(`  → error: ${payload.error}`);
		}
		await fetch(`${APP}/api/scout/jobs`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': UA },
			body: JSON.stringify(payload)
		});
	}
	return (jobs ?? []).length;
}

let failures = 0;
console.log(`scout up — polling ${APP} every ${POLL_MS / 1000}s`);
// eslint-disable-next-line no-constant-condition
while (true) {
	try {
		const n = await poll();
		failures = 0;
		// If we just did work, check again right away — more may be queued.
		await sleep(n > 0 ? 1000 : POLL_MS);
	} catch (e) {
		failures++;
		const backoff = Math.min(POLL_MS * 2 ** Math.min(failures, 5), 10 * 60 * 1000);
		console.error(`poll failed (${e?.message ?? e}) — retrying in ${Math.round(backoff / 1000)}s`);
		await sleep(backoff);
	}
}
