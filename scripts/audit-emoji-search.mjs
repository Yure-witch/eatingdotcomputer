#!/usr/bin/env node
// Offline discovery: broad intents plus a generated typo for every emoji name.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createEmojiSearchIndex, searchEmojiCatalog } from '../src/lib/emoji-search.js';

const base = new URL('../', import.meta.url);
const bytes = readFileSync(new URL('static/emoji-data.json', base));
const data = JSON.parse(bytes), index = createEmojiSearchIndex(data);
const dataSha256 = createHash('sha256').update(bytes).digest('hex');
const embeddingMeta = new URL('static/emoji-embedding-meta.json', base);
const embeddingsCurrent = existsSync(embeddingMeta) && JSON.parse(readFileSync(embeddingMeta)).dataSha256 === dataSha256;
const probeData = JSON.parse(readFileSync(new URL('data/emoji-search/probes.json', base)));
const probes = probeData.queries, expectedSparse = new Set(probeData.expectedSparse ?? []);
const rows = probes.map(query => {
	const before = searchEmojiCatalog(index, query, { includeRelated: false, includeFuzzy: false });
	const after = searchEmojiCatalog(index, query);
	const reliable = after.filter(hit => hit.kind !== 'fuzzy');
	return { query, before: before.length, after: after.length, reliable: reliable.length,
		results: after.slice(0, 12).map(hit => ({ emoji: hit.item.e, name: hit.item.n, match: hit.kind })),
		needsReview: reliable.length < 3 && !expectedSparse.has(query) };
});
const nameFailures = [], typoFailures = [];
let typoQueries = 0;
for (const { item, tokens } of index.entries) {
	if (!searchEmojiCatalog(index, item.n).some(hit => hit.item.e === item.e)) nameFailures.push({ emoji: item.e, query: item.n });
	const position = tokens.findIndex(word => word.length >= 5);
	if (position < 0) continue;
	const word = tokens[position];
	let at = 1;
	while (at < word.length - 1 && word[at] === word[at + 1]) at++;
	if (at >= word.length - 1) continue;
	const typo = word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2);
	const query = [...tokens.slice(0, position), typo, ...tokens.slice(position + 1)].join(' ');
	typoQueries++;
	if (!searchEmojiCatalog(index, query).some(hit => hit.item.e === item.e)) typoFailures.push({ emoji: item.e, name: item.n, query });
}
const summary = { probes: rows.length, improved: rows.filter(r => r.reliable > r.before).length,
	beforeSparse: rows.filter(r => r.before < 3).length, remainingSparse: rows.filter(r => r.reliable < 3).length,
	needsReview: rows.filter(r => r.needsReview).length,
	names: index.entries.length, nameFailures: nameFailures.length, typoQueries, typoFailures: typoFailures.length, embeddingsCurrent };
const report = { generatedAt: new Date().toISOString(), dataSha256,
	note: 'Sparse does not always mean wrong: some concepts have one precise emoji. Results need human review. No runtime analytics or external API calls.', summary, rows, nameFailures, typoFailures };
writeFileSync(new URL('data/emoji-search/coverage.json', base), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(summary));
console.log('Review candidates:', rows.filter(r => r.needsReview).map(r => r.query).join(', '));
if (nameFailures.length || typoFailures.length || !embeddingsCurrent) process.exitCode = 1;
