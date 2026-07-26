<script>
	import { onMount } from 'svelte';
	import { pageTitle } from '$lib/page-title-store.js';

	// Per-user Gemma (OpenAI-compatible) credentials. Each student brings
	// their own key — the instructor shares how to get one for the class
	// service. The key never renders back; only its last 4 characters.
	let loading = $state(true);
	let hasKey = $state(false);
	let last4 = $state('');
	let baseUrl = $state('https://chatterbox.ee.cooper.edu/api/v1');
	let apiKey = $state('');
	let saving = $state(false);
	let status = $state(null);      // { kind: 'ok' | 'err', text }
	let testing = $state(false);
	let models = $state([]);

	onMount(async () => {
		pageTitle.set('Gemma');
		const res = await fetch('/api/ai/key');
		if (res.ok) {
			const data = await res.json();
			hasKey = data.hasKey;
			if (data.baseUrl) baseUrl = data.baseUrl;
			last4 = data.last4 ?? '';
		}
		loading = false;
	});

	async function save() {
		saving = true; status = null; models = [];
		const res = await fetch('/api/ai/key', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ baseUrl, apiKey: apiKey.trim() })
		});
		if (res.ok) {
			if (apiKey.trim()) { hasKey = true; last4 = apiKey.trim().slice(-4); }
			apiKey = '';
			status = { kind: 'ok', text: 'Saved.' };
		} else {
			const body = await res.json().catch(() => null);
			status = { kind: 'err', text: body?.message ?? 'Could not save.' };
		}
		saving = false;
	}

	async function testConnection() {
		testing = true; status = null; models = [];
		const res = await fetch('/api/ai/test', { method: 'POST' });
		const data = await res.json().catch(() => null);
		if (data?.ok) {
			models = data.models;
			status = { kind: 'ok', text: `Connected — ${models.length} model${models.length === 1 ? '' : 's'} available.` };
		} else {
			status = { kind: 'err', text: data?.message ?? 'Connection failed.' };
		}
		testing = false;
	}

	async function removeKey() {
		if (!confirm('Remove your saved API key?')) return;
		await fetch('/api/ai/key', { method: 'DELETE' });
		hasKey = false; last4 = ''; models = []; status = null;
	}
</script>

<svelte:head><title>Gemma — eating.computer</title></svelte:head>

<main class="ai-page">
	<div class="ai-card">
		<h1>Gemma</h1>
		<p class="ai-blurb">
			Connect your own Gemma account. Ask your instructor how to get an
			API key for the class service — once it's saved here, Gemma
			features run with <em>your</em> credentials, private to you.
		</p>

		{#if loading}
			<p class="ai-muted">Loading…</p>
		{:else}
			{#if hasKey}
				<div class="ai-keystate">
					<span class="ai-dot"></span>
					Key saved <code>····{last4}</code>
					<button class="ai-link-btn" onclick={removeKey}>remove</button>
				</div>
			{/if}

			<label class="ai-field">
				<span>Service URL</span>
				<input type="url" bind:value={baseUrl} placeholder="https://chatterbox.ee.cooper.edu/api/v1" />
			</label>

			<label class="ai-field">
				<span>{hasKey ? 'Replace API key' : 'API key'}</span>
				<input type="password" bind:value={apiKey} placeholder="sk-…" autocomplete="off" />
			</label>

			<div class="ai-actions">
				<button class="ai-btn ai-btn-primary" disabled={saving || (!hasKey && !apiKey.trim())} onclick={save}>
					{saving ? 'Saving…' : 'Save'}
				</button>
				<button class="ai-btn" disabled={!hasKey || testing} onclick={testConnection}>
					{testing ? 'Testing…' : 'Test connection'}
				</button>
			</div>

			{#if status}
				<p class="ai-status" class:ok={status.kind === 'ok'} class:err={status.kind === 'err'}>{status.text}</p>
			{/if}

			{#if models.length}
				<ul class="ai-models">
					{#each models as m (m.id)}
						<li><b>{m.name}</b> <code>{m.id}</code></li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</main>

<style>
	.ai-page {
		min-height: 100dvh;
		background: var(--paper);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: calc(2rem + var(--header-h, 52px)) 1.5rem 4rem;
		box-sizing: border-box;
	}
	.ai-card { width: 100%; max-width: 520px; }
	h1 { margin: 0 0 0.5rem; font-size: 1.6rem; }
	.ai-blurb { color: var(--muted-fg); font-size: 0.92rem; line-height: 1.55; margin: 0 0 1.5rem; }
	.ai-muted { color: var(--muted-fg); }
	.ai-keystate {
		display: flex; align-items: center; gap: 0.45rem;
		font-size: 0.85rem; margin-bottom: 1.2rem;
		color: var(--ink);
	}
	.ai-dot { width: 8px; height: 8px; border-radius: 50%; background: #34a853; }
	.ai-keystate code { background: var(--surface-2); padding: 0.1rem 0.4rem; border-radius: 5px; }
	.ai-link-btn { background: none; border: none; color: var(--muted-fg); text-decoration: underline; cursor: pointer; font-size: 0.8rem; }
	.ai-field { display: block; margin-bottom: 1rem; }
	.ai-field span { display: block; font-size: 0.8rem; font-weight: 600; color: var(--muted-fg); margin-bottom: 0.3rem; }
	.ai-field input {
		width: 100%; box-sizing: border-box;
		font-family: inherit; font-size: 0.92rem;
		padding: 0.55rem 0.7rem;
		border: 1.5px solid var(--border); border-radius: 10px;
		background: var(--paper); color: var(--ink);
	}
	.ai-field input:focus { outline: none; border-color: var(--ink); }
	.ai-actions { display: flex; gap: 0.6rem; margin-top: 1.2rem; }
	.ai-btn {
		font-family: inherit; font-size: 0.88rem; font-weight: 600;
		padding: 0.5rem 1rem; border-radius: 10px; cursor: pointer;
		border: 1.5px solid var(--border); background: var(--paper); color: var(--ink);
	}
	.ai-btn:disabled { opacity: 0.5; cursor: default; }
	.ai-btn-primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
	.ai-status { font-size: 0.85rem; margin-top: 1rem; }
	.ai-status.ok { color: #2c8a4b; }
	.ai-status.err { color: #c0392b; }
	.ai-models { list-style: none; margin: 0.8rem 0 0; padding: 0; }
	.ai-models li {
		font-size: 0.85rem; padding: 0.5rem 0.7rem;
		border: 1px solid var(--border); border-radius: 10px; margin-bottom: 0.4rem;
		display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
	}
	.ai-models code { color: var(--muted-fg); font-size: 0.75rem; }
</style>
