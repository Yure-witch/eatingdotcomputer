import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseAnnotations, extractSenses, chooseSynonyms, enrichXml } from './enrich-emoji-annotations.mjs';

test('XML enrichment preserves original annotations, names, comments and escaping', () => {
	const xml = '<?xml version="1.0"?><ldml><!-- <annotation cp="x">ignore</annotation> -->\n<annotations>' +
		'<annotation cp="🤪">crazy | goofy</annotation>\n<annotation cp="🤪" type="tts">zany face</annotation>' +
		'<annotation cp="&amp;">ampersand</annotation></annotations></ldml>';
	const records = parseAnnotations(xml);
	assert.equal(records.length, 2);
	assert.equal(records[1].glyph, '&');
	const enriched = enrichXml(xml, records, new Map([['🤪', [{ word: 'silly' }, { word: 'odd & funny' }]] ]));
	assert.equal(enriched, xml.replace('crazy | goofy</annotation>', 'crazy | goofy | silly | odd &amp; funny</annotation>'));
	assert.equal(enrichXml(xml, records, new Map()), xml);
});

test('API spelling suggestions and unrelated entries never become synonyms', () => {
	assert.deepEqual(extractSenses(['cat', 'hat'], 'bat'), []);
	assert.deepEqual(extractSenses([{ meta: { id: 'cat', stems: ['cats'] }, def: [] }], 'bat'), []);
});

test('sense selection distinguishes a flying bat from a baseball bat', () => {
	const record = { name: 'bat', keywords: ['bat', 'animal', 'wing', 'mammal'] };
	const payload = [{ meta: { id: 'bat', stems: ['bat', 'bats'] }, fl: 'noun', def: [{ sseq: [
		[['sense', { sn: '1', dt: [['text', 'a club for baseball']], syn_list: [[{ wd: 'club' }, { wd: 'bludgeon' }]], ant_list: [[{ wd: 'antonym' }]] }]],
		[['sense', { sn: '2', dt: [['text', 'a flying animal with wings']], syn_list: [[{ wd: 'chiropteran' }, { wd: 'flying mammal' }, { wd: 'flittermouse' }, { wd: 'flier' }]] }]]
	] }] }];
	const chosen = chooseSynonyms(record, new Map([['bat', { payload }]]));
	assert.equal(chosen.length, 4);
	assert(chosen.every(hit => hit.sense === '2'));
	assert(!chosen.some(hit => ['club', 'antonym'].includes(hit.word)));
});

test('existing keywords, duplicates and unavailable synonyms do not pad the count', () => {
	const payload = [{ meta: { id: 'zany' }, fl: 'adjective', def: [{ sseq: [[['sense', {
		 dt: [['text', 'goofy']], syn_list: [[{ wd: 'goofy' }, { wd: 'silly' }, { wd: 'silly' }]]
	}]]] }] }];
	assert.deepEqual(chooseSynonyms({ name: 'zany face', keywords: ['zany', 'goofy'] }, new Map([['zany', { payload }]])).map(hit => hit.word), ['silly']);
});

test('saved upstream XML still matches its untouched checksum', () => {
	const source = JSON.parse(readFileSync(new URL('../data/emoji-annotations/source.json', import.meta.url)));
	const xml = readFileSync(new URL('../data/emoji-annotations/en.xml', import.meta.url));
	assert.equal(createHash('sha256').update(xml).digest('hex'), source.sha256);
	assert(parseAnnotations(xml.toString()).length > 1900);
});
