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
const POLL_MS = Number(process.env.POLL_MS ?? 30000);
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
// Result rotation. Queries may carry a batch seed suffix ("... #s3") set
// by the app — each seed pushes every source deeper into its results so
// "Fetch more" genuinely fetches MORE, not the same page again. Without
// a seed (e.g. digest queries) rotation falls back to day-of-epoch, so
// repeat daily queries still drift.
let seed = null;
const rot = (m) => (seed ?? Math.floor(Date.now() / 86400000)) % m;

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
	const off = seed ? Math.min(seed * 4, 20) : 0;
	return (d.results ?? [])
		.sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0))
		.slice(off, off + 5)
		.map((w) => {
			const auth = (w.authorships ?? []).slice(0, 2).map((a) => a.author?.display_name).filter(Boolean).join(', ');
			const venue = w.primary_location?.source?.display_name ?? '';
			// Two shapes, both always resolvable — never a rotting repository
			// file or catalog stub (bib-bvb.de etc.):
			//   • Has a DOI (journal articles) → link the DOI. The app routes
			//     it through Cooper's OpenAthens proxy: free if OA, unlocked
			//     from the paywall otherwise.
			//   • No DOI (usually canonical BOOKS — Bringhurst, Geuss, …) →
			//     a Google Books search by title+author. Never hidden, always
			//     lands on the book (preview + where to borrow/buy). Books
			//     can't go through OpenAthens (that's for e-journals), so the
			//     app links these direct.
			const doiUrl = w.doi
				|| (w.ids?.doi ? (String(w.ids.doi).startsWith('http') ? w.ids.doi : `https://doi.org/${w.ids.doi}`) : null);
			const isOa = !!w.open_access?.is_oa;
			const isBook = /book/i.test(w.type ?? '');
			let url, label;
			if (doiUrl) {
				url = doiUrl;
				label = isOa ? 'open access' : '';
			} else {
				const terms = [w.display_name, w.authorships?.[0]?.author?.display_name].filter(Boolean).join(' ');
				url = `https://www.google.com/search?tbm=bks&q=${encodeURIComponent(terms)}`;
				label = isBook ? 'book · find a copy' : 'find a copy';
			}
			return {
				kind: 'paper',
				title: w.display_name,
				url,
				snippet: [auth + (w.authorships?.length > 2 ? ' et al.' : ''), w.publication_year, venue].filter(Boolean).join(' · '),
				meta: `${(w.cited_by_count ?? 0).toLocaleString()} citations${label ? ` · ${label}` : ''}`,
				paywalled: !isOa && !!doiUrl,
				source: 'openalex',
				image: null
			};
		});
}

// Museum searches are RELEVANCE-ranked by each API, so the top matches are
// the ones that actually relate to the query. We stay inside the top ~9 and
// rotate WHICH 3 of those per seed — variety for Fetch More without paging
// off into loosely-keyword-matched junk (the old deep paging was pulling
// mostly-unrelated pieces).
const topSlice = (arr) => arr.slice(rot(3) * 3, rot(3) * 3 + 3);

// Keyword relevance guard for museums. Their search matches ANY indexed
// field (incl. descriptions we never see), so a date-painting can "match"
// text adventure via the word "text". Require a real query word (≥4 chars,
// minus generic filler) to appear in what we actually show — title/artist/
// date. Drops the coincidental matches; when a topic has no true museum
// hits (e.g. "text adventure"), that source simply returns nothing rather
// than something insulting.
const GENERIC_Q = new Set(['concepts', 'concept', 'introduction', 'intro', 'studio', 'class', 'week', 'course', 'design', 'designs', 'making', 'basics', 'fundamentals']);
// Stem to a root so morphological variants match: generative→generat
// (generated/generation), algorithms→algorithm (algorithmic). Only stems
// words long enough that the root stays distinctive.
const stem = (w) => (w.length >= 6 ? w.replace(/(ives?|ions?|ings?|ers?|als?|ics?|es|s)$/, '') : w);
const queryStems = (q) => (String(q).toLowerCase().match(/[a-z]{4,}/g) || [])
	.filter((w) => !GENERIC_Q.has(w)).map(stem).filter((w) => w.length >= 4);
const matchesQuery = (text, stems) => {
	if (!stems.length) return true;
	const t = String(text).toLowerCase();
	return stems.some((w) => t.includes(w));
};

