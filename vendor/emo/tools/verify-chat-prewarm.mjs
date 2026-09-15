// Checks the app's actual suggestion wrapper and its onMount cleanup contract.
// Run with Vite on localhost:5175: node vendor/emo/tools/verify-chat-prewarm.mjs
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { PATCH_DIRECTORY } from './patch-usage.mjs';

const base = process.env.EMO_TEST_ORIGIN ?? 'http://localhost:5175';
const browser = await puppeteer.launch({ headless: true });
const results = [];
try {
	for (const scenario of ['prewarm', 'early-input', 'storage-unavailable']) {
		const context = await browser.createBrowserContext();
		const page = await context.newPage();
		const errors = [];
		const telemetry = [];
		const wasmUrls = [];
		page.on('pageerror', error => errors.push(String(error)));
		await page.setRequestInterception(true);
		page.on('request', request => {
			const url = request.url();
			if (url === `${base}/__emo-chat-prewarm-test`) return request.respond({
				status: 200, contentType: 'text/html', body: '<!doctype html><title>Emoji prewarm test</title>'
			});
			if (url.includes('platform.desertant.ai') || url.includes('telemetry-test.invalid')) {
				telemetry.push(url);
				return request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' });
			}
			if (new URL(url).pathname.endsWith('/EmoWeb.wasm')) wasmUrls.push(url);
			return request.continue();
		});
		await page.goto(`${base}/__emo-chat-prewarm-test`);
		const result = await page.evaluate(async scenario => {
			const storage = window.localStorage;
			const legacy = ['ai.desertant.usage.deviceId', 'ai.desertant.usage.localhost.old-device.state'];
			for (const key of legacy) storage.setItem(key, 'old-value');
			storage.setItem('emoji-tone', '1F3FD');
			storage.setItem('chat-test-unrelated', 'keep');
			const writes = [], removes = [];
			for (const method of ['setItem', 'removeItem']) {
				const original = Storage.prototype[method];
				Storage.prototype[method] = function (key, ...args) {
					if (this === storage) (method === 'setItem' ? writes : removes).push(key);
					return original.call(this, key, ...args);
				};
			}
			if (scenario === 'storage-unavailable') Object.defineProperty(window, 'localStorage', {
				configurable: true, get() { throw new DOMException('Storage unavailable', 'SecurityError'); }
			});
			globalThis.__dalHttpDebug = true;
			globalThis.__dalIngestEndpoint = 'https://telemetry-test.invalid/ingest';
			const { prewarmEmo, initEmo, suggestEmoji } = await import('/src/lib/emo-suggest.js');
			let canceledWithoutLoad = null, noEarlyLoad = null, loadDelayMs = null;
			let hits;
			const sdkRequests = () => performance.getEntriesByType('resource').filter(r => r.name.includes('/node_modules/@desert-ant-labs/emo/browser.js'));
			if (scenario === 'prewarm') {
				const cancel = prewarmEmo();
				cancel();
				await new Promise(resolve => setTimeout(resolve, 650));
				canceledWithoutLoad = sdkRequests().length === 0 && legacy.every(key => storage.getItem(key) === 'old-value');
				const start = performance.now();
				const cleanup = prewarmEmo();
				await new Promise(resolve => setTimeout(resolve, 300));
				noEarlyLoad = sdkRequests().length === 0;
				await new Promise(resolve => setTimeout(resolve, 250));
				await initEmo();
				loadDelayMs = sdkRequests()[0]?.startTime - start;
				cleanup();
				hits = await suggestEmoji('go for a run');
			} else {
				// A first draft must get its result even if the model is still cold.
				hits = await suggestEmoji('go for a run');
			}
			const firstReady = initEmo();
			const reused = firstReady === initEmo();
			await firstReady;
			await globalThis.__dalFlushTelemetry();
			await new Promise(resolve => setTimeout(resolve, 3500));
			window.dispatchEvent(new Event('pagehide'));
			return { writes, removes, canceledWithoutLoad, noEarlyLoad, loadDelayMs, reused, hits,
				remaining: Object.fromEntries(Object.keys(storage).map(key => [key, storage.getItem(key)])) };
		}, scenario);
		assert.deepEqual(errors, []);
		assert.deepEqual(telemetry, []);
		assert.deepEqual(result.writes, [], 'Suggestions must never write to localStorage');
		assert(result.hits.length > 0, 'First request must produce suggestions after loading');
		assert.equal(result.reused, true);
		assert.equal(wasmUrls.length, 1, 'Only one model core should load');
		assert(wasmUrls[0].includes(`/${PATCH_DIRECTORY}/`));
		if (scenario !== 'storage-unavailable') {
			assert.equal(result.removes.length, 2);
			assert.deepEqual(result.remaining, { 'emoji-tone': '1F3FD', 'chat-test-unrelated': 'keep' });
		}
		if (scenario === 'prewarm') {
			assert.equal(result.canceledWithoutLoad, true);
			assert.equal(result.noEarlyLoad, true);
			assert(result.loadDelayMs >= 490 && result.loadDelayMs < 550, `SDK loading started at ${result.loadDelayMs}ms`);
		}
		results.push({ scenario, ...result });
		console.log(JSON.stringify({ scenario, writes: result.writes.length, removed: result.removes.length, loadDelayMs: result.loadDelayMs, suggestions: result.hits.length, reused: result.reused }));
		await context.close();
	}
	writeFileSync('vendor/emo/chat-prewarm-verification.json', `${JSON.stringify(results, null, 2)}\n`);
} finally {
	await browser.close();
}
