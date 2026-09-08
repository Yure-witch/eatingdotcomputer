import assert from 'node:assert/strict';
import test from 'node:test';
import { appendTrail, resampleTrail, snakeGeometry, fitTrail, moveTrail, trailBounds, stretchPatches } from '../src/lib/emoji-stretcher.js';

const winding = Array.from({ length: 121 }, (_, i) => ({ x: 70 + i * 5, y: 210 + Math.sin(i / 15) * 125 }));

test('the emoji follows a winding path and preserves both tips', () => {
	const { sections, bounds, length } = snakeGeometry(winding, 400, 400, 80);
	const center = (s) => ({ x: (s.top.x + s.bottom.x) / 2, y: (s.top.y + s.bottom.y) / 2 });
	assert.deepEqual(center(sections[0]), winding[0]);
	assert.deepEqual(center(sections.at(-1)), winding.at(-1));
	assert(bounds.h > 300);
	assert(length > 750);
	assert.equal(sections[0].u, 0);
	assert.equal(sections.at(-1).u, 400);
	for (let i = 1; i < sections.length; i++) {
		assert(sections[i].u > sections[i - 1].u);
		assert(Math.abs(Math.hypot(sections[i].top.x - sections[i].bottom.x, sections[i].top.y - sections[i].bottom.y) - 80) < 1e-8);
	}
});

test('only the middle elongates; the end cap keeps its natural length', () => {
	const { sections } = snakeGeometry([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 400, 400, 100, 0.08);
	const cap = sections.find((s) => Math.abs(s.top.x - 24) < 2);
	assert(Math.abs(cap.u - cap.top.x * 4) < 1e-8);
	const mid = sections.find((s) => s.top.x > 500);
	assert(mid.u > 200 && mid.u < 202);
});

test('a second drag continues the same path instead of replacing it with a box', () => {
	const original = [{ x: 40, y: 50 }, { x: 100, y: 50 }];
	let trail = appendTrail(original, { x: 160, y: 150 });
	trail = appendTrail(trail, { x: 70, y: 230 });
	assert.deepEqual(trail[0], original[0]);
	assert.deepEqual(trail.at(-1), { x: 70, y: 230 });
	assert.equal(original.length, 2);
});

test('repeated samples, hairpins and closed loops remain finite', () => {
	for (const points of [
		[{ x: 0, y: 0 }, { x: 0, y: 0 }],
		[{ x: 0, y: 0 }, { x: NaN, y: 2 }, { x: 30, y: 40 }],
		[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }],
		[{ x: 50, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 250 }, { x: 50, y: 250 }, { x: 50, y: 50 }]
	]) {
		const geometry = snakeGeometry(points, 120, 400, 90, 1);
		assert(Number.isFinite(geometry.length));
		for (const s of geometry.sections) for (const value of [s.u, s.top.x, s.top.y, s.bottom.x, s.bottom.y]) assert(Number.isFinite(value));
	}
});

test('moving and resizing the viewport keep the entire ribbon inside the stage', () => {
	const fitted = fitTrail(winding, 80, 310, 260);
	for (const [dx, dy] of [[0, 0], [-1000, 1000], [1000, -1000]]) {
		const moved = moveTrail(fitted, dx, dy, 80, 310, 260);
		const b = trailBounds(moved, 42);
		assert(b.x >= -1e-8 && b.y >= -1e-8 && b.x + b.w <= 310 + 1e-8 && b.y + b.h <= 260 + 1e-8);
	}
});

test('long trails are bounded without losing their endpoints', () => {
	const long = Array.from({ length: 5000 }, (_, i) => ({ x: i, y: Math.sin(i / 30) * 100 }));
	const sampled = resampleTrail(long, 1, 700);
	assert.equal(sampled.length, 700);
	assert.deepEqual(sampled[0], long[0]);
	assert.deepEqual(sampled.at(-1), long.at(-1));
	const appended = appendTrail(long, { x: 5001, y: 20 });
	assert(appended.length <= 1536);
	assert.deepEqual(appended[0], long[0]);
	assert.deepEqual(appended.at(-1), { x: 5001, y: 20 });
});

test('Box mode still covers rectangular exports without gaps', () => {
	for (const [w, h] of [[48, 48], [800, 100], [100, 800], [2048, 2048]]) {
		const patches = stretchPatches(400, 320, w, h);
		assert.equal(patches.reduce((area, p) => area + p[6] * p[7], 0), w * h);
	}
});
