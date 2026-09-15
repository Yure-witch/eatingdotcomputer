import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

function expandTerm(raw) {
	const term = raw.toLowerCase().trim();
	if (!term) return [];
	const terms = new Set([term]);
	if (term.includes('-')) {
		const parts = term.split('-').filter(Boolean);
		for (const part of parts) if (part.length > 1) terms.add(part);
		if (parts.join('').length > 1) terms.add(parts.join(''));
	}
	return [...terms];
}

export function buildSearchTerms(item) {
	const terms = new Set();
	for (const word of item.n.split(/[\s\-_]+/)) for (const term of expandTerm(word)) terms.add(term);
	for (const shortcode of item.sc ?? []) for (const term of expandTerm(shortcode)) terms.add(term);
	for (const alias of item.al ?? []) if (alias.trim()) terms.add(alias.toLowerCase().trim());
	for (const keyword of [...(item.kw ?? []), ...(item.sy ?? [])]) for (const term of expandTerm(keyword)) terms.add(term);
	return [...terms];
}

export function loadWebsterSynonyms() {
	const path = new URL('../../data/emoji-annotations/webster-synonyms.json', import.meta.url);
	if (!existsSync(path)) return new Map();
	const report = JSON.parse(readFileSync(path));
	if (!report.ranking.startsWith('MiniLM')) throw new Error('Webster candidates need semantic review before application');
	const original = readFileSync(new URL('en.xml', path));
	if (createHash('sha256').update(original).digest('hex') !== report.sourceSha256) throw new Error('Webster source checksum mismatch');
	return new Map(report.entries.map(entry => [entry.emoji.replaceAll('\uFE0F', ''), entry.synonyms.map(hit => hit.word)]));
}

export function applyConceptAssociations(data) {
	const { concepts } = JSON.parse(readFileSync(new URL('../../data/emoji-search/concepts.json', import.meta.url)));
	const glyphs = new Set(data.groups.flatMap(g => g.items.map(i => i.e.replaceAll('\uFE0F', ''))));
	const ids = new Set();
	for (const concept of concepts) {
		if (ids.has(concept.id) || !concept.terms.length || !concept.emoji.length) throw new Error(`Invalid emoji concept: ${concept.id}`);
		ids.add(concept.id);
		for (const glyph of concept.emoji) if (!glyphs.has(glyph.replaceAll('\uFE0F', ''))) throw new Error(`Unknown emoji ${glyph} in ${concept.id}`);
	}
	data.concepts = concepts;
	const { families } = JSON.parse(readFileSync(new URL('../../data/emoji-search/families.json', import.meta.url)));
	const items = data.groups.flatMap(g => g.items);
	const byGlyph = new Map(items.map(item => [item.e.replaceAll('\uFE0F', ''), item.e]));
	data.families = families.map(family => {
		const members = items.filter(item => item.n.toLowerCase().split(/[^\p{L}\p{N}]+/u).some(word => family.nameWords.includes(word))).map(item => item.e);
		const preferred = family.preferred.map(glyph => {
			const canonical = byGlyph.get(glyph.replaceAll('\uFE0F', ''));
			if (!canonical) throw new Error(`Unknown emoji ${glyph} in family ${family.id}`);
			return canonical;
		});
		return { id: family.id, terms: family.terms, emoji: [...new Set([...preferred, ...members])] };
	});
	return data;
}
