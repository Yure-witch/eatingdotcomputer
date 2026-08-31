// Lab → Rank It. Shared shapes and scoring for ranked polls.

export const MAX_ITEMS = 40;
export const MAX_LABEL = 200;

/** Split a pasted block into item labels — one per line, blanks dropped. */
export function parseItems(input) {
	const lines = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
	const out = [];
	for (const line of lines) {
		// Tolerate the list markers people paste along with their list.
		const label = String(line ?? '')
			.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
			.trim()
			.slice(0, MAX_LABEL);
		if (label) out.push(label);
	}
	return out.slice(0, MAX_ITEMS);
}

/**
 * A stable shuffle of `ids`, seeded by `seed`.
 *
 * Every student gets the list in a different order so the instructor's typing
 * order doesn't become the class's answer — but the SAME different order every
 * time they load it, so refreshing halfway through ranking doesn't throw away
 * the arrangement they were building.
 */
export function seededShuffle(ids, seed) {
	let h = 2166136261;
	for (const ch of String(seed)) {
		h ^= ch.charCodeAt(0);
		h = Math.imul(h, 16777619);
	}
	// xorshift32, seeded by the FNV hash above — small, deterministic, and
	// good enough to break up an ordering.
	const next = () => {
		h ^= h << 13; h >>>= 0;
		h ^= h >>> 17;
		h ^= h << 5;  h >>>= 0;
		return h / 4294967296;
	};
	const out = [...ids];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/**
 * Reconcile a stored ballot against the poll's current items.
 *
 * Items the poll no longer has are dropped, items added since the ballot was
 * cast are appended in the order the viewer would otherwise see them. That way
 * editing a poll mid-flight never invalidates what people already submitted.
 */
export function reconcile(ranking, itemIds, fallbackOrder = itemIds) {
	const valid = new Set(itemIds);
	const seen = new Set();
	const out = [];
	for (const id of ranking ?? []) {
		const n = Number(id);
		if (valid.has(n) && !seen.has(n)) { seen.add(n); out.push(n); }
	}
	for (const id of fallbackOrder) if (!seen.has(id)) out.push(id);
	return out;
}

/**
 * Tally ballots into a class ordering.
 *
 * The headline number is AVERAGE RANK, because it reads directly ("this came
 * out 2.4th on average") in a way a Borda point total doesn't. An item is
 * averaged only over the ballots that actually ranked it, so an item added
 * after some people voted isn't punished for their silence — `votes` says how
 * many ballots it stands on.
 *
 * @param {{id:number,label:string}[]} items
 * @param {number[][]} ballots  each a list of item ids, best first
 */
export function tally(items, ballots) {
	const n = items.length;
	const stats = new Map(
		items.map((it) => [it.id, { ...it, sum: 0, votes: 0, firstPlace: 0, counts: new Array(n).fill(0) }])
	);
	for (const ballot of ballots) {
		ballot.forEach((id, idx) => {
			const s = stats.get(id);
			if (!s) return;
			s.sum += idx + 1;
			s.votes++;
			if (idx === 0) s.firstPlace++;
			if (idx < n) s.counts[idx]++;
		});
	}
	return [...stats.values()]
		.map((s) => ({
			id: s.id,
			label: s.label,
			votes: s.votes,
			firstPlace: s.firstPlace,
			counts: s.counts,
			averageRank: s.votes ? s.sum / s.votes : null
		}))
		.sort((a, b) => {
			// Unranked items sink; ties break on first-place votes, then label,
			// so the order is stable across refreshes instead of jittering.
			if (a.averageRank == null) return b.averageRank == null ? 0 : 1;
			if (b.averageRank == null) return -1;
			return a.averageRank - b.averageRank
				|| b.firstPlace - a.firstPlace
				|| a.label.localeCompare(b.label);
		});
}

// The public join code that goes on the projector. Short enough to read off a
// screen and type by hand, from an alphabet with no 0/O or 1/I/L to misread —
// the same trade the marquee room codes make.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeShareCode(len = 6) {
	const bytes = crypto.getRandomValues(new Uint8Array(len));
	let out = '';
	// 256 % 32 === 0, so a plain modulo is uniform here — no rejection needed.
	for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
	return out;
}

