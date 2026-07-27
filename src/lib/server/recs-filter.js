// Pure filtering for Scout results → recommendation items. No DB — used both
// when writing recs to RTDB (job POST) and anywhere results are sanitized.

export const BASE_QUOTA = { paper: 5, arena_img: 6, artwork: 12, channel: 4, channel_orbit: 3, article: 3, link: 4 };

// Library catalog-record / resolver stubs that 404 or break OpenAthens.
const JUNK_URL = /bib-bvb\.de|func=service|doc_library=|func_code=|worldcat\.org|base-search\.net/i;

// Encyclopedic fine-art museums whose topic-search returns classical filler —
// require a query word in the shown fields. V&A / Europeana / Rijksmuseum /
// museum_artist / are.na are trusted by their own ranking.
const MUSEUM_STRICT = new Set(['met', 'artic', 'cleveland', 'harvard']);
const GENERIC_Q = new Set(['concepts', 'concept', 'introduction', 'intro', 'studio', 'class', 'week', 'course', 'design', 'designs', 'making', 'basics', 'fundamentals', 'academic', 'writing', 'research', 'scholarship']);
const stemWord = (w) => (w.length >= 6 ? w.replace(/(ically|ical|isms?|ists?|ives?|ions?|ings?|ances?|ences?|ers?|ors?|als?|ics?|ies|ys?|es|s)$/, '') : w);
export const queryStems = (q) => (String(q).toLowerCase().replace(/#s\d+\s*$/, '').match(/[a-z]{4,}/g) || [])
	.filter((w) => !GENERIC_Q.has(w)).map(stemWord).filter((w) => w.length >= 4);

function museumRelevant(r, stems) {
	if ((r.kind ?? '') !== 'artwork' || !MUSEUM_STRICT.has(r.source)) return true;
	if (!stems.length) return true;
	const t = `${r.title ?? ''} ${r.snippet ?? ''} ${r.meta ?? ''}`.toLowerCase();
	return stems.some((w) => t.includes(w));
}

// A DOI resolver URL (https://doi.org/…, dx.doi.org, …) or a Google Books
// find-a-copy search. NOTE: the host is preceded by `//`, so the pattern must
// allow a slash before "doi.org" — an earlier `(^|\.)` version silently
// rejected every real DOI (masked only because old rows persisted in Turso).
const PAPER_URL = /^https?:\/\/([a-z0-9-]+\.)*doi\.org\//i;
const BOOK_SEARCH = /google\.[^/]+\/search/i;

function usableUrl(r) {
	const url = String(r?.url ?? '').replace(/&amp;/g, '&');
	if (!/^https?:\/\//i.test(url) || JUNK_URL.test(url)) return null;
	if ((r.kind ?? 'link') === 'paper' && !PAPER_URL.test(url) && !BOOK_SEARCH.test(url)) return null;
	return url;
}

// Filter + per-kind quota. Returns clean item objects ready to store.
export function filterResults(results, query) {
	const stems = queryStems(query);
	const taken = {};
	const out = [];
	for (const r of Array.isArray(results) ? results : []) {
		if (!museumRelevant(r, stems)) continue;
		const url = usableUrl(r);
		if (!url) continue;
		const kind = r.kind ?? 'link';
		taken[kind] = (taken[kind] ?? 0) + 1;
		if (taken[kind] > (BASE_QUOTA[kind] ?? 4)) continue;
		out.push({
			kind,
			source: r.source ?? null,
			title: r.title ?? '(untitled)',
			url,
			snippet: r.snippet ?? '',
			meta: r.meta ?? '',
			image: r.image ?? null,
			paywalled: r.paywalled ? 1 : 0
		});
	}
	return out;
}
