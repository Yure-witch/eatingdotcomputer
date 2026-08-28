<script>
	import { onMount, onDestroy } from 'svelte';
	import { makeScene } from '$lib/gen-art.js';
	import { supportsFontStretch } from '$lib/gif-studio.js';
	import { MARQUEE_SET, dwellMs, optsFor } from '$lib/marquee-set.js';
	import { qrSvg } from '$lib/qr.js';
	import { db, auth } from '$lib/firebase.js';
	import { ref, onValue, set as dbSet, remove, update, runTransaction } from 'firebase/database';
	import { signInWithCustomToken } from 'firebase/auth';

	let { data } = $props();

	// ── Room code ────────────────────────────────────────────────────────────
	// No O/0/I/1: the code gets read off a projector and typed into a phone by
	// someone at the back of the room.
	const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	const newCode = () =>
		Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => ALPHABET[b % ALPHABET.length]).join('');

	let room = $state('');
	let origin = $state('');
	const joinUrl = $derived(room && origin ? `${origin}/m/${room}` : '');

	// ── Live room state (RTDB) ───────────────────────────────────────────────
	let now = $state(null); // { text, holdMs, startedAt, endsAt }
	let queue = $state([]); // [{ key, text, holdMs, at }] in play order
	let idleText = $state('eating.computer');
	let connected = $state(false);

	// The phrase on screen: whatever holds the stage, else the idle text.
	const phrase = $derived((now?.text || idleText || 'eating.computer').trim());
	let holdLeft = $state(0); // ms remaining on the current hold (0 = idle)

	// ── Cycling ──────────────────────────────────────────────────────────────
	let vIndex = $state(0);
	let paused = $state(false);
	const variation = $derived(MARQUEE_SET[vIndex % MARQUEE_SET.length]);

	// ── Canvas ───────────────────────────────────────────────────────────────
	let stageEl = $state(null);
	let canvasEl = $state(null);
	let ctx = null;
	let scene = null;
	let hasStretch = $state(true);
	let fontsReady = $state(false);
	let cw = $state(1280), ch = $state(720);
	let sceneStart = 0; // performance.now() when the current variation took over

	let presenting = $state(false);

	function liveOpts() {
		return optsFor(variation, phrase, { hasStretch });
	}

	// Structural inputs rebuild the scene: text and dimensions are baked into
	// the glyph rasters and sim grids, not read per frame.
	$effect(() => {
		void [variation.mode, phrase, cw, ch, fontsReady];
		if (!canvasEl) return;
		// Only on a real size change — assigning width/height clears the canvas,
		// and clearing it on every text change flashes black between phrases.
		if (canvasEl.width !== cw) canvasEl.width = cw;
		if (canvasEl.height !== ch) canvasEl.height = ch;

		const next = makeScene(variation.mode, { W: cw, H: ch, getOpts: liveOpts, seed: 1337 });
		// Some scenes load asynchronously (Type Orbit pulls in three.js and the
		// variable font). Handing one to the loop before it's ready paints an
		// empty stage for the first seconds of its slot — which, at a 10s dwell,
		// is most of its slot. Keep showing the outgoing look until it's up.
		let cancelled = false;
		const go = () => {
			if (cancelled) return;
			scene = next;
			sceneStart = performance.now();
			if (ctx) next.render(ctx);
		};
		if (next.ready) next.ready().then(go, go);
		else go();
		return () => { cancelled = true; };
	});

	// A new phrase should feel like it took the screen, so hand it to the NEXT
	// look rather than letting it inherit the tail of the one already running.
	let lastPhrase = '';
	$effect(() => {
		const p = phrase;
		if (lastPhrase && p !== lastPhrase) vIndex = (vIndex + 1) % MARQUEE_SET.length;
		lastPhrase = p;
	});

	function fitCanvas() {
		if (!stageEl) return;
		const r = stageEl.getBoundingClientRect();
		// 16:9 letterbox inside whatever the stage is, capped so a 4K projector
		// doesn't ask the blob shaders for four times the pixels they need.
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = Math.min(1920, Math.max(640, Math.round(r.width * dpr)));
		cw = w;
		ch = Math.round((w * 9) / 16);
	}

	// ── Playback loop ────────────────────────────────────────────────────────
	onMount(() => {
		origin = window.location.origin;
		hasStretch = supportsFontStretch();
		ctx = canvasEl.getContext('2d');
		fitCanvas();

		(async () => {
			try {
				await Promise.all([
					document.fonts.load("100 80px 'Google Sans Flex'"),
					document.fonts.load("700 80px 'Google Sans Flex'")
				]);
				await document.fonts.ready;
			} catch {}
			fontsReady = true;
		})();

		const ro = new ResizeObserver(fitCanvas);
		ro.observe(stageEl);

		let raf = 0, last = performance.now(), acc = 0;
		const loop = (t) => {
			const dt = Math.min((t - last) / 1000, 0.1);
			last = t;
			if (scene && ctx) {
				const fps = variation.fps;
				if (!fps) {
					// Genuinely time-based: run at display rate for silky motion.
					scene.step(dt);
					scene.render(ctx);
				} else {
					// Fixed-rate looks. Same sim-seconds per wall-second either
					// way, so the motion runs at the reel's speed — it's the
					// SAMPLING that differs, which is exactly what makes Garble's
					// 4fps shuffle chunky instead of fizzy (and what keeps BZ's
					// per-call sim stepping the way the studio bakes it).
					const step = 1 / fps;
					acc += dt;
					if (acc >= step) {
						// Carry the remainder rather than zeroing: a zeroed
						// accumulator makes the real cadence wander a frame either
						// way, which reads as micro-stutter.
						acc = Math.min(acc - step, step);
						scene.step(step);
						scene.render(ctx);
					}
				}
			}
			if (!paused && scene && performance.now() - sceneStart > dwellMs(variation, phrase)) {
				vIndex = (vIndex + 1) % MARQUEE_SET.length;
			}
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);

		const onFs = () => (presenting = !!document.fullscreenElement);
		document.addEventListener('fullscreenchange', onFs);

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			document.removeEventListener('fullscreenchange', onFs);
		};
	});

	// ── Firebase: claim a room, then own the clock ───────────────────────────
	let roomRef = null;
	let unsub = null;
	let beat = 0, tick = 0;

	async function ensureSignedIn() {
		if (auth.currentUser) return true;
		if (!data?.firebaseToken) return false;
		try {
			await signInWithCustomToken(auth, data.firebaseToken);
			return true;
		} catch {
			return false;
		}
	}

	async function openRoom(code) {
		if (unsub) { unsub(); unsub = null; }
		// Give up the old code before claiming the new one, or the abandoned
		// room keeps accepting posts until its heartbeat ages out.
		if (room) await remove(ref(db, `marquee/${room}/host`)).catch(() => {});
		room = code;
		try { localStorage.setItem('ec:marquee:room', code); } catch {}
		roomRef = ref(db, `marquee/${room}`);

		// Subscribe BEFORE claiming the code. A failed host write (offline, or
		// the Firebase sign-in still in flight) must not cost the screen its
		// live view of the room — it would sit on "Connecting…" forever.
		unsub = onValue(roomRef, (snap) => {
			const v = snap.val() ?? {};
			connected = true;
			now = v.now ?? null;
			if (typeof v.idle === 'string' && v.idle !== idleText) idleText = v.idle;
			// Push IDs sort chronologically — key order IS the running order.
			queue = Object.entries(v.queue ?? {})
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.map(([key, q]) => ({ key, ...q }));
		});

		// Claim the code. Until this lands the submit endpoint answers "no
		// screen is using that code", so the QR is only live once it does.
		await update(ref(db, `marquee/${room}/host`), {
			by: data?.currentUser?.id ?? null,
			name: data?.currentUser?.name ?? null,
			at: Date.now(),
			beatAt: Date.now()
		}).catch(() => {});
		if (idleText) await dbSet(ref(db, `marquee/${room}/idle`), idleText).catch(() => {});
	}

	// Identifies THIS screen in a claim, so a second screen on the same code
	// can tell whether it or the other one won the phrase.
	const hostId = Math.random().toString(36).slice(2, 10);
	let advancing = false;

	// Take the head of the queue and put it on the stage.
	async function advance() {
		if (advancing) return; // a slow write must not let the next tick double-pop
		advancing = true;
		try {
			const head = queue[0];
			if (!head) {
				if (now) await remove(ref(db, `marquee/${room}/now`)).catch(() => {});
				return;
			}
			const itemRef = ref(db, `marquee/${room}/queue/${head.key}`);

			// Stamp the claim rather than deleting inside the transaction.
			// Firebase runs the update function optimistically against the local
			// cache FIRST — which is null for an item this page has never read —
			// and returning undefined there aborts immediately without ever
			// asking the server. So `null` means "let the server re-run this",
			// and only a claim that's already someone else's aborts.
			const res = await runTransaction(itemRef, (cur) => {
				if (cur === null) return null;
				// A claim only holds for a few seconds: if a screen is closed
				// between stamping and removing, the phrase must not be stuck at
				// the head of the queue forever, blocking everything behind it.
				if (cur.claimedBy && Date.now() - Number(cur.claimedAt ?? 0) < 10_000) return;
				return { ...cur, claimedBy: hostId, claimedAt: Date.now() };
			});
			const claimed = res.snapshot.val();
			if (!res.committed || claimed?.claimedBy !== hostId) return; // another screen got it

			await remove(itemRef).catch(() => {});
			const holdMs = Number(claimed.holdMs) || 30_000;
			const startedAt = Date.now();
			await dbSet(ref(db, `marquee/${room}/now`), {
				text: String(claimed.text ?? '').slice(0, 64),
				holdMs,
				startedAt,
				endsAt: startedAt + holdMs
			});
		} finally {
			advancing = false;
		}
	}

	onMount(() => {
		(async () => {
			await ensureSignedIn();
			let saved = '';
			try { saved = localStorage.getItem('ec:marquee:room') || ''; } catch {}
			await openRoom(/^[A-Z0-9]{4}$/.test(saved) ? saved : newCode());
		})();

		// Heartbeat: the submit endpoint refuses rooms whose screen has gone
		// away, so a stale code on a photographed slide can't be posted to.
		beat = setInterval(() => {
			if (room) update(ref(db, `marquee/${room}/host`), { beatAt: Date.now() }).catch(() => {});
		}, 20_000);

		// The clock. The display owns it because the display is the thing the
		// hold is measured against.
		tick = setInterval(() => {
			const left = now?.endsAt ? now.endsAt - Date.now() : 0;
			holdLeft = Math.max(0, left);
			if (!room) return;
			if (left > 0) return;
			if (queue.length || now) advance();
		}, 500);

		return () => { clearInterval(beat); clearInterval(tick); };
	});

	onDestroy(() => {
		if (unsub) unsub();
		// Drop the host marker so the code stops accepting posts the moment the
		// screen is closed, rather than three minutes later when the beat ages out.
		if (room) remove(ref(db, `marquee/${room}/host`)).catch(() => {});
	});

	// ── Host controls ────────────────────────────────────────────────────────
	function skip() {
		if (now) remove(ref(db, `marquee/${room}/now`)).catch(() => {});
		advance();
	}
	function drop(key) {
		remove(ref(db, `marquee/${room}/queue/${key}`)).catch(() => {});
	}
	function clearQueue() {
		remove(ref(db, `marquee/${room}/queue`)).catch(() => {});
		if (now) remove(ref(db, `marquee/${room}/now`)).catch(() => {});
	}
	function rotateCode() {
		// Child-by-child: the rules grant writes on host/now/queue/idle, not on
		// the room node itself, so a remove() of the parent is denied.
		for (const k of ['now', 'queue', 'idle']) remove(ref(db, `marquee/${room}/${k}`)).catch(() => {});
		openRoom(newCode());
	}
	function saveIdle() {
		dbSet(ref(db, `marquee/${room}/idle`), idleText.trim() || 'eating.computer').catch(() => {});
	}
	async function present() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await stageEl.requestFullscreen();
		} catch {}
	}
	let copied = $state(false);
	async function copyLink() {
		try {
			await navigator.clipboard.writeText(joinUrl);
			copied = true;
			setTimeout(() => (copied = false), 1400);
		} catch {}
	}

	// QR: white-on-transparent reads badly off a projector, so keep the quiet
	// zone opaque and let the chip carry its own light background.
	const qrMarkup = $derived(joinUrl ? qrSvg(joinUrl, { dark: '#111111', light: '#ffffff' }) : '');
	const waiting = $derived(queue.length);
	const secsLeft = $derived(Math.ceil(holdLeft / 1000));