async function searchMet(q) {
	const stems = queryStems(q);
	const r = await politeFetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(q)}&hasImages=true`);
	if (!r.ok) return [];
	const d = await r.json();
	// Fetch the top few (relevance-ranked) and keep only genuine matches.
	const ids = (d.objectIDs ?? []).slice(0, 6);
	const out = [];
	for (const id of ids) {
		const or = await politeFetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
		if (!or.ok) continue;
		const o = await or.json();
		if (!o.primaryImageSmall) continue;
		const item = {
			kind: 'artwork',
			title: o.title || '(untitled)',
			url: o.objectURL,
			snippet: [o.artistDisplayName, o.objectDate].filter(Boolean).join(' · '),
			meta: 'The Met',
			source: 'met',
			image: o.primaryImageSmall
		};
		if (matchesQuery(`${item.title} ${item.snippet} ${o.medium ?? ''} ${o.classification ?? ''}`, stems)) out.push(item);
		if (out.length >= 3) break;
	}
	return out;
}

async function searchAIC(q) {
	const stems = queryStems(q);
	const r = await politeFetch(
		`https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&limit=15&fields=id,title,artist_title,date_display,image_id,medium_display,classification_title`
	);
	if (!r.ok) return [];
	const d = await r.json();
	const items = (d.data ?? []).filter((a) => a.image_id).map((a) => ({
		kind: 'artwork',
		title: a.title,
		url: `https://www.artic.edu/artworks/${a.id}`,
		snippet: [a.artist_title, a.date_display].filter(Boolean).join(' · '),
		meta: 'Art Institute of Chicago',
		source: 'artic',
		image: `https://www.artic.edu/iiif/2/${a.image_id}/full/400,/0/default.jpg`,
		_hay: `${a.title} ${a.artist_title ?? ''} ${a.medium_display ?? ''} ${a.classification_title ?? ''}`
	}));
	return topSlice(items.filter((a) => matchesQuery(a._hay, stems))).map(({ _hay, ...a }) => a);
}

async function searchCleveland(q) {
	const stems = queryStems(q);
	const r = await politeFetch(
		`https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(q)}&limit=15&has_image=1`
	);
	if (!r.ok) return [];
	const d = await r.json();
	const items = (d.data ?? []).map((a) => ({
		kind: 'artwork',
		title: a.title,
		url: a.url,
		snippet: [(a.creators ?? []).map((c) => c.description).join(', '), a.creation_date].filter(Boolean).join(' · '),
		meta: 'Cleveland Museum of Art',
		source: 'cleveland',
		image: a.images?.web?.url ?? null,
		_hay: `${a.title} ${a.technique ?? ''} ${a.type ?? ''} ${a.department ?? ''}`
	})).filter((a) => a.url);
	return topSlice(items.filter((a) => matchesQuery(a._hay, stems))).map(({ _hay, ...a }) => a);
}

async function searchVA(q) {
	// V&A is THE design museum — its search is authoritative for design /
	// generative / computer-art topics (it holds the Nake/Verostko/Nees
	// computer-art collection). Its search records don't expose the rich
	// metadata it matched on, so the topic word often isn't in the title
	// even for a perfect hit. So: trust V&A's ranking — keyword-filter only
	// when that still leaves a healthy set, else take the top results as-is.
	const stems = queryStems(q);
	const r = await politeFetch(
		`https://api.vam.ac.uk/v2/objects/search?q=${encodeURIComponent(q)}&page_size=15&page=1&images_exist=true`
	);
	if (!r.ok) return [];
	const d = await r.json();
	const items = (d.records ?? []).map((o) => ({
		kind: 'artwork',
		title: o._primaryTitle || o.objectType || '(untitled)',
		url: `https://collections.vam.ac.uk/item/${o.systemNumber}`,
		snippet: [o._primaryMaker?.name, o._primaryDate].filter(Boolean).join(' · '),
		meta: 'V&A Museum',
		source: 'vam',
		image: o._primaryImageId ? `https://framemark.vam.ac.uk/collections/${o._primaryImageId}/full/!400,400/0/default.jpg` : null,
		_hay: `${o._primaryTitle ?? ''} ${o.objectType ?? ''} ${o._primaryMaker?.name ?? ''}`
	}));
	const kept = items.filter((a) => matchesQuery(a._hay, stems));
	return topSlice(kept.length >= 2 ? kept : items).map(({ _hay, ...a }) => a);
}