/** Guest ids are minted on the phone and kept in localStorage; keep them sane. */
export const isGuestId = (v) => typeof v === 'string' && /^guest:[A-Za-z0-9_-]{8,64}$/.test(v);

export const FORMATS = ['full', 'favorites'];
export const MIN_FLOOR = 1;   // "at least one of each" is the least this format can mean
export const MIN_CEIL = 20;

/**
 * Check a favorites-format ballot.
 *
 * Returns an error string, or null if it's good. The rules are the whole
 * contract of the format: enough of each end, nothing counted twice, and
 * anything they had no feeling about simply left out.
 */
export function checkFavoritesBallot(fav, least, itemIds, minFav, minLeast) {
	const valid = new Set(itemIds);
	const f = (fav ?? []).map(Number);
	const l = (least ?? []).map(Number);

	if (new Set(f).size !== f.length || new Set(l).size !== l.length) return 'Something is listed twice';
	if (f.some((id) => !valid.has(id)) || l.some((id) => !valid.has(id))) return 'That pool changed — reload and pick again';

	const overlap = f.find((id) => l.includes(id));
	if (overlap != null) return 'Something is in both your favorites and your least favorites';

	if (f.length < minFav) return `Pick at least ${minFav} favorite${minFav === 1 ? '' : 's'}`;
	if (l.length < minLeast) return `Pick at least ${minLeast} least favorite${minLeast === 1 ? '' : 's'}`;

	// Both ends can't between them exceed the pool, which would mean an id
	// snuck in twice across the two lists — already caught above, but this
	// keeps the guarantee explicit rather than emergent.
	if (f.length + l.length > itemIds.length) return 'That is more picks than the pool holds';
	return null;
}

/**
 * Tally favorites-format ballots into one ordering, best-loved first.
 *
 * Each ballot is normalised to itself before it's added up: your top favorite
 * is worth +1 and your bottom least-favorite −1 whether you ranked three
 * things or ten. Without that, the person who ranked ten would simply outvote
 * the person who ranked three, and the format invites exactly that difference.
 *
 * `score` is the average of those weights across ALL ballots — an item nobody
 * mentioned scores 0, which is the honest reading of "no strong feeling".
 *
 * @param {{id:number,label:string}[]} items
 * @param {{fav:number[],least:number[]}[]} ballots
 */
export function tallyFavorites(items, ballots) {
	const stats = new Map(
		items.map((it) => [it.id, { ...it, favCount: 0, leastCount: 0, raw: 0 }])
	);
	for (const b of ballots) {
		const f = b.fav ?? [], l = b.least ?? [];
		f.forEach((id, i) => {
			const s = stats.get(id);
			if (!s) return;
			s.favCount++;
			s.raw += (f.length - i) / f.length;
		});
		l.forEach((id, j) => {
			const s = stats.get(id);
			if (!s) return;
			s.leastCount++;
			s.raw -= (l.length - j) / l.length;
		});
	}
	const n = ballots.length || 1;
	return [...stats.values()]
		.map((s) => ({
			id: s.id,
			label: s.label,
			favCount: s.favCount,
			leastCount: s.leastCount,
			score: s.raw / n,
			mentions: s.favCount + s.leastCount
		}))
		.sort((a, b) =>
			b.score - a.score
			|| b.favCount - a.favCount
			|| a.label.localeCompare(b.label)
		);
}

/**
 * Fold a label for duplicate-checking.
 *
 * A room of thirty adding write-ins will produce "Blue Train", "blue train"
 * and "Blue  Train " within a minute, and three bars that should be one bar
 * makes the tally wrong, not just untidy.
 */
export const foldLabel = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
