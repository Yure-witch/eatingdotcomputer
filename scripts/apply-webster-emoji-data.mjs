#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { buildSearchTerms, loadWebsterSynonyms, applyConceptAssociations } from './lib/emoji-search-data.mjs';

const path = new URL('../static/emoji-data.json', import.meta.url);
const data = JSON.parse(readFileSync(path));
const synonyms = loadWebsterSynonyms();
let enriched = 0;
for (const group of data.groups) for (const item of group.items) {
	const additions = (synonyms.get(item.e.replaceAll('\uFE0F', '')) ?? [])
		.filter(word => !(item.kw ?? []).some(keyword => keyword.toLowerCase() === word.toLowerCase()));
	if (additions.length) { item.sy = additions; enriched++; }
	else delete item.sy;
	item.st = buildSearchTerms(item);
}
applyConceptAssociations(data);
writeFileSync(path, JSON.stringify(data));
console.log(JSON.stringify({ enrichedEmoji: enriched }));
