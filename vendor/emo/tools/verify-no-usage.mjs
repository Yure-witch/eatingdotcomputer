// Browser regression test: compare the original and patched wasm with real LiteRT.
// Telemetry attempts are counted and answered locally, never sent to the vendor.
// node vendor/emo/tools/verify-no-usage.mjs [--remote]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { PATCH_DIRECTORY, PATCH_PATH, patchUsage } from './patch-usage.mjs';

const base = process.env.EMO_TEST_ORIGIN ?? 'http://localhost:5175';
const r2 = 'https://pub-62e59b4ebf1d45d2ad5f669369e907fe.r2.dev/vendor/emo';
const original = readFileSync('node_modules/@desert-ant-labs/emo/dist/EmoWeb.wasm');
const patched = readFileSync(PATCH_PATH);
assert.deepEqual(patched, patchUsage(original));
const changed = Buffer.from(original);
changed[100] ^= 1;
assert.throws(() => patchUsage(changed), /Unrecognized/);
const remote = process.argv.includes('--remote');
const browser = await puppeteer.launch({ headless: true });
const results = [];
try {
	for (const variant of ['original', 'patched', 'patched-debug-off']) {
		const context = await browser.createBrowserContext();
		const page = await context.newPage();
		const telemetry = [];
		const failures = [];
		const wasmUrls = [];
		page.on('pageerror', (err) => failures.push(String(err)));
		await page.setRequestInterception(true);
		page.on('request', (request) => {
			const url = request.url();
			if (url.includes('platform.desertant.ai') || url.includes('telemetry-test.invalid')) {
				telemetry.push({ url, method: request.method() });
				return request.respond({ status: 200, contentType: 'application/json',
					headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }, body: '{}' });
			}
			if (url === `${base}/__emo-no-usage-test`) {
				return request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Emo wasm regression</title>' });
			}
			if (new URL(url).pathname.endsWith('/EmoWeb.wasm')) {
				wasmUrls.push(url);
				if (variant === 'original' || !remote) {
					return request.respond({ status: 200, contentType: 'application/wasm',
						headers: { 'Access-Control-Allow-Origin': '*' }, body: variant === 'original' ? original : patched });
				}
			}
			return request.continue();
		});
		await page.goto(`${base}/__emo-no-usage-test`);
		const result = await page.evaluate(async ({ r2, debug }) => {
			globalThis.__dalHttpDebug = debug;
			globalThis.__dalIngestEndpoint = 'https://telemetry-test.invalid/ingest';
			const accesses = [];
			for (const method of ['getItem', 'setItem']) {
				const original = Storage.prototype[method];
				Storage.prototype[method] = function (key, ...args) {
					if (this === localStorage) accesses.push({ method, key });
					return original.call(this, key, ...args);
				};
			}
			const { Emo } = await import('/node_modules/@desert-ant-labs/emo/browser.js');
			const options = { litertWasmDir: `${r2}/litert-2.5.3/`, modelBaseUrl: `${r2}/model-v0.7.0/` };
			const model = await Emo.load(options);
			const downloaded = model.isDownloaded();
			const corpus = ['pay my bills', 'going to the gym', 'fly neurons', 'pizza', 'hello', '犬の散歩', 'café', 'go for a run', ''];
			const suggestions = [];
			for (const text of corpus) suggestions.push(await model.suggestions(text, { limit: 5, skinTone: 'medium' }));
			const grouped = await model.withCallGroup(async group => {
				const rows = [];
				for (let i = 0; i < 20; i++) rows.push(await model.suggestions('pizza', { group, deviceId: `test-device-${i % 3}` }));
				return rows;
			});
			if (debug) await globalThis.__dalFlushTelemetry();
			await new Promise(resolve => setTimeout(resolve, 3500));
			window.dispatchEvent(new Event('pagehide'));
			window.dispatchEvent(new Event('beforeunload'));
			if (debug) await globalThis.__dalFlushTelemetry();
			model.dispose();
			let disposedRejected = false;
			try { await model.suggestions('pizza'); } catch { disposedRejected = true; }
			// Exercise retained session ownership across repeated creation/destruction.
			const reloads = [];
			for (let i = 0; i < 5; i++) {
				const next = await Emo.load(options);
				reloads.push(await next.suggestions('pizza'));
				next.dispose();
			}
			if (debug) await globalThis.__dalFlushTelemetry();
			await new Promise(resolve => setTimeout(resolve, 3500));
			return { downloaded, disposedRejected, suggestions, grouped, reloads, accesses };
		}, { r2, debug: variant !== 'patched-debug-off' });
		assert.equal(result.downloaded, true);
		assert.equal(result.disposedRejected, true);
		assert(result.suggestions[0].length > 0);
		assert.deepEqual(failures, []);
		if (variant === 'original') {
			assert(telemetry.some(r => r.method === 'POST'), 'Baseline must attempt usage reporting');
			assert(result.accesses.some(a => a.method === 'setItem'), 'Baseline must write usage storage');
		} else {
			assert.deepEqual(telemetry, [], 'Patched wasm must make no telemetry requests');
			assert.deepEqual(result.accesses, [], 'Patched wasm must not access usage storage');
			for (const key of ['suggestions', 'grouped', 'reloads']) assert.deepEqual(result[key], results[0].result[key]);
			if (remote) assert(wasmUrls.every(url => url.includes(`/${PATCH_DIRECTORY}/`)));
		}
		results.push({ variant, telemetry, wasmUrls, result });
		console.log(JSON.stringify({ variant, telemetryRequests: telemetry.length, storageAccesses: result.accesses.length, corpusSize: result.suggestions.length, groupedRuns: result.grouped.length, reloads: result.reloads.length, match: true }));
		await context.close();
	}
	writeFileSync('vendor/emo/no-usage-verification.json', `${JSON.stringify({ remote, testedAt: new Date().toISOString(), results }, null, 2)}\n`);
} finally {
	await browser.close();
}
