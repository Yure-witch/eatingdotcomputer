import { json, error } from '@sveltejs/kit';
import { getAdminDb } from '$lib/server/firebase-admin.js';

// Marquee submissions — the public end of /app/lab/marquee.
//
// Anyone who scans the QR lands on /m/{room} and posts here; the display page
// owns the playback clock and reads the queue live from RTDB. Submissions go
// through the server rather than straight into RTDB so the marquee node can
// stay write-locked to signed-in hosts: a room code on a projector is visible
// to the whole room (and to anyone who photographs the screen), so an open
// RTDB write rule would be an open write rule to the internet.
//
//   marquee/{room}/host           — { by, name, at, beatAt } written by the display
//   marquee/{room}/queue/{pushId} — { text, holdMs, at, from } (this endpoint)
//   marquee/{room}/now            — { text, holdMs, startedAt, endsAt } (the display)

const MAX_LEN = 42;
const QUEUE_CAP = 24;
const PER_IP_PENDING = 2; // how many of the queue one phone may hold
const PER_IP_COOLDOWN_MS = 8000;
const HOST_STALE_MS = 3 * 60 * 1000; // no heartbeat this long → the screen is gone

// Deliberately short: this is a politeness filter for a projector in a
// classroom, not moderation. The host has Skip and Clear for everything else.
const BLOCKED =
	/\b(f+u+c+k+|sh+i+t+|c+u+n+t+|b+i+t+c+h+|n+i+g+g+(a+|e+r+)|f+a+g+(g+o+t+)?|r+e+t+a+r+d+|w+h+o+r+e+|s+l+u+t+|r+a+p+e+)\b/i;

// Per-instance and therefore best-effort — a serverless deploy can spread two
// requests across two instances. It stops the accidental double-tap and the
// bored phone, which is the realistic failure mode here; the hard ceiling is
// QUEUE_CAP, which is checked against RTDB and so holds everywhere.
const recent = new Map(); // ip → last submit ms
function sweep(now) {
	for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
}

function cleanText(raw) {
	return String(raw ?? '')
		.replace(/[\u0000-\u001f\u007f]/g, ' ') // control chars, incl. newlines
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_LEN);
}

export async function POST({ request, params, getClientAddress }) {
	const room = String(params.room ?? '').toUpperCase();
	if (!/^[A-Z0-9]{4,8}$/.test(room)) error(400, 'Bad room code');

	const body = await request.json().catch(() => null);
	const text = cleanText(body?.text);
	if (!text) error(400, 'Type something first');
	if (BLOCKED.test(text)) error(400, 'That one is not going on the big screen');

	// The checkbox on /m/{room} is a two-way choice; anything else is a
	// hand-rolled request, so clamp rather than trust.
	const holdMs = Number(body?.hold) === 60 ? 60_000 : 30_000;

	const db = getAdminDb();
	const roomRef = db.ref(`marquee/${room}`);

	const host = (await roomRef.child('host').get()).val();
	if (!host) error(404, 'No screen is using that code');
	if (Date.now() - Number(host.beatAt ?? host.at ?? 0) > HOST_STALE_MS) {
		error(410, 'That screen went to sleep');
	}

	const ip = getClientAddress();
	const now = Date.now();
	sweep(now);
	if (now - (recent.get(ip) ?? 0) < PER_IP_COOLDOWN_MS) {
		error(429, 'One at a time — give it a few seconds');
	}

	const queue = (await roomRef.child('queue').get()).val() ?? {};
	const entries = Object.entries(queue);
	if (entries.length >= QUEUE_CAP) error(429, 'The queue is full — try again in a minute');
	if (entries.filter(([, q]) => q?.from === ip).length >= PER_IP_PENDING) {
		error(429, 'You already have one waiting');
	}

	// Push IDs sort chronologically, so the queue IS the running order and the
	// display can take the head with a limitToFirst(1) — no index, no sort key.
	const ref = await roomRef.child('queue').push({ text, holdMs, at: now, from: ip });
	recent.set(ip, now);

	return json({ ok: true, id: ref.key, position: entries.length + 1, text, holdMs });
}
