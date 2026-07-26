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
// Museum/are.na results rotate their result page daily so the same
// interests surface NEW finds each day; papers deliberately don't rotate
// (the canonical set should stay the canonical set).
const dayRot = () => Math.floor(Date.now() / 86400000) % 4;

// Seminal papers: OpenAlex sorted by RELEVANCE first (raw citation sort
// surfaces off-topic AI megapapers), then the top-25 relevant re-ranked
// by citations. Result: the most-cited works about THIS topic — the
// stuff everyone in a field has read.
async function searchOpenAlexSeminal(q) {
	// Exact-phrase search — unquoted, any interest containing "generative"
	// (or similar hot words) drowns in the generative-AI paper flood.
	// Quoted, "generative art" surfaces Galanter/Boden, not ChatGPT takes.
	const r = await politeFetch(
		`https://api.openalex.org/works?search=${encodeURIComponent(`"${q}"`)}&per-page=25&filter=cited_by_count:%3E24,type:article|book-chapter|book&mailto=richardyurewitch@gmail.com`
	);
	if (!r.ok) return [];
	const d = await r.json();
	return (d.results ?? [])
		.sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0))
		.slice(0, 5)
		.map((w) => {
			const auth = (w.authorships ?? []).slice(0, 2).map((a) => a.author?.display_name).filter(Boolean).join(', ');
			const venue = w.primary_location?.source?.display_name ?? '';
			return {
				kind: 'paper',
				title: w.display_name,
				url: w.doi || w.primary_location?.landing_page_url || w.id,
				snippet: [auth + (w.authorships?.length > 2 ? ' et al.' : ''), w.publication_year, venue].filter(Boolean).join(' · '),
				meta: `${(w.cited_by_count ?? 0).toLocaleString()} citations`,
				source: 'openalex',
				image: null
			};
		});
}

async function searchMet(q) {
	const r = await politeFetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(q)}&hasImages=true`);
	if (!r.ok) return [];
	const d = await r.json();
	const ids = (d.objectIDs ?? []).slice(dayRot() * 3, dayRot() * 3 + 3);
	const out = [];
	for (const id of ids) {
		const or = await politeFetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
		if (!or.ok) continue;
		const o = await or.json();
		if (!o.primaryImageSmall) continue;
		out.push({
			kind: 'artwork',
			title: o.title || '(untitled)',
			url: o.objectURL,
			snippet: [o.artistDisplayName, o.objectDate].filter(Boolean).join(' · '),
			meta: 'The Met',
			source: 'met',
			image: o.primaryImageSmall
		});
	}
	return out;
}

async function searchAIC(q) {
	const r = await politeFetch(
		`https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&limit=3&page=${dayRot() + 1}&fields=id,title,artist_title,date_display,image_id`
	);
	if (!r.ok) return [];
	const d = await r.json();
	return (d.data ?? [])
		.filter((a) => a.image_id)
		.map((a) => ({
			kind: 'artwork',
			title: a.title,
			url: `https://www.artic.edu/artworks/${a.id}`,
			snippet: [a.artist_title, a.date_display].filter(Boolean).join(' · '),
			meta: 'Art Institute of Chicago',
			source: 'artic',
			image: `https://www.artic.edu/iiif/2/${a.image_id}/full/400,/0/default.jpg`
		}));
}

async function searchCleveland(q) {
	const r = await politeFetch(
		`https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(q)}&limit=3&skip=${dayRot() * 3}&has_image=1`
	);
	if (!r.ok) return [];
	const d = await r.json();
	return (d.data ?? []).map((a) => ({
		kind: 'artwork',
		title: a.title,
		url: a.url,
		snippet: [(a.creators ?? []).map((c) => c.description).join(', '), a.creation_date].filter(Boolean).join(' · '),
		meta: 'Cleveland Museum of Art',
		source: 'cleveland',
		image: a.images?.web?.url ?? null
	})).filter((a) => a.url);
}

async function searchVA(q) {
	const r = await politeFetch(
		`https://api.vam.ac.uk/v2/objects/search?q=${encodeURIComponent(q)}&page_size=3&page=${dayRot() + 1}&images_exist=true`
	);
	if (!r.ok) return [];
	const d = await r.json();
	return (d.records ?? []).map((o) => ({
		kind: 'artwork',
		title: o._primaryTitle || o.objectType || '(untitled)',
		url: `https://collections.vam.ac.uk/item/${o.systemNumber}`,
		snippet: [o._primaryMaker?.name, o._primaryDate].filter(Boolean).join(' · '),
		meta: 'V&A Museum',
		source: 'vam',
		image: o._primaryImageId ? `https://framemark.vam.ac.uk/collections/${o._primaryImageId}/full/!400,400/0/default.jpg` : null
	}));
}

async function searchArenaChannels(q) {
	const r = await politeFetch(`https://api.are.na/v2/search/channels?q=${encodeURIComponent(q)}&per=4`);
	if (!r.ok) return [];
	const d = await r.json();
	return (d.channels ?? []).map((c) => ({
		kind: 'channel',
		meta: `are.na · ${c.follower_count ?? 0} followers`,
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
			kind: 'link',
			meta: 'are.na block',
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
		kind: 'article',
		meta: 'Wikipedia',
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
	const parts = String(q)
		.split(/[,;/]| and /i)
		.map((s) => s.trim()
			// "academic writing on generative art" → "generative art":
			// meta-words about the KIND of material wanted would otherwise
			// dominate search relevance (and break exact-phrase matching).
			.replace(/^(?:finding\s+)?(?:academic\s+)?(?:writing|papers?|research|scholarship|readings?|articles?|essays?|books?)\s+(?:on|about|in)\s+/i, '')
			.trim())
		.filter((s) => s.length > 2);
	return (parts.length ? parts : [q]).slice(0, 3);
}

async function runSearch(query) {
	const out = [];
	for (const part of splitQuery(query)) {
		const [papers, chans, blocks, wiki, met, aic, cle, vam] = await Promise.all([
			searchOpenAlexSeminal(part).catch(() => []),
			searchArenaChannels(part).catch(() => []),
			searchArenaBlocks(part).catch(() => []),
			searchWikipedia(part).catch(() => []),
			searchMet(part).catch(() => []),
			searchAIC(part).catch(() => []),
			searchCleveland(part).catch(() => []),
			searchVA(part).catch(() => [])
		]);
		out.push(...papers, ...chans, ...blocks, ...wiki, ...met, ...aic, ...cle, ...vam);
	}
	// de-dupe by URL, keep order
	const seen = new Set();
	return out.filter((r) => r.url && !seen.has(r.url) && seen.add(r.url)).slice(0, 40);
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