</script>

<svelte:head><title>Marquee — eating.computer</title></svelte:head>

<div class="shell">
	<main>
		<div class="page-header">
			<div>
				<h1>Marquee</h1>
				<p class="subtitle">
					The ricky.now kinetic-type set on a loop — and a QR code that lets the room write on it.
				</p>
			</div>
			<a class="back" href="/app/lab">← Lab</a>
		</div>

		<div class="stage" bind:this={stageEl} class:presenting>
			<canvas bind:this={canvasEl}></canvas>

			<!-- Idle: nothing queued, so the QR is the point of the screen. -->
			<div class="invite" class:big={!now}>
				<div class="qr">{@html qrMarkup}</div>
				<div class="invite-text">
					<span class="scan">Scan to put your words up</span>
					<span class="url">{joinUrl.replace(/^https?:\/\//, '')}</span>
					<span class="code">{room}</span>
				</div>
			</div>

			{#if now}
				<div class="ticker">
					<span class="dot"></span>
					{secsLeft}s{#if waiting} · {waiting} waiting{/if}
				</div>
			{/if}

			<button class="present" onclick={present} title="Fullscreen">
				<span class="msi">{presenting ? 'fullscreen_exit' : 'fullscreen'}</span>
			</button>
		</div>

		<div class="panel">
			<div class="col">
				<h2>Now showing</h2>
				<p class="nowtext">{phrase}</p>
				<p class="meta">
					{#if now}
						Submitted · {secsLeft}s left of {Math.round((now.holdMs ?? 30000) / 1000)}s
					{:else}
						Idle text — waiting for the room
					{/if}
					· {variation.name}
				</p>
				<div class="row">
					<button onclick={skip} disabled={!now && !queue.length}>Skip</button>
					<button onclick={() => (paused = !paused)}>{paused ? 'Resume cycling' : 'Hold this look'}</button>
					<button onclick={() => (vIndex = (vIndex + 1) % MARQUEE_SET.length)}>Next look</button>
				</div>

				<h2>Idle text</h2>
				<div class="row">
					<input bind:value={idleText} onchange={saveIdle} maxlength="42" placeholder="eating.computer" />
					<button onclick={saveIdle}>Save</button>
				</div>
			</div>

			<div class="col">
				<h2>Room</h2>
				<div class="row">
					<code class="roomcode">{room}</code>
					<button onclick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
					<button onclick={rotateCode}>New code</button>
				</div>
				<p class="meta">{connected ? 'Live' : 'Connecting…'} · {joinUrl}</p>

				<h2>Queue <span class="count">{waiting}</span></h2>
				{#if queue.length}
					<ul class="queue">
						{#each queue as q (q.key)}
							<li>
								<span class="qtext">{q.text}</span>
								<span class="qhold">{Math.round((q.holdMs ?? 30000) / 1000)}s</span>
								<button class="x" onclick={() => drop(q.key)} title="Remove">×</button>
							</li>
						{/each}
					</ul>
					<button class="clear" onclick={clearQueue}>Clear queue</button>
				{:else}
					<p class="meta empty">Nothing waiting. Scan the code to add something.</p>
				{/if}
			</div>
		</div>
	</main>
</div>

<style>
	.shell { min-height: 100dvh; background: var(--paper); }
	main {
		/* app.css gives every bare <main> `display: grid; place-items: center`
		   for the landing page — which shrink-wraps and centres every child
		   here, so the controls end up a 290px column in the middle. */
		display: block;
		min-height: 0;
		padding: 1.5rem;
		padding-top: calc(1.5rem + var(--header-h, 52px));
		max-width: 1100px;
		margin: 0 auto;
		box-sizing: border-box;
	}
	.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
	h1 { font-family: 'Avara', serif; font-size: 2rem; font-weight: 400; margin: 0 0 0.25rem; color: var(--ink); }
	.subtitle { font-size: 0.85rem; color: var(--muted-fg); margin: 0; max-width: 48ch; }
	.back { font-size: 0.8rem; color: var(--muted-fg); text-decoration: none; white-space: nowrap; }
	.back:hover { color: var(--ink); }

	.stage {
		position: relative;
		width: 100%;
		/* Keep the whole stage above the fold: at 16:9 a full-width stage on a
		   laptop pushes its own controls off-screen, and this is a tool you
		   drive while looking at it. */
		max-width: calc((100dvh - 22rem) * 16 / 9);
		margin: 0 auto;
		aspect-ratio: 16 / 9;
		border-radius: 16px;
		overflow: hidden;
		background: #000;
		border: 1.5px solid var(--border);
		/* Everything overlaid on the stage sizes in cq units off THIS box, so
		   the invite chip is the same fraction of the picture in a 900px
		   preview and on a projector. Viewport units would make it a postage
		   stamp in one and a billboard in the other. */
		container-type: size;
	}
	.stage:fullscreen {
		max-width: none;
		width: 100vw;
		height: 100vh;
		aspect-ratio: auto;
		border-radius: 0;
		border: 0;
	}
	/* contain, not fill: in fullscreen the projector's aspect rarely matches
	   the 16:9 backing store exactly, and a stretched headline is worse than
	   a letterbox. */
	canvas { display: block; width: 100%; height: 100%; object-fit: contain; }

	/* The invite chip sits bottom-left while something is playing and swells to
	   a proper panel when the screen is idle — an unscanned QR the size of a
	   postage stamp is just decoration. */
	.invite {
		position: absolute;
		left: 3cqh;
		bottom: 3cqh;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.92);
		box-shadow: 0 6px 24px -8px rgba(0, 0, 0, 0.5);
		transition: all 0.4s cubic-bezier(0.22, 1, 0.36, 1);
	}
	.invite .qr { width: 13cqh; height: 13cqh; min-width: 52px; min-height: 52px; }
	.invite.big { gap: 3cqh; padding: 2.5cqh; }
	.invite.big .qr { width: 24cqh; height: 24cqh; min-width: 92px; min-height: 92px; }
	.invite :global(svg) { display: block; width: 100%; height: 100%; border-radius: 4px; }
	.invite-text { display: flex; flex-direction: column; gap: 0.15rem; color: #111; }
	.scan { font-size: max(0.68rem, 3cqh); font-weight: 600; letter-spacing: 0.01em; }
	.invite.big .scan { font-size: max(0.8rem, 4.4cqh); }
	.url { font-size: max(0.62rem, 2.4cqh); opacity: 0.6; }
	.invite.big .url { font-size: max(0.68rem, 3cqh); }
	.code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: max(0.9rem, 4cqh);
		letter-spacing: 0.18em;
		font-weight: 700;
	}
	.invite.big .code { font-size: max(1.1rem, 7cqh); }

	.ticker {
		position: absolute;
		right: 1.25rem;
		bottom: 1.25rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.7rem;
		border-radius: 99px;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		font-size: 0.72rem;
		letter-spacing: 0.02em;
	}
	.dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; }

	.present {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		width: 34px;
		height: 34px;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.45);
		color: #fff;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.stage:hover .present { opacity: 1; }
	.present .msi { font-size: 1.1rem; }

	.panel {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1.5rem;
		margin-top: 1.25rem;
		/* Explicit, because <main> is a centring grid by default in app.css and
		   a grid ITEM shrink-wraps: without this the controls collapse to a
		   single 290px column floating in the middle of the page. */
		width: 100%;
	}
	.col { min-width: 0; }
	h2 {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted-fg);
		margin: 1.1rem 0 0.5rem;
		font-weight: 700;
	}
	.col > h2:first-child { margin-top: 0; }
	.count { color: var(--accent); }
	.nowtext { font-family: 'Avara', serif; font-size: 1.35rem; margin: 0 0 0.25rem; color: var(--ink); word-break: break-word; }
	.meta { font-size: 0.75rem; color: var(--muted-fg); margin: 0 0 0.6rem; }
	.meta.empty { font-style: italic; }
	.row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
	button {
		font: inherit;
		font-size: 0.78rem;
		padding: 0.4rem 0.75rem;
		border-radius: 99px;
		border: 1.5px solid var(--border);
		background: transparent;
		color: var(--ink);
		cursor: pointer;
	}
	button:hover:not(:disabled) { border-color: var(--accent); }
	button:disabled { opacity: 0.4; cursor: default; }
	input {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.4rem 0.7rem;
		border-radius: 10px;
		border: 1.5px solid var(--border);
		background: var(--paper);
		color: var(--ink);
		flex: 1;
		min-width: 140px;
	}
	.roomcode {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 1.1rem;
		letter-spacing: 0.2em;
		padding: 0.25rem 0.6rem;
		border-radius: 8px;
		background: color-mix(in srgb, var(--ink) 8%, transparent);
		color: var(--ink);
	}
	.queue { list-style: none; margin: 0 0 0.6rem; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
	.queue li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		padding: 0.35rem 0.5rem;
		border-radius: 8px;
		background: color-mix(in srgb, var(--ink) 5%, transparent);
		color: var(--ink);
	}
	.qtext { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.qhold { font-size: 0.7rem; color: var(--muted-fg); }
	.x { border: 0; background: none; color: var(--muted-fg); padding: 0 0.2rem; font-size: 1rem; line-height: 1; }
	.clear { font-size: 0.72rem; }
</style>
