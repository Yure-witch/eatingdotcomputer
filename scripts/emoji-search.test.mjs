import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createEmojiSearchIndex, searchEmojiCatalog, relatedEmojiMatches, nameEditDistance } from '../src/lib/emoji-search.js';

const data = JSON.parse(readFileSync(new URL('../static/emoji-data.json', import.meta.url)));
const index = createEmojiSearchIndex(data);
const glyphs = query => searchEmojiCatalog(index, query).map(hit => hit.item.e);

test('name typos include transpositions, omissions, insertions and multiword names', () => {
	assert.equal(nameEditDistance('haert', 'heart'), 1);
	for (const [query, emoji] of [['daggr', '🗡️'], ['skulll', '💀'], ['buterfly', '🦋'], ['red haert', '❤️'], ['kithcen knife', '🔪'], ['knfie', '🔪']]) {
		assert(glyphs(query).includes(emoji), `${query}: missing ${emoji}`);
	}
});

test('literal, keyword and Webster matches rank ahead of fuzzy name matches', () => {
	const fixture = createEmojiSearchIndex({ groups: [{ items: [
		{ e: '🗡️', n: 'dagger', sc: [], st: ['dagger'], oi: 0 },
		{ e: '🔪', n: 'kitchen knife', sc: [], st: ['daggr'], oi: 1 }
	] }] });
	const hits = searchEmojiCatalog(fixture, 'daggr', { semanticScores: new Map() });
	assert.deepEqual(hits.map(hit => hit.item.e), ['🔪', '🗡️']);
	assert.deepEqual(hits.map(hit => hit.kind), ['literal', 'fuzzy']);
	assert.equal(glyphs('red heart')[0], '❤️');
	assert(glyphs('foolish').includes('🤪'));
});

test('concepts bridge actions and aesthetics to objects, with no typo trick', () => {
	for (const query of ['murder', 'murdering']) for (const emoji of ['🔪', '🗡️', '🩸', '💀', '⚔️']) assert(glyphs(query).slice(0, 8).includes(emoji), `${query}: ${emoji}`);
	for (const emoji of ['🖤', '🥀', '🦇', '🗡️', '🩸']) assert(glyphs('goth').includes(emoji));
	for (const [query, emoji] of [['burnout', '🪫'], ['homesick', '🏠'], ['deadline', '⏰'], ['hangover', '🤕'], ['scam', '⚠️']]) assert(glyphs(query).includes(emoji));
});

test('phrase concepts use word boundaries, respect negation, and deduplicate', () => {
	assert(relatedEmojiMatches(index, 'watching a murder mystery', true).some(hit => hit.item.e === '🔪'));
	assert.equal(relatedEmojiMatches(index, 'not murder', true).length, 0);
	assert.equal(relatedEmojiMatches(index, 'smurdering', true).length, 0);
	const hits = relatedEmojiMatches(index, 'murder gore horror', true);
	assert.equal(new Set(hits.map(hit => hit.item.e)).size, hits.length);
});

test('short strings and nonsense do not create distant name matches', () => {
	assert(!searchEmojiCatalog(index, 'cat').some(hit => hit.kind === 'fuzzy' && hit.item.e === '🦇'));
	assert.deepEqual(glyphs('qzxwvplm'), []);
	assert.deepEqual(glyphs(''), []);
	assert(searchEmojiCatalog(index, 'murder', { limit: 2 }).length === 2);
});

test('heart and hearts include the entire family before incidental keyword matches', () => {
	const hearts = data.groups.flatMap(g => g.items).filter(item => /\bhearts?\b/i.test(item.n));
	for (const query of ['heart', 'hearts', 'the heart']) {
		const hits = searchEmojiCatalog(index, query);
		assert.equal(hits[0].item.e, '❤️');
		for (const item of hearts) assert(hits.some(hit => hit.item.e === item.e && hit.kind === 'family'), `${query}: ${item.e}`);
		const lastFamily = hits.findLastIndex(hit => hit.kind === 'family');
		assert(hits.slice(0, lastFamily + 1).every(hit => hit.kind === 'family'));
	}
	assert.deepEqual(glyphs('red heart').slice(0, 1), ['❤️']);
});

test('at most two fuzzy results occupy only the final positions', () => {
	for (const query of ['heart', 'haert', 'star', 'light', 'skulll', 'red haert']) {
		const hits = searchEmojiCatalog(index, query);
		const fuzzy = hits.filter(hit => hit.kind === 'fuzzy');
		assert(fuzzy.length <= 2, query);
		if (fuzzy.length) assert(hits.slice(-fuzzy.length).every(hit => hit.kind === 'fuzzy'), query);
	}
	assert.equal(searchEmojiCatalog(index, 'haert').filter(hit => hit.kind === 'fuzzy').length, 2);
});
