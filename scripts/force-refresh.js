// Force every signed-in client onto whatever is currently deployed.
//
// Writes a fresh timestamp to RTDB `dev/refreshNeeded`. Every running client
// watches that key (see the "Dev: remote hard refresh" block in
// src/routes/app/+layout.svelte) and, on a value that CHANGES while it is
// running, calls hardRefresh() from $lib/hard-refresh.js — unregister the
// service worker, delete every cache, cache-busted reload. Devices that are
// closed pick up the new build on their next launch anyway.
//
// The database rules set `.write: false` on this key, so it can only be
// stamped from here (Admin SDK) or the Firebase console — nothing in the app
// can trip it by accident.
//
// This is a blunt instrument and it is rarely needed: content-hashed assets
// never go stale under their own name, HTML is network-first, and the app
// already polls for new deploys and reloads itself. Reach for it when a device
// is demonstrably stuck on an old build — compare what `dev/clients/*` reports
// against /_app/version.json.
//
// Usage: node scripts/force-refresh.js [--dry]
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { config } from 'dotenv';

config({ path: '.env' });

const dry = process.argv.includes('--dry');

const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!key || !process.env.FIREBASE_DATABASE_URL) {
	console.error('missing FIREBASE_SERVICE_ACCOUNT_KEY / FIREBASE_DATABASE_URL in .env');
	process.exit(1);
}

const app = initializeApp({
	credential: cert(JSON.parse(key)),
	databaseURL: process.env.FIREBASE_DATABASE_URL
});
const db = getDatabase(app);

// What each device last reported it was running, so the effect of this is
// visible rather than assumed.
const clients = (await db.ref('dev/clients').get()).val() ?? {};
const rows = [];
for (const [userId, devices] of Object.entries(clients)) {
	for (const [deviceId, info] of Object.entries(devices ?? {})) {
		rows.push({ userId, deviceId, ...info });
	}
}
rows.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
console.log(`${rows.length} device(s) have reported a build:`);
for (const r of rows.slice(0, 20)) {
	const seen = r.at ? new Date(r.at).toISOString() : '?';
	console.log(`  ${r.build || '?'}  ${seen}  ${r.standalone ? 'standalone' : 'browser'}  ${r.userId}/${r.deviceId}`);
}

const prev = (await db.ref('dev/refreshNeeded').get()).val();
const now = Date.now();
console.log(`\ndev/refreshNeeded: ${prev ?? '(unset)'} -> ${now}`);

if (dry) {
	console.log('--dry: nothing written');
	process.exit(0);
}

await db.ref('dev/refreshNeeded').set(now);
console.log('stamped. Every client running right now will hard-refresh.');
process.exit(0);
