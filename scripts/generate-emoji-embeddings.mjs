/**
 * Generates pre-computed emoji embeddings using all-MiniLM-L6-v2.
 * Run once: node scripts/generate-emoji-embeddings.mjs
 * Outputs:
 *   static/emoji-embeddings.bin   — Float32Array[N × 384], row-major
 *   static/emoji-embedding-map.json — string[] of codepoints, same order as rows
 */

import { pipeline } from '@huggingface/transformers';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIMS = 384;
const BATCH = 64;

console.log('Loading emoji data…');
const source = readFileSync(join(__dirname, '../static/emoji-data.json'));
const emojiData = JSON.parse(source);

const allItems = emojiData.groups.flatMap(g => g.items);
console.log(`${allItems.length} emoji items found`);

const related = new Map();
for (const concept of emojiData.concepts ?? []) for (const glyph of concept.emoji) {
	const key = glyph.replaceAll('\uFE0F', '');
	if (!related.has(key)) related.set(key, []);
	related.get(key).push(concept.id);
}

function buildDescription(item) {
	const parts = [];
	if (item.n) parts.push(item.n);
	parts.push(...(related.get(item.e.replaceAll('\uFE0F', '')) ?? []));
	if (item.sc?.length) parts.push(...item.sc.map(s => s.replace(/_/g, ' ')));
	if (item.st?.length) parts.push(...item.st);
	return [...new Set(parts)].join(', ');
}

const descriptions = allItems.map(buildDescription);
const codepoints = allItems.map(item => item.cp);

console.log('Loading model (all-MiniLM-L6-v2); reuses the local model cache');
const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
	dtype: 'q8',
	session_options: { intraOpNumThreads: 4 },
});

const allEmbeddings = new Float32Array(allItems.length * DIMS);
console.log(`Computing embeddings in batches of ${BATCH}…`);

for (let i = 0; i < descriptions.length; i += BATCH) {
	const batch = descriptions.slice(i, i + BATCH);
	const output = await embedder(batch, { pooling: 'mean', normalize: true });
	// output.data is a flat Float32Array of shape [batchSize × DIMS]
	allEmbeddings.set(output.data, i * DIMS);
	process.stdout.write(`\r  ${Math.min(i + BATCH, descriptions.length)} / ${descriptions.length}`);
}
process.stdout.write('\n');

writeFileSync(
	join(__dirname, '../static/emoji-embeddings.bin'),
	Buffer.from(allEmbeddings.buffer)
);
writeFileSync(
	join(__dirname, '../static/emoji-embedding-map.json'),
	JSON.stringify(codepoints)
);
writeFileSync(join(__dirname, '../static/emoji-embedding-meta.json'), JSON.stringify({
	model: 'Xenova/all-MiniLM-L6-v2', dims: DIMS, rows: allItems.length,
	dataSha256: createHash('sha256').update(source).digest('hex'), generatedAt: new Date().toISOString()
}, null, 2) + '\n');
await embedder.dispose();

const mb = (allEmbeddings.buffer.byteLength / 1024 / 1024).toFixed(2);
console.log(`Done! ${allItems.length} embeddings written (${mb} MB)`);
