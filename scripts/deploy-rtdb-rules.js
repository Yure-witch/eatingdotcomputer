// Deploy database.rules.json to the live Realtime Database.
//
// Exists because `firebase deploy --only database` crashes on this machine's
// Node (firebase-tools pulls in a dependency that touches SlowBuffer, which
// newer Node removed). This goes straight to the RTDB REST endpoint with the
// service account instead — same effect, no CLI.
//
// Deploying REPLACES EVERY RULE in the database, so this is deliberately
// careful: it fetches what is live, prints a node-by-node diff against the
// local file, and does nothing unless you pass --yes. If the live rules have
// been edited somewhere else (the console, another machine), you'll see those
// nodes as "only deployed" or "differs" and can stop before overwriting them.
//
//   node scripts/deploy-rtdb-rules.js          # diff only
//   node scripts/deploy-rtdb-rules.js --yes    # diff, then deploy
import { cert } from 'firebase-admin/app';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';

config({ path: '.env' });
const YES = process.argv.includes('--yes');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
const { access_token } = await cert(sa).getAccessToken();
const url = `${process.env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/.settings/rules.json`;
const auth = { Authorization: `Bearer ${access_token}` };

const localText = readFileSync('database.rules.json', 'utf8');
const local = JSON.parse(localText); // throws on invalid JSON — before we touch anything

const res = await fetch(url, { headers: auth });
if (!res.ok) {
	console.error(`could not read live rules: HTTP ${res.status}`);
	process.exit(1);
}
const deployed = JSON.parse(await res.text());

const dk = Object.keys(deployed.rules ?? {});
const lk = Object.keys(local.rules ?? {});
const onlyDeployed = dk.filter((k) => !lk.includes(k));
const onlyLocal = lk.filter((k) => !dk.includes(k));
const differs = dk.filter((k) => lk.includes(k) && JSON.stringify(deployed.rules[k]) !== JSON.stringify(local.rules[k]));

console.log('only live (would be REMOVED):', onlyDeployed.join(', ') || '-');
console.log('only local (would be added)  :', onlyLocal.join(', ') || '-');
console.log('changed                      :', differs.join(', ') || '-');

if (!onlyDeployed.length && !onlyLocal.length && !differs.length) {
	console.log('\nlive rules already match — nothing to deploy');
	process.exit(0);
}
if (onlyDeployed.length) {
	console.log('\n!! the live database has rules this file does not. Deploying would delete them.');
	console.log('!! Pull them into database.rules.json first unless removing them is the point.');
}
if (!YES) {
	console.log('\ndry run — pass --yes to deploy');
	process.exit(0);
}

const put = await fetch(url, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: localText });
const body = await put.text();
console.log(`\ndeploy -> HTTP ${put.status} ${body.slice(0, 200)}`);
process.exit(put.ok ? 0 : 1);
