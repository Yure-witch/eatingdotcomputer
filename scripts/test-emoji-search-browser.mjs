// Run against Vite on localhost:5175. Mount the real picker without logging in.
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const origin = process.env.EMO_TEST_ORIGIN ?? 'http://localhost:5175';
const entry = new URL('../src/emoji-search-check-entry.js', import.meta.url);
if (existsSync(entry)) throw new Error('Temporary picker entry already exists; refusing to overwrite it');
writeFileSync(entry, `import { mount } from 'svelte';
import Picker from './lib/components/EmojiPicker.svelte';
import './app.css';
mount(Picker, { target: document.getElementById('picker'), props: { onSelect() {} } });
`);
let browser;
try {
	browser = await puppeteer.launch({ headless: true });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', error => { errors.push(String(error)); console.error(String(error)); });
	page.on('response', response => { if (response.status() >= 400 && response.url().startsWith(origin)) console.error(response.status(), response.url()); });
	await page.setViewport({ width: 700, height: 800 });
	await page.setRequestInterception(true);
	page.on('request', request => {
		if (request.url() === `${origin}/__emoji-picker-check`) return request.respond({ status: 200, contentType: 'text/html',
			body: '<!doctype html><div id="picker" style="width:480px;height:650px"></div><script type="module" src="/src/emoji-search-check-entry.js"></script>' });
		if (request.url() === `${origin}/favicon.ico`) return request.respond({ status: 204 });
		request.continue();
	});
	await page.goto(`${origin}/__emoji-picker-check`);
	await page.waitForSelector('button[aria-label="Search emoji"]');
	await page.click('button[aria-label="Search emoji"]');
	await page.waitForSelector('input[placeholder="Search emoji…"]');
	for (const [query, expected] of [
		['murder', ['kitchen knife', 'dagger', 'drop of blood', 'crossed swords']],
		['goth', ['black heart', 'bat', 'wilted flower']],
		['daggr', ['dagger']], ['red haert', ['red heart']], ['buterfly', ['butterfly']],
		['hearts', ['red heart', 'orange heart', 'pink heart', 'broken heart', 'mending heart', 'heart on fire', 'heart suit']],
		['homesick', ['house']], ['first aid', ['adhesive bandage']]
	]) {
		await page.$eval('input[placeholder="Search emoji…"]', (input, query) => {
			input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }));
		}, query);
		await page.waitForFunction(expected => {
			const titles = [...document.querySelectorAll('.emoji-picker button.cell')].map(b => b.title);
			return expected.every(name => titles.includes(name));
		}, {}, expected);
		const titles = await page.$$eval('.emoji-picker button.cell', buttons => buttons.map(b => b.title));
		const matches = await page.$$eval('.emoji-picker button.cell', buttons => buttons.map(b => b.dataset.searchMatch ?? 'other'));
		const fuzzy = matches.filter(match => match === 'fuzzy');
		assert(fuzzy.length <= 2, `${query}: too many fuzzy results`);
		if (fuzzy.length) assert(matches.slice(-fuzzy.length).every(match => match === 'fuzzy'), `${query}: fuzzy results must be last`);
		console.log(JSON.stringify({ query, results: titles.slice(0, 10) }));
	}
	// An earlier slow semantic query must never overwrite a newer query.
	await page.$eval('input[placeholder="Search emoji…"]', input => {
		input.value = 'qzxwvplm'; input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await new Promise(resolve => setTimeout(resolve, 800));
	assert.equal(await page.$$eval('.emoji-picker button.cell', buttons => buttons.length), 0);
	assert.deepEqual(errors, []);
	console.log('Passed 8 real picker searches, fuzzy placement/cap, and clearing prior results.');
} finally {
	await browser?.close();
	unlinkSync(entry);
}
