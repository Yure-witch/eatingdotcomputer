// Gemma tags the Inspiration gallery.
//
// A FIXED vocabulary, not free-form. Free tags from a small model drift —
// "typography", "type", "fonts" and "typographic" would all show up within a
// dozen links and the filter bar would be useless. A closed list means every
// tag is a filter someone can actually click, and a wrong tag is visibly wrong
// rather than merely unfamiliar.
//
// Richard's list, plus the ones a design class kept implying.
import { resolveAiCreds } from '$lib/server/ai-creds.js';

export const TAGS = [
	{ id: 'art', hint: 'artwork, artists, exhibitions, net art as art' },
	{ id: 'design', hint: 'graphic/interaction/product design, studios, portfolios' },
	{ id: 'typography', hint: 'type design, foundries, lettering, typesetting' },
	{ id: 'code', hint: 'creative coding, programming, generative work' },
	{ id: 'tools', hint: 'something you USE to make or do something' },
	{ id: 'reference', hint: 'documentation, encyclopedias, specs, standards' },
	{ id: 'reading', hint: 'essays, criticism, long-form writing, blogs' },
	{ id: 'archive', hint: 'collections, museums, libraries, preserved material' },
	{ id: 'interactive', hint: 'you play with it in the browser — toys, demos, games' },
	{ id: 'weird', hint: 'experimental, surprising, hard to categorise, net-art strange' },
	{ id: 'surveillance', hint: 'watching, tracking, monitoring, privacy and being observed' },
	{ id: 'data-mining', hint: 'harvesting, scraping, datasets built from people and their traces' },
	{ id: 'fun', hint: 'delightful, playful, makes you smile' },
	{ id: 'nerdy', hint: 'deep enthusiast territory, obsessive detail, niche' },
	{ id: 'nourishing', hint: 'emotionally warm, kind, calming, restorative' },
	// Gemma read "skeuomorphic turntable app" as old-web. This tag is about a
	// site's AGE, not its styling — say so, or every retro aesthetic lands here.
	{ id: 'old-web', hint: 'genuinely OLD: built long ago and still standing (Akinator, Space Jam 1996). NOT a new site with a retro or nostalgic look' },
	{ id: 'academic', hint: 'papers, research, universities, scholarship' },
	{ id: 'technical', hint: 'engineering depth, systems, hard technical detail' }
];

const VALID = new Set(TAGS.map((t) => t.id));
const ORDER = new Map(TAGS.map((t, i) => [t.id, i]));

/** Keep only real tags, de-duplicated, capped, and in vocabulary order. */
export function normalizeTags(list) {
	const seen = new Set();
	for (const raw of Array.isArray(list) ? list : String(list ?? '').split(',')) {
		const t = String(raw ?? '').trim().toLowerCase().replace(/[^a-z-]/g, '');
		if (VALID.has(t)) seen.add(t);
	}
	return [...seen].sort((a, b) => ORDER.get(a) - ORDER.get(b)).slice(0, 4);
}

// Terse prompt, temperature 0.35. This deployment's reasoning channel spirals
// on verbose prompts and low temperatures and comes back with content:null —
// same contract as the digest's LLM calls, including enable_thinking:false.
const SYSTEM =
	'You tag websites for a design class. Reply with ONLY a JSON array of 1-4 tags ' +
	'chosen from the allowed list. No prose, no explanation, no other tags.';

function buildPrompt(site) {
	const vocab = TAGS.map((t) => `${t.id} = ${t.hint}`).join('\n');
	const bits = [
		`URL: ${site.url}`,
		site.siteName ? `Site: ${site.siteName}` : null,
		site.title ? `Title: ${site.title}` : null,
		site.description ? `Description: ${String(site.description).slice(0, 300)}` : null
	].filter(Boolean).join('\n');
	return `ALLOWED TAGS:\n${vocab}\n\nSITE:\n${bits}\n\nJSON array of 1-4 tags:`;
}

/** Pull an array out of a small model's reply, fenced or chatty or bare. */
function parseTagArray(raw) {
	if (!raw) return [];
	const s = String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
	const a = s.indexOf('['), b = s.lastIndexOf(']');
	if (a >= 0 && b > a) {
		try {
			const arr = JSON.parse(s.slice(a, b + 1));
			if (Array.isArray(arr)) return normalizeTags(arr);
		} catch { /* fall through to the word scan */ }
	}
	// Last resort: it answered in prose. Every valid tag is a distinct word, so
	// scanning for them is a fair reading of "design, tools and a bit weird".
	return normalizeTags(TAGS.map((t) => t.id).filter((id) => new RegExp(`\\b${id}\\b`, 'i').test(s)));
}

async function chat(creds, messages, { maxTokens = 120, temperature = 0.35 } = {}) {
	const base = String(creds.base_url).replace(/\/$/, '');
	const headers = { Authorization: `Bearer ${creds.api_key}`, 'Content-Type': 'application/json' };
	const modelsRes = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(15000) });
	if (!modelsRes.ok) return null;
	const model = (await modelsRes.json())?.data?.[0]?.id;
	if (!model) return null;
	const res = await fetch(`${base}/chat/completions`, {
		method: 'POST',
		headers,
		signal: AbortSignal.timeout(60000),
		body: JSON.stringify({
			model,
			stream: false,
			max_tokens: maxTokens,
			temperature,
			messages,
			chat_template_kwargs: { enable_thinking: false }
		})
	});
	if (!res.ok) return null;
	return (await res.json())?.choices?.[0]?.message?.content?.trim() || null;
}

/**
 * Tags for one site. Returns an array (possibly empty — a site Gemma can't
 * place is legitimately untaggable), or null when the model is unreachable,
 * which the caller must treat as "try again later" rather than "no tags".
 */
export async function tagSite(site, userId = null) {
	const creds = await resolveAiCreds(userId);
	if (!creds) return null;
	let raw = null;
	try {
		raw = await chat(creds, [
			{ role: 'system', content: SYSTEM },
			{ role: 'user', content: buildPrompt(site) }
		]);
	} catch {
		return null;
	}
	if (raw == null) return null;
	return parseTagArray(raw);
}
