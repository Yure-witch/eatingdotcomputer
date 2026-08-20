import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/turso.js';
import { resolveAiCreds } from '$lib/server/ai-creds.js';

const SYSTEM_PROMPT =
	'You are Gemma, a friendly AI assistant inside eating.computer, the class ' +
	'platform for Interactive Design Concepts at Cooper Union. Be concise, ' +
	'warm and practical. You can help with design thinking, coding, writing ' +
	'and coursework questions.';

// Streams a chat completion from the CALLER'S own saved Gemma endpoint.
// Pure passthrough of the upstream SSE body — the key stays server-side.
export async function POST({ request, locals }) {
	const session = await locals.auth();
	if (!session) error(401, 'Unauthorized');

	// Own key → an instructor's → the class-wide GEMMA_KEY. Without the last
	// rung, anyone who hasn't fetched a personal key (including the App Store
	// review account) hits a setup wall instead of Gemma.
	const creds = await resolveAiCreds(session.user.id);
	if (!creds) return json({ code: 'no_key' }, { status: 400 });

	const { messages } = await request.json();
	if (!Array.isArray(messages) || !messages.length) error(400, 'messages required');
	// content may be a plain string or OpenAI content parts (text +
	// image_url) — Gemma is multimodal. Sanitize parts: only text and
	// data:/https images, with size caps.
	const cleanPart = (p) => {
		if (p?.type === 'text' && typeof p.text === 'string') return { type: 'text', text: p.text.slice(0, 16000) };
		if (p?.type === 'image_url') {
			const url = String(p.image_url?.url ?? '');
			const okData = url.startsWith('data:image/') && url.length < 8_000_000;
			const okHttp = url.startsWith('https://') && url.length < 2048;
			if (okData || okHttp) return { type: 'image_url', image_url: { url } };
		}
		return null;
	};
	const clean = messages
		.filter((m) => m.role === 'user' || m.role === 'assistant')
		.slice(-40)
		.map((m) => {
			if (typeof m.content === 'string') return { role: m.role, content: m.content.slice(0, 16000) };
			if (Array.isArray(m.content)) {
				const parts = m.content.map(cleanPart).filter(Boolean).slice(0, 5);
				if (parts.length) return { role: m.role, content: parts };
			}
			return null;
		})
		.filter(Boolean);
	if (!clean.length) error(400, 'no valid messages');

	const auth = { Authorization: `Bearer ${creds.api_key}` };
	// resolve the first model the key can see (the class service exposes one)
	let model;
	try {
		const mres = await fetch(`${creds.base_url}/models`, { headers: auth });
		if (!mres.ok) {
			// only actual auth statuses mean a bad key — a 500 from the
			// service being down is NOT "key rejected"
			const code = mres.status === 401 || mres.status === 403 ? 'auth_failed' : 'upstream_error';
			return json({ code, status: mres.status }, { status: 502 });
		}
		model = (await mres.json()).data?.[0]?.id;
	} catch {
		return json({ code: 'unreachable' }, { status: 502 });
	}
	if (!model) return json({ code: 'no_models' }, { status: 502 });

	const upstream = await fetch(`${creds.base_url}/chat/completions`, {
		method: 'POST',
		headers: { ...auth, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model,
			stream: true,
			messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...clean]
		})
	});
	if (!upstream.ok || !upstream.body) {
		return json({ code: 'upstream_error', status: upstream.status }, { status: 502 });
	}
	return new Response(upstream.body, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
}
