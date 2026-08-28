<script>
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { db } from '$lib/firebase.js';
	import { ref, onValue } from 'firebase/database';

	// Public — no account, no login. Someone scanned a QR off a screen, and the
	// only thing standing between them and the projector should be one field
	// and one button. Everything here is sized for a phone held one-handed.

	const room = $derived(($page.params.room ?? '').toUpperCase());

	let text = $state('');
	let long = $state(false); // the checkbox: 30s (off) or a full minute (on)
	let sending = $state(false);
	let err = $state('');
	let mineId = $state('');   // queue key of my submission, once accepted
	let mineText = $state('');

	// Live room state, read straight from RTDB — `marquee/{room}` is world-
	// readable so a stranger's phone can watch the queue without an account.
	let live = $state(null);
	let liveErr = $state(false);

	const queue = $derived(
		Object.entries(live?.queue ?? {})
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([key, q]) => ({ key, ...q }))
	);
	const hostAlive = $derived(!!live?.host && Date.now() - Number(live.host.beatAt ?? live.host.at ?? 0) < 3 * 60 * 1000);
	const onStageNow = $derived(mineId && !queue.some((q) => q.key === mineId) && live?.now?.text === mineText);
	const position = $derived(mineId ? queue.findIndex((q) => q.key === mineId) + 1 : 0);

	// Rough, and deliberately so — it's "about a minute", not a countdown.
	const waitSecs = $derived.by(() => {
		if (position < 1) return 0;
		const ahead = queue.slice(0, position - 1).reduce((s, q) => s + (Number(q.holdMs) || 30000), 0);
		const cur = live?.now?.endsAt ? Math.max(0, live.now.endsAt - Date.now()) : 0;
		return Math.round((ahead + cur) / 1000);
	});

	onMount(() => {
		const unsub = onValue(
			ref(db, `marquee/${room}`),
			(snap) => { live = snap.val() ?? {}; liveErr = false; },
			() => { liveErr = true; }
		);
		// waitSecs leans on wall-clock, so nudge it along while the page is open.
		const t = setInterval(() => { live = live ? { ...live } : live; }, 1000);
		return () => { unsub(); clearInterval(t); };
	});

	async function send(e) {
		e?.preventDefault();
		const body = text.trim();
		if (!body || sending) return;
		sending = true;
		err = '';
		try {
			const res = await fetch(`/api/marquee/${room}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: body, hold: long ? 60 : 30 })
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out?.message || 'That did not go through');
			mineId = out.id;
			mineText = out.text;
			text = '';
		} catch (e2) {
			err = e2?.message || 'That did not go through';
		} finally {
			sending = false;
		}
	}

	function again() {
		mineId = '';
		mineText = '';
		err = '';
	}
</script>

<svelte:head>
	<title>{room} — put it on the screen</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap">
	<header>
		<span class="mark">eating.computer</span>
		<span class="code">{room}</span>
	</header>

	{#if mineId}
		<section class="state">
			<p class="big">{mineText}</p>
			{#if onStageNow}
				<p class="lede">It's on the screen now.</p>
			{:else if position > 0}
				<p class="lede">
					{position === 1 ? "You're next." : `${position - 1} ahead of you.`}
					{#if waitSecs > 5}<span class="dim"> About {waitSecs < 60 ? `${waitSecs}s` : `${Math.round(waitSecs / 60)} min`}.</span>{/if}
				</p>
			{:else}
				<p class="lede">It had its turn. Thanks.</p>
			{/if}
			<button class="ghost" onclick={again}>Send another</button>
		</section>
	{:else}
		<form onsubmit={send}>
			<label for="phrase">Put something on the screen</label>
			<input
				id="phrase"
				bind:value={text}
				maxlength="42"
				placeholder="say something"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				enterkeyhint="send"
			/>
			<div class="meter" class:full={text.length >= 42}>{42 - text.length}</div>

			<label class="check">
				<input type="checkbox" bind:checked={long} />
				<span>
					<strong>Hold it for a full minute</strong>
					<em>Otherwise it runs for 30 seconds.</em>
				</span>
			</label>

			{#if err}<p class="err">{err}</p>{/if}

			<button class="send" type="submit" disabled={!text.trim() || sending}>
				{sending ? 'Sending…' : 'Send it up'}
			</button>

			<p class="status">
				{#if liveErr}
					Can't reach the screen right now.
				{:else if !live}
					Connecting…
				{:else if !hostAlive}
					That screen isn't running at the moment.
				{:else if queue.length}
					{queue.length} waiting · yours goes after them
				{:else}
					Nothing waiting — yours goes up next
				{/if}
			</p>
		</form>
	{/if}
</div>

<style>
	:global(body) { margin: 0; background: #0c0c0e; }
	.wrap {
		min-height: 100dvh;
		box-sizing: border-box;
		padding: max(1.25rem, env(safe-area-inset-top)) 1.25rem max(1.25rem, env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		background: #0c0c0e;
		color: #f4f4f5;
		font-family: 'Google Sans Flex', system-ui, -apple-system, sans-serif;
	}
	header { display: flex; align-items: baseline; justify-content: space-between; }
	.mark { font-size: 0.8rem; letter-spacing: 0.02em; opacity: 0.55; }
	.code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.95rem;
		letter-spacing: 0.22em;
		opacity: 0.8;
	}

	form, .state { display: flex; flex-direction: column; gap: 0.75rem; margin-top: auto; margin-bottom: auto; }

	label[for='phrase'] { font-size: 1.35rem; line-height: 1.2; font-weight: 500; margin-bottom: 0.25rem; }

	#phrase {
		font: inherit;
		font-size: 1.5rem;
		padding: 0.85rem 1rem;
		border-radius: 14px;
		border: 1.5px solid #2c2c31;
		background: #141418;
		color: #fff;
		width: 100%;
		box-sizing: border-box;
	}
	#phrase:focus { outline: none; border-color: #7c9cff; }
	.meter { align-self: flex-end; font-size: 0.72rem; opacity: 0.4; margin-top: -0.4rem; }
	.meter.full { color: #ff8a8a; opacity: 0.9; }

	/* Big tap target: this is the one choice the submitter gets, and it's
	   being made with a thumb, standing up, in a room with the lights down. */
	.check {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		padding: 0.85rem 1rem;
		border: 1.5px solid #2c2c31;
		border-radius: 14px;
		background: #141418;
		cursor: pointer;
	}
	.check input { width: 22px; height: 22px; margin: 0.1rem 0 0; accent-color: #7c9cff; flex: none; }
	.check span { display: flex; flex-direction: column; gap: 0.15rem; }
	.check strong { font-size: 0.95rem; font-weight: 600; }
	.check em { font-style: normal; font-size: 0.78rem; opacity: 0.5; }

	.send {
		font: inherit;
		font-size: 1.05rem;
		font-weight: 600;
		padding: 0.95rem 1rem;
		border: 0;
		border-radius: 14px;
		background: #7c9cff;
		color: #0b0b10;
		cursor: pointer;
	}
	.send:disabled { opacity: 0.35; }
	.ghost {
		font: inherit;
		font-size: 0.9rem;
		padding: 0.7rem 1rem;
		border-radius: 14px;
		border: 1.5px solid #2c2c31;
		background: transparent;
		color: #f4f4f5;
		cursor: pointer;
		align-self: flex-start;
	}

	.status { font-size: 0.78rem; opacity: 0.45; margin: 0.25rem 0 0; text-align: center; }
	.err { font-size: 0.85rem; color: #ff8a8a; margin: 0; }

	.big { font-size: 2rem; line-height: 1.15; margin: 0; font-weight: 500; word-break: break-word; }
	.lede { font-size: 1rem; margin: 0; opacity: 0.75; }
	.dim { opacity: 0.6; }
</style>