// Europeana — aggregates 3,000+ European institutions incl. Ars Electronica
// and ZKM (the media / computer / generative-art archives the encyclopedic
// US museums lack). Relevance-ranked and genuinely on-topic, so trusted like
// V&A. Free API; api2demo works but a personal key (pro.europeana.eu) lifts
// the rate limit — set EUROPEANA_KEY to use it. Each result shows its real
// providing institution (Ars Electronica, Computer Museum, …) as the label.
async function searchEuropeana(q) {
	const stems = queryStems(q);
	const key = process.env.EUROPEANA_KEY || 'api2demo';
	const r = await politeFetch(
		`https://api.europeana.eu/record/v2/search.json?wskey=${key}&query=${encodeURIComponent(q)}&rows=15&media=true&qf=TYPE:IMAGE&profile=rich`
	);
	if (!r.ok) return [];
	const d = await r.json();
	const first = (v) => (Array.isArray(v) ? v[0] : v);
	const items = (d.items ?? []).filter((it) => it.edmPreview).map((it) => ({
		kind: 'artwork',
		title: first(it.title) || '(untitled)',
		url: first(it.edmIsShownAt) || it.guid,
		snippet: [first(it.dcCreator), first(it.year)].filter(Boolean).join(' · '),
		meta: first(it.dataProvider) || 'Europeana',
		source: 'europeana',
		image: first(it.edmPreview),
		_hay: `${Array.isArray(it.title) ? it.title.join(' ') : (it.title ?? '')} ${first(it.dcCreator) ?? ''}`
	})).filter((a) => a.url);
	const kept = items.filter((a) => matchesQuery(a._hay, stems));
	return topSlice(kept.length >= 2 ? kept : items).map(({ _hay, ...a }) => a);
}

// Top channels about the topic. Kept and returned so the "are.na channels"
// section stays; also reused as the source for topical images below.
async function arenaTopChannels(q, n = 3) {
	const r = await politeFetch(`https://api.are.na/v2/search/channels?q=${encodeURIComponent(q)}&per=6&page=${rot(4) + 1}`);
	if (!r.ok) return [];
	const d = await r.json();
	return (d.channels ?? []).filter((c) => (c.length ?? 0) > 0).slice(0, n);
}

async function searchArenaChannels(q) {
	const chans = await arenaTopChannels(q, 4);
	return chans.map((c) => ({
		kind: 'channel',
		meta: `are.na · ${c.follower_count ?? 0} followers`,
		title: c.title,
		url: `https://www.are.na/${c.owner_slug}/${c.slug}`,
		snippet: `are.na channel — ${c.length ?? 0} blocks`,
		source: 'are.na',
		image: null
	}));
}

// IMAGE blocks that live INSIDE the top channels about this topic. Curation
// by a well-followed topical channel is the quality signal (are.na's search
// doesn't expose per-block likes, and its block-search endpoint is flaky).
// Pulls from the two strongest channels; the seed rotates which slice so
// Fetch More brings new images.
async function searchArenaImages(q) {
	const chans = await arenaTopChannels(q, 2);
	const out = [];
	for (const ch of chans) {
		const r = await politeFetch(`https://api.are.na/v2/channels/${ch.slug}/contents?per=16&direction=desc`);
		if (!r.ok) continue;
		const d = await r.json();
		const imgs = (d.contents ?? []).filter((b) => b && b.class === 'Image' && b.image);
		for (const b of imgs.slice(rot(4) * 3, rot(4) * 3 + 3)) {
			out.push({
				kind: 'arena_img',
				title: b.title || b.generated_title || ch.title,
				url: `https://www.are.na/block/${b.id}`,
				snippet: `in “${ch.title}”`,
				meta: `are.na · ${ch.follower_count ?? 0} followers`,
				source: 'are.na',
				image: b.image?.thumb?.url || b.image?.display?.url || null
			});
		}
	}
	return out.filter((b) => b.image);
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
	const m = String(query).match(/\s*#s(\d+)\s*$/);
	seed = m ? Number(m[1]) : null;
	if (m) query = String(query).slice(0, m.index);
	const out = [];
	for (const part of splitQuery(query)) {
		const [papers, chans, arenaImgs, wiki, met, aic, cle, vam, euro] = await Promise.all([
			searchOpenAlexSeminal(part).catch(() => []),
			searchArenaChannels(part).catch(() => []),
			searchArenaImages(part).catch(() => []),
			searchWikipedia(part).catch(() => []),
			searchMet(part).catch(() => []),
			searchAIC(part).catch(() => []),
			searchCleveland(part).catch(() => []),
			searchVA(part).catch(() => []),
			searchEuropeana(part).catch(() => [])
		]);
		out.push(...papers, ...chans, ...arenaImgs, ...wiki, ...met, ...aic, ...cle, ...vam, ...euro);
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
