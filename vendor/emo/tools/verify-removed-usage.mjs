// Verify removed internals directly, even though the app no longer calls them.
// Test-only function exports are added in memory, never to the shipped wasm.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { init } from '../../../node_modules/@desert-ant-labs/emo/dist/index.js';
import { FUNCTION_PATCHES, PATCH_PATH, REMOVED_LITERALS } from './patch-usage.mjs';

function readU32(bytes, cursor) {
	let value = 0, shift = 0, byte;
	do { byte = bytes[cursor.offset++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
	return value;
}
function u32(value) {
	const bytes = [];
	do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
	return Buffer.from(bytes);
}
function inspect(bytes) {
	const cursor = { offset: 8 }, sections = [], bodies = [];
	while (cursor.offset < bytes.length) {
		const id = bytes[cursor.offset++], length = readU32(bytes, cursor);
		const end = cursor.offset + length;
		const data = bytes.subarray(cursor.offset, end);
		sections.push({ id, data });
		if (id === 10) {
			const count = readU32(bytes, cursor);
			for (let i = 0; i < count; i++) {
				const length = readU32(bytes, cursor);
				bodies.push(bytes.subarray(cursor.offset, cursor.offset + length));
				cursor.offset += length;
			}
		}
		cursor.offset = end;
	}
	return { sections, bodies };
}
const original = inspect(readFileSync('node_modules/@desert-ant-labs/emo/dist/EmoWeb.wasm'));
const bytes = readFileSync(PATCH_PATH);
const patched = inspect(bytes);
assert.equal(original.bodies.length, patched.bodies.length);
const changes = original.bodies.flatMap((body, i) => body.equals(patched.bodies[i]) ? [] : [i + 87]);
assert.deepEqual(changes, FUNCTION_PATCHES.map(p => p.index));
for (const { index, bodyHex } of FUNCTION_PATCHES) assert.equal(patched.bodies[index - 87].toString('hex'), bodyHex);
for (let i = 0; i < original.sections.length; i++) {
	const before = original.sections[i], after = patched.sections[i];
	assert.equal(before.id, after.id);
	if (before.id === 10) continue;
	const expected = Buffer.from(before.data);
	if (before.id === 11) {
		for (const { text } of REMOVED_LITERALS) {
			for (let at; (at = expected.indexOf(text)) !== -1;) expected.fill(0, at, at + Buffer.byteLength(text));
		}
	}
	assert.deepEqual(after.data, expected, `Unexpected changes in section ${before.id}`);
}
for (const { text } of REMOVED_LITERALS) assert(!bytes.includes(text));

const internals = FUNCTION_PATCHES.filter(patch => patch.index !== 406);
const testSections = [bytes.subarray(0, 8)];
for (const { id, data } of patched.sections) {
	let output = data;
	if (id === 7) {
		const cursor = { offset: 0 };
		const count = readU32(data, cursor);
		const additions = internals.map(({ index }) => {
			const name = Buffer.from(`test_${index}`);
			return Buffer.concat([u32(name.length), name, Buffer.from([0]), u32(index)]);
		});
		output = Buffer.concat([u32(count + additions.length), data.subarray(cursor.offset), ...additions]);
	}
	testSections.push(Buffer.from([id]), u32(output.length), output);
}
let storageAccesses = 0, fetches = 0;
for (const name of ['localStorage', '__dalUsageStore']) Object.defineProperty(globalThis, name, {
	configurable: true, get() { storageAccesses++; throw new Error('Removed code touched storage'); }
});
globalThis.fetch = async () => { fetches++; throw new Error('Removed code attempted a request'); };
const { instance } = await init({
	module: Buffer.concat(testSections),
	getImports: () => ({ dalModelHost: { createSessionFromPath: async () => {}, createSessionFromBytes: async () => {}, run: async () => ({}) } })
});
const core = instance.exports;
const address = core.memory.grow(1) * 65536;
const view = new DataView(core.memory.buffer);
for (const index of [2640, 2641]) {
	core[`test_${index}`](address, 0, 0, 0, 0, 0, 0);
	assert.equal(view.getBigUint64(address, true), 0n);
	assert.equal(view.getUint32(address + 8, true), 57344); // Swift empty string
}
core.test_2639(0);
core.test_2672(0);
for (const address of [1341564, 1341652]) {
	assert.equal(view.getBigUint64(address, true), 0n);
	assert.equal(view.getUint32(address + 8, true), 57344);
}
core.test_2642(address);
assert.equal(view.getUint32(address + 12, true), 1032992); // empty JSKeyValueStorage value
assert.equal(view.getUint32(address + 16, true), 1032912); // preserved witness table
assert.equal(core.test_2646(), 0); // no storage host
core.test_2647(address, 0, 0, 0, 0, 0, 0, 0);
assert.equal(view.getUint32(address + 8, true), 255); // Swift nil
core.test_2648(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
core.test_2673(0, 0, 0, 0);
core.test_2681(address, 0, 0);
assert.equal(view.getBigUint64(address, true), 0n);
assert.equal(view.getUint32(address + 8, true), 0);
core.test_2682(0n, 0, 0, 0);
assert.equal(storageAccesses, 0);
assert.equal(fetches, 0);
console.log(JSON.stringify({ replacedFunctions: changes, removedLiterals: true, directInternalCalls: internals.length, storageAccesses, fetches }));
