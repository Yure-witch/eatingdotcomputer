/**
 * Web Worker: loads all-MiniLM-L6-v2 + pre-computed embeddings matrix.
 * All ML computation happens here — zero main-thread cost.
 *
 * Messages in:  { type: 'search', text: string, topN: number, id: number }
 * Messages out: { type: 'ready' }
 *               { type: 'results', id: number, results: {cp: string, score: number}[] }
 *               { type: 'error', id?: number, message: string }
 */

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

const DIMS = 384;
let embedder = null;
let embeddings = null; // Float32Array[N × DIMS]
let cpOrder = null;    // string[] codepoints, same row order

async function getEmbedder() {
	if (embedder) return embedder;
	embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
		dtype: 'q8',
	});
	return embedder;
}

async function loadEmbeddings() {
	const [binRes, mapRes] = await Promise.all([
		fetch('/emoji-embeddings.bin'),
		fetch('/emoji-embedding-map.json'),
	]);
	if (!binRes.ok || !mapRes.ok) return;
	embeddings = new Float32Array(await binRes.arrayBuffer());
	cpOrder = await mapRes.json();
}

function semanticSearch(queryVec, topN) {
	if (!embeddings || !cpOrder) return [];
	const n = cpOrder.length;
	const q = queryVec instanceof Float32Array ? queryVec : new Float32Array(queryVec);
	const results = new Array(n);
	for (let i = 0; i < n; i++) {
		let dot = 0;
		const off = i * DIMS;
		for (let d = 0; d < DIMS; d++) dot += q[d] * embeddings[off + d];
		results[i] = { cp: cpOrder[i], score: dot };
	}
	results.sort((a, b) => b.score - a.score);
	return results.slice(0, topN);
}

// Load model + embeddings in parallel — worker is ready when both are done
Promise.all([getEmbedder(), loadEmbeddings()])
	.then(() => self.postMessage({ type: 'ready' }))
	.catch(err => self.postMessage({ type: 'error', message: err.message }));

self.onmessage = async ({ data }) => {
	if (data.type !== 'search') return;
	try {
		const emb = await getEmbedder();
		const out = await emb(data.text, { pooling: 'mean', normalize: true });
		const results = semanticSearch(out.data, data.topN ?? 10);
		self.postMessage({ type: 'results', id: data.id, results });
	} catch (err) {
		self.postMessage({ type: 'error', id: data.id, message: err.message });
	}
};
