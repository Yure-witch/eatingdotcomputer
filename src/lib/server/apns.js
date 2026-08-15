// APNs sender for the native iOS shell (Capacitor). Web-push doesn't work in a
// WKWebView, so native devices register an APNs token (see /api/push/apns) and
// we deliver here over HTTP/2 with a token-based (.p8 / ES256 JWT) auth.
//
// Env (set in Vercel):
//   APNS_KEY       — the .p8 private key CONTENTS (PEM; newlines may be "\n")
//   APNS_KEY_ID    — the key's Key ID (10 chars)
//   APNS_TEAM_ID   — your Apple Team ID (10 chars)
//   APNS_BUNDLE_ID — computer.eating.app  (the apns-topic)
//   APNS_HOST      — optional; defaults to production. Use
//                    https://api.sandbox.push.apple.com for a dev/TestFlight
//                    build signed with a development provisioning profile.

import { env } from '$env/dynamic/private';
import crypto from 'node:crypto';
import http2 from 'node:http2';

export function apnsConfigured() {
	return !!(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_BUNDLE_ID);
}

// APNs provider JWTs are valid up to 1h and Apple rejects ones older than that;
// refresh well inside the window. Cache across invocations where the module
// stays warm.
let _jwt = null, _jwtAt = 0;
function providerToken() {
	const now = Math.floor(Date.now() / 1000);
	if (_jwt && now - _jwtAt < 2700) return _jwt; // < 45 min → reuse
	const key = String(env.APNS_KEY || '').replace(/\\n/g, '\n');
	if (!key || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) return null;
	const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
	const signingInput = `${b64({ alg: 'ES256', kid: env.APNS_KEY_ID })}.${b64({ iss: env.APNS_TEAM_ID, iat: now })}`;
	// ieee-p1363 → the raw R||S signature JOSE/ES256 expects (not DER).
	const sig = crypto.sign('SHA256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
	_jwt = `${signingInput}.${sig}`;
	_jwtAt = now;
	return _jwt;
}

/**
 * Deliver one payload to many device tokens over a single HTTP/2 session.
 * @returns {Promise<Array<{ token: string, ok: boolean, status: number, remove: boolean }>>}
 *   `remove` = the token is dead (uninstalled / invalid) and should be deleted.
 */
export async function sendApns(tokens, payload) {
	if (!apnsConfigured() || !tokens.length) return [];
	const jwt = providerToken();
	if (!jwt) return [];

	const host = env.APNS_HOST || 'https://api.push.apple.com';
	const body = JSON.stringify({
		aps: {
			alert: { title: payload.title, body: payload.body || '' },
			sound: 'default',
			'thread-id': payload.tag || undefined
		},
		url: payload.url || undefined
	});

	let client;
	try { client = http2.connect(host); } catch { return []; }
	const results = [];
	try {
		await new Promise((resolve) => {
			let pending = tokens.length;
			let settled = false;
			const done = () => { if (!settled) { settled = true; resolve(); } };
			client.on('error', done);
			// Safety timeout so a stalled session can't hang the request.
			const timer = setTimeout(done, 8000);
			for (const token of tokens) {
				let req;
				try {
					req = client.request({
						':method': 'POST',
						':path': `/3/device/${token}`,
						'authorization': `bearer ${jwt}`,
						'apns-topic': env.APNS_BUNDLE_ID,
						'apns-push-type': 'alert',
						'apns-priority': '10',
						'content-type': 'application/json',
						'content-length': Buffer.byteLength(body)
					});
				} catch {
					results.push({ token, ok: false, status: 0, remove: false });
					if (--pending === 0) { clearTimeout(timer); done(); }
					continue;
				}
				let status = 0, data = '';
				req.on('response', (h) => { status = Number(h[':status']) || 0; });
				req.on('data', (d) => { data += d; });
				const finish = () => {
					// 410 Unregistered, or 400 BadDeviceToken → the token is dead.
					const remove = status === 410 || (status === 400 && /BadDeviceToken|BadTopic|Unregistered/i.test(data));
					results.push({ token, ok: status === 200, status, remove });
					if (--pending === 0) { clearTimeout(timer); done(); }
				};
				req.on('end', finish);
				req.on('error', () => { results.push({ token, ok: false, status: 0, remove: false }); if (--pending === 0) { clearTimeout(timer); done(); } });
				req.end(body);
			}
		});
	} finally {
		try { client.close(); } catch {}
	}
	return results;
}
