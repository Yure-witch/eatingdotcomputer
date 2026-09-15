// Reproducible, SDK-3.1.0-only patch. See ../NO-USAGE.md for the ABI analysis.
// Run from the repository root: node vendor/emo/tools/patch-usage.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ORIGINAL_SHA256 = 'bdc86f5d30c0b61311820e3e710096aeb5d93abce2e15924ad2d6fbd3c9721cb';
export const PATCH_DIRECTORY = 'sdk-3.1.0-no-usage-v2';
export const PATCH_PATH = `vendor/emo/${PATCH_DIRECTORY}/EmoWeb.wasm`;
export const FUNCTION_PATCHES = JSON.parse(readFileSync(new URL('./no-usage-stubs.json', import.meta.url), 'utf8'));
const patches = new Map(FUNCTION_PATCHES.map(patch => [patch.index, patch]));
export const REMOVED_LITERALS = [
	{ text: 'ai.desertant.usage.deviceId', count: 1 },
	{ text: 'ai.desertant.usage.', count: 1 },
	{ text: '__dalUsageStore', count: 1 },
	{ text: '__dalIngestEndpoint', count: 2 },
	{ text: 'https://platform.desertant.ai/api/v1/ingest', count: 1 }
];
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readU32(bytes, cursor) {
	let value = 0;
	for (let shift = 0; shift < 35; shift += 7) {
		assert(cursor.offset < bytes.length, 'Truncated wasm integer');
		const byte = bytes[cursor.offset++];
		value += (byte & 0x7f) * 2 ** shift;
		if (!(byte & 0x80)) return value;
	}
	throw new Error('Invalid wasm integer');
}

function u32(value) {
	const bytes = [];
	do {
		const byte = value % 128;
		value = Math.floor(value / 128);
		bytes.push(byte | (value ? 128 : 0));
	} while (value);
	return Buffer.from(bytes);
}

export function patchUsage(input) {
	assert.equal(sha256(input), ORIGINAL_SHA256,
		'Unrecognized EmoWeb.wasm. Review the new SDK before updating this patch.');
	const original = new WebAssembly.Module(input);
	const imports = WebAssembly.Module.imports(original);
	const functionImports = imports.filter((item) => item.kind === 'function').length;
	assert.equal(functionImports, 87);
	const cursor = { offset: 8 };
	const sections = [input.subarray(0, 8)];
	let patched = 0;
	let dataPatched = 0;
	while (cursor.offset < input.length) {
		const start = cursor.offset;
		const id = input[cursor.offset++];
		const size = readU32(input, cursor);
		const end = cursor.offset + size;
		if (id === 11) {
			// Erase only the literal bytes, preserving all linear-memory offsets.
			const data = Buffer.from(input.subarray(cursor.offset, end));
			for (const { text, count } of REMOVED_LITERALS) {
				let found = 0;
				for (let at; (at = data.indexOf(text)) !== -1;) {
					data.fill(0, at, at + Buffer.byteLength(text));
					found++;
				}
				assert.equal(found, count, `Unexpected literal count: ${text}`);
			}
			sections.push(input.subarray(start, cursor.offset), data);
			cursor.offset = end;
			dataPatched++;
			continue;
		}
		if (id !== 10) {
			sections.push(input.subarray(start, end));
			cursor.offset = end;
			continue;
		}
		const count = readU32(input, cursor);
		const bodies = [u32(count)];
		for (let index = 0; index < count; index++) {
			const bodySize = readU32(input, cursor);
			let body = input.subarray(cursor.offset, cursor.offset + bodySize);
			cursor.offset += bodySize;
			const patch = patches.get(index + functionImports);
			if (patch) {
				assert.equal(bodySize, patch.originalBytes);
				assert.equal(sha256(body), patch.originalSha256);
				// Replace the original code with ABI-compatible empty results/no-ops.
				// The session factory retains the unwrapped session using helper 232.
				body = Buffer.from(patch.bodyHex, 'hex');
				patched++;
			}
			bodies.push(u32(body.length), body);
		}
		assert.equal(cursor.offset, end);
		const code = Buffer.concat(bodies);
		sections.push(Buffer.from([10]), u32(code.length), code);
	}
	assert.equal(patched, FUNCTION_PATCHES.length);
	assert.equal(dataPatched, 1);
	const output = Buffer.concat(sections);
	for (const { text } of REMOVED_LITERALS) assert(!output.includes(text));
	assert(WebAssembly.validate(output));
	const module = new WebAssembly.Module(output);
	assert.deepEqual(WebAssembly.Module.imports(module), imports);
	assert.deepEqual(WebAssembly.Module.exports(module), WebAssembly.Module.exports(original));
	return output;
}

export function buildPatchedWasm() {
	const input = readFileSync('node_modules/@desert-ant-labs/emo/dist/EmoWeb.wasm');
	const output = patchUsage(input);
	mkdirSync(`vendor/emo/${PATCH_DIRECTORY}`, { recursive: true });
	writeFileSync(PATCH_PATH, output);
	const manifest = {
		sdkVersion: '3.1.0', patch: 'no-usage-v2',
		original: { bytes: input.length, sha256: sha256(input) },
		patched: { bytes: output.length, sha256: sha256(output) },
		functions: FUNCTION_PATCHES.map(({ index, description, originalBytes, bodyHex }) => ({ index, description, originalBytes, patchedBytes: bodyHex.length / 2 })),
		removedLiterals: REMOVED_LITERALS,
		description: 'Remove usage-key/device-ID generation, storage access, state persistence, and reporting bodies; bypass tracked session construction'
	};
	writeFileSync(`vendor/emo/${PATCH_DIRECTORY}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
	return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(buildPatchedWasm(), null, 2));
