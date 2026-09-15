#!/usr/bin/env node
// Rank Webster's candidates locally with the same MiniLM model used by search.
// This model chooses among sourced synonyms; it does not generate new words.
import { pipeline, env } from '@huggingface/transformers';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseAnnotations, extractSenses, descriptionText, senseText, readVectors } from './enrich-emoji-annotations.mjs';

const base = new URL('../data/emoji-annotations/', import.meta.url);
const cache = new URL('.cache/', base);
const vectors = readVectors();
const strings = new Set(parseAnnotations(readFileSync(new URL('en.xml', base), 'utf8')).map(descriptionText));
for (const file of readdirSync(cache)) {
	if (!file.endsWith('.json') || file === 'vectors.json' || file === 'usage.json') continue;
	const entry = JSON.parse(readFileSync(new URL(file, cache)));
	if (!entry.query || !entry.payload) continue;
	for (const sense of extractSenses(entry.payload, entry.query)) {
		strings.add(senseText(sense));
		for (const word of sense.synonyms) strings.add(word);
	}
}
const missing = [...strings].filter(text => !vectors.has(text));
console.log(JSON.stringify({ cached: vectors.size, missing: missing.length }));
if (missing.length) {
	env.allowLocalModels = false;
	const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8', session_options: { intraOpNumThreads: 4 } });
	for (let start = 0; start < missing.length; start += 64) {
		const batch = missing.slice(start, start + 64);
		const output = await embedder(batch, { pooling: 'mean', normalize: true });
		for (let i = 0; i < batch.length; i++) vectors.set(batch[i], Float32Array.from(output.data.subarray(i * 384, (i + 1) * 384)));
		if (start % 512 === 0) console.log(JSON.stringify({ embedded: Math.min(start + 64, missing.length), total: missing.length }));
	}
	await embedder.dispose();
}
const keys = [...vectors.keys()];
const data = new Float32Array(keys.length * 384);
for (const [i, key] of keys.entries()) data.set(vectors.get(key), i * 384);
writeFileSync(new URL('vectors.bin', cache), Buffer.from(data.buffer));
writeFileSync(new URL('vectors.json', cache), JSON.stringify(keys));
console.log(JSON.stringify({ embeddedTotal: keys.length }));
