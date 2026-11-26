<script>
	// Full-screen viewer for a guest's archived slide deck (members-only; see
	// $lib/server/archive-members.js). Each slide is a still image with its
	// videos, GIFs (as silent looping MP4s) and sounds laid over the exact
	// frames they had in Keynote or Slides, so the talk plays the way it did
	// in the room.
	//
	// Videos play in a fixed pool of <video> elements that is reused from slide
	// to slide rather than rebuilt: once Safari has let an element play with
	// sound after a tap, it keeps letting that element play, so after one "Tap
	// for sound" the rest of the deck plays with sound too.
	import { onMount, tick, untrack } from 'svelte';
	import { afterNavigate, invalidateAll, replaceState } from '$app/navigation';

	let { deck } = $props();

	let index = $state(0);
	let soundOn = $state(true);
	let blocked = $state(false); // the browser refused sound without a tap
	let playing = $state(false);
	let gridOpen = $state(false);
	let full = $state(false);
	let idle = $state(false);
	let canFull = $state(false);
	let ready = $state(false);

	let total = $derived(deck.slides.length);
	let slide = $derived(deck.slides[index]);
	let media = $derived(slide.media ?? []);
	let sound = $derived(slide.audio?.[0] ?? null);
	let poolSize = $derived(Math.max(1, ...deck.slides.map((s) => s.media?.length ?? 0)));
	const sounding = (m) => !m.silent && !m.gif;
	let hasPlayable = $derived(media.some((m) => !m.gif) || !!sound);
	let hasSound = $derived(media.some(sounding) || !!sound);
	let subtitle = $derived(`${deck.talk ?? 'Guest lecture'}, ${deck.term}`);

	let root;
	let gridEl = $state();
	const vids = []; // the pool, bound below
	let aud;
	let shown = -1; // index whose media is loaded in the pool

	// ── media ────────────────────────────────────────────────────────────
	function play(el, withSound) {
		el.muted = !withSound;
		el.play()?.catch((err) => {
			if (err?.name !== 'NotAllowedError') return;
			if (withSound) blocked = true;
			// Silent playback is always allowed; a sound clip has nothing to
			// show silently, so it waits for the tap.
			if (el.tagName === 'VIDEO' && withSound) {
				el.muted = true;
				el.play().catch(() => {});
			}
		});
	}

	function load(el, src) {
		if (el.dataset.src === src) {
			el.currentTime = 0;
			return;
		}
		el.dataset.src = src;
		el.src = src;
	}

	function unload(el) {
		if (!el?.dataset.src) return;
		el.pause();
		delete el.dataset.src;
		el.removeAttribute('src');
		el.load();
	}

	function startMedia() {
		const s = deck.slides[index];
		const list = s.media ?? [];
		const changed = shown !== index;
		shown = index;
		blocked = false;
		vids.forEach((v, i) => {
			const m = list[i];
			if (!v) return;
			if (!m?.src) return unload(v);
			if (!changed && v.dataset.src === m.src) return; // only the URLs were re-signed
			load(v, m.src);
			v.loop = !!m.loop;
			v.volume = m.volume ?? 1;
			play(v, soundOn && sounding(m));
		});
		const a = s.audio?.[0];
		if (!a?.src) unload(aud);
		else if (changed || aud.dataset.src !== a.src) {
			load(aud, a.src);
			aud.loop = !!a.loop;
			aud.volume = a.volume ?? 1;
			if (soundOn) play(aud, true);
		}
		sync();
	}

	// Which elements the play/pause and sound buttons act on.
	function controlled() {
		const els = vids.filter((v, i) => v && media[i] && !media[i].gif);
		if (sound && aud) els.push(aud);
		return els;
	}

	function sync() {
		playing = controlled().some((el) => !el.paused && !el.ended);
	}

	function togglePlay() {
		const els = controlled();
		if (playing) {
			els.forEach((el) => el.pause());
		} else {
			els.forEach((el, i) => {
				if (el.ended) el.currentTime = 0;
				const withSound = soundOn && (el === aud || sounding(media[vids.indexOf(el)]));
				if (el === aud && !soundOn) return;
				play(el, withSound);
			});
		}
	}

	// Runs inside the click, so the browser counts it as the user's tap.
	function setSound(on) {
		soundOn = on;
		blocked = false;
		vids.forEach((v, i) => {
			const m = media[i];
			if (!v || !m || !sounding(m)) return;
			v.muted = !on;
			// play() even when it's already playing: a play() inside the tap
			// is what unlocks sound on this element for later slides.
			if (on && !v.ended) play(v, true);
		});
		if (sound && aud) {
			if (on) play(aud, true);
			else aud.pause();
		}
	}

	$effect(() => {
		deck; // re-signed URLs arrive as a new deck
		index;
		untrack(startMedia);
	});

	// Have the next and previous slides ready before they're needed.
	$effect(() => {
		for (const s of [deck.slides[index + 1], deck.slides[index - 1]]) {
			if (s?.img) new Image().src = s.img;
		}
	});

	// Signed URLs last 6 to 12 hours; a page left open longer gets new ones.
	let lastRefresh = 0;
	function refresh() {
		if (Date.now() - lastRefresh < 60_000) return;
		lastRefresh = Date.now();
		invalidateAll();
	}
	const mediaError = (e) => {
		if (e.currentTarget.dataset.src) refresh();
	};

	// ── navigation ───────────────────────────────────────────────────────
	function go(n) {
		n = Math.max(0, Math.min(total - 1, n));
		gridOpen = false;
		if (n !== index) index = n;
	}
	const next = () => go(index + 1);
	const prev = () => go(index - 1);

	$effect(() => {
		const n = index + 1;
		if (!ready) return;
		untrack(() => {
			try {
				replaceState(`#${n}`, {});
			} catch {
				// router not ready yet; the next change will write it
			}
		});
	});

	function onkey(e) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target instanceof Element ? e.target : null;
		if (t?.closest('input, textarea, select, [contenteditable]')) return;
		const onControl = !!t?.closest('button, a');
		if (gridOpen) {
			if (e.key === 'Escape') {
				gridOpen = false;
				e.preventDefault();
			}
			return;
		}
		switch (e.key) {
			case 'ArrowRight':
			case 'ArrowDown':
			case 'PageDown':
			case 'n':
				next();
				break;
			case ' ':
			case 'Enter':
				if (onControl) return;
				if (e.shiftKey) prev();
				else next();
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
			case 'PageUp':
			case 'Backspace':
			case 'p':
				prev();
				break;
			case 'Home':
				go(0);
				break;
			case 'End':
				go(total - 1);
				break;
			case 'f':
				toggleFull();
				break;
			case 'g':
				openGrid();
				break;
			case 'm':
				setSound(!soundOn);
				break;
			case 'k':
				togglePlay();
				break;
			default:
				return;
		}
		e.preventDefault();
		wake();
	}

	// A tap on the left third goes back, anywhere else forward; a sideways
	// swipe turns the page. Pinch-zoom still works for small type on phones.
	let down = null;
	function pointerdown(e) {
		if (e.button === 0) down = { x: e.clientX, y: e.clientY };
	}
	function pointerup(e) {
		if (!down) return;
		const dx = e.clientX - down.x;
		const dy = e.clientY - down.y;
		down = null;
		if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) return dx < 0 ? next() : prev();
		if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
			const r = e.currentTarget.getBoundingClientRect();
			if (e.clientX - r.left < r.width / 3) prev();
			else next();
		}
	}

	async function openGrid() {
		gridOpen = true;
		await tick();
		const cur = gridEl?.querySelector('[aria-current="true"]');
		cur?.scrollIntoView({ block: 'center' });
		cur?.focus();
	}

	// ── chrome ───────────────────────────────────────────────────────────
	async function toggleFull() {
		if (!canFull) return;
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await root.requestFullscreen();
		} catch {
			// refused (e.g. not from a gesture); nothing to undo
		}
	}

	// In full screen the bars fade after a moment without the pointer moving.
	let idleTimer;
	function wake() {
		idle = false;
		clearTimeout(idleTimer);
		if (full) idleTimer = setTimeout(() => (idle = true), 2500);
	}

	let fromArchive = false;
	afterNavigate(({ from }) => {
		if (from) fromArchive = from.url.pathname === '/app/years';
	});
	function back(e) {
		if (fromArchive) {
			e.preventDefault();
			history.back(); // keeps the Archive's scroll position
		}
	}

	// "#12" opens slide 12, on load or when the address is edited.
	function fromHash(e) {
		// An edited address adds a history entry, so "back" would land on the
		// old slide: from then on the back link is a plain link to the Archive.
		if (e) fromArchive = false;
		const n = parseInt(location.hash.slice(1), 10);
		if (n >= 1 && n <= total) go(n - 1);
	}

	onMount(() => {
		fromHash();
		ready = true;
		canFull = !!(document.fullscreenEnabled && root.requestFullscreen);
		const onFull = () => {
			full = !!document.fullscreenElement;
			wake();
		};
		document.addEventListener('fullscreenchange', onFull);
		const html = document.documentElement;
		const overflow = html.style.overflow;
		html.style.overflow = 'hidden';
		return () => {
			document.removeEventListener('fullscreenchange', onFull);
			html.style.overflow = overflow;
			clearTimeout(idleTimer);
			vids.forEach(unload);
			unload(aud);
		};
	});

	const frameStyle = (m) =>
		`left:${m.x}%;top:${m.y}%;width:${m.w}%;height:${m.h}%` +
		(m.rot ? `;transform:rotate(${m.rot}deg)` : '') +
		(m.opacity != null ? `;opacity:${m.opacity}` : '');

	// crop = [left, top, right, bottom] % cut from the source, as in Slides.
	const cropStyle = ([l, t, r, b]) => {
		const w = 100 - l - r;
		const h = 100 - t - b;
		return `width:${(100 * 100) / w}%;height:${(100 * 100) / h}%;left:${(-l * 100) / w}%;top:${(-t * 100) / h}%`;
	};
</script>

<svelte:window onkeydown={onkey} onhashchange={fromHash} />

<div
	class="deck"
	class:full
	class:idle={full && idle}
	style:--aspect={deck.aspect}
	bind:this={root}
	onpointermove={wake}
	role="region"
	aria-label="{deck.person}, slides"
>
	<header class="bar top">
		<a class="back" href="/app/years" onclick={back}>
			<span class="msi" aria-hidden="true">arrow_back</span>
			<span class="back-label">Archive</span>
		</a>
		<div class="title">
			<strong>{deck.person}</strong>
			<span>{subtitle}</span>
		</div>
		{#if deck.pdf}
			<a class="tool" href={deck.pdf} target="_blank" rel="noopener noreferrer" title="Open the PDF">
				<span class="msi" aria-hidden="true">picture_as_pdf</span>
				<span class="tool-label">PDF</span>
			</a>
		{/if}
		{#if canFull}
			<button class="tool icon" onclick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen (F)' : 'Full screen (F)'}>
				<span class="msi" aria-hidden="true">{full ? 'fullscreen_exit' : 'fullscreen'}</span>
			</button>
		{/if}
	</header>

	<div class="stage">
		<!-- Tapping the slide is a shortcut; the arrow keys and the Previous
		     and Next buttons do the same for keyboards and screen readers. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="slide" onpointerdown={pointerdown} onpointerup={pointerup} onpointercancel={() => (down = null)}>
			<img class="face" src={slide.img} alt="Slide {index + 1} of {total}" draggable="false" onerror={refresh} />
			{#each { length: poolSize } as _, i}
				{@const m = media[i]}
				<div class="frame" hidden={!m} style={m ? frameStyle(m) : null}>
					<video
						bind:this={vids[i]}
						class:cropped={!!m?.crop}
						class:contain={m?.fit === 'contain'}
						style={m?.crop ? cropStyle(m.crop) : null}
						playsinline
						preload="auto"
						disablepictureinpicture
						onplay={sync}
						onpause={sync}
						onended={sync}
						onerror={mediaError}
					></video>
				</div>
			{/each}
			{#if slide.top}
				<!-- What Keynote drew above the videos (a label, an image), cut
				     out of the slide with transparency around it. -->
				<img class="above" src={slide.top} alt="" draggable="false" />
			{/if}
		</div>
		{#if blocked && soundOn && hasSound}
			<button class="unmute" onclick={() => setSound(true)}>
				<span class="msi" aria-hidden="true">volume_up</span>
				Tap for sound
			</button>
		{/if}
	</div>
	<audio bind:this={aud} preload="auto" onplay={sync} onpause={sync} onended={sync} onerror={mediaError}></audio>

	<footer class="bar bottom">
		<button class="tool icon" onclick={prev} disabled={index === 0} aria-label="Previous slide" title="Previous (←)">
			<span class="msi" aria-hidden="true">chevron_left</span>
		</button>
		<span class="count" aria-live="polite">{index + 1} <span class="of">/ {total}</span></span>
		<input
			class="scrub"
			type="range"
			min="1"
			max={total}
			value={index + 1}
			oninput={(e) => go(e.currentTarget.valueAsNumber - 1)}
			aria-label="Slide"
			style:--p="{total > 1 ? (index / (total - 1)) * 100 : 100}%"
		/>
		{#if hasPlayable}
			<button class="tool icon" onclick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (K)' : 'Play (K)'}>
				<span class="msi" aria-hidden="true">{playing ? 'pause' : 'play_arrow'}</span>
			</button>
		{/if}
		{#if hasSound}
			<button class="tool icon" onclick={() => setSound(!soundOn)} aria-label={soundOn ? 'Mute' : 'Unmute'} aria-pressed={!soundOn} title={soundOn ? 'Mute (M)' : 'Unmute (M)'}>
				<span class="msi" aria-hidden="true">{soundOn && !blocked ? 'volume_up' : 'volume_off'}</span>
			</button>
		{/if}
		<button class="tool icon" onclick={openGrid} aria-label="All slides" title="All slides (G)">
			<span class="msi" aria-hidden="true">grid_view</span>
		</button>
		<button class="tool icon" onclick={next} disabled={index === total - 1} aria-label="Next slide" title="Next (→)">
			<span class="msi" aria-hidden="true">chevron_right</span>
		</button>
	</footer>

	{#if gridOpen}
		<div class="grid" role="dialog" aria-modal="true" aria-label="All slides">
			<div class="grid-head">
				<strong>{total} slides</strong>
				<button class="tool icon" onclick={() => (gridOpen = false)} aria-label="Close" title="Close (Esc)">
					<span class="msi" aria-hidden="true">close</span>
				</button>
			</div>
			<ol class="thumbs" bind:this={gridEl}>
				{#each deck.slides as s, i}
					<li>
						<button onclick={() => go(i)} aria-current={i === index ? 'true' : undefined} aria-label="Slide {i + 1}">
							<img src={s.thumb} alt="" loading="lazy" draggable="false" />
							<span>{i + 1}</span>
						</button>
					</li>
				{/each}
			</ol>
		</div>
	{/if}
</div>

<style>
	.deck {
		/* A projector room: the stage is black in every theme so each slide's
		   edge reads, so the chrome is fixed light text (the theme's inverse
		   colors flip in dark mode) with the theme's accent. */
		--fg: #f5f5f4;
		--dim: color-mix(in srgb, var(--fg) 62%, transparent);
		--line: color-mix(in srgb, var(--fg) 16%, transparent);
		--hover: color-mix(in srgb, var(--fg) 10%, transparent);
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		background: #000;
		color: var(--fg);
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
		font-variant-numeric: tabular-nums;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 8px;
		min-height: 52px;
		transition: opacity 0.25s;
	}
	.full .bar {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 2;
	}
	.full .top {
		top: 0;
		padding-top: max(6px, env(safe-area-inset-top));
		background: linear-gradient(rgb(0 0 0 / 0.7), transparent);
	}
	.full .bottom {
		bottom: 0;
		padding-bottom: max(6px, env(safe-area-inset-bottom));
		background: linear-gradient(transparent, rgb(0 0 0 / 0.7));
	}
	.idle .bar {
		opacity: 0;
		pointer-events: none;
	}
	.idle {
		cursor: none;
	}

	.back,
	.tool {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 40px;
		padding: 0 12px;
		border: 0;
		border-radius: 20px;
		background: none;
		color: var(--fg);
		font: inherit;
		font-size: 0.875rem;
		text-decoration: none;
		cursor: pointer;
		flex: none;
	}
	.tool.icon {
		width: 40px;
		padding: 0;
		justify-content: center;
	}
	.back:hover,
	.tool:hover:not(:disabled) {
		background: var(--hover);
	}
	.tool:disabled {
		color: var(--line);
		cursor: default;
	}
	.msi {
		font-size: 22px;
	}

	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.25;
		padding: 0 8px;
	}
	.title strong {
		font-weight: 600;
		font-size: 0.95rem;
	}
	.title span {
		color: var(--dim);
		font-size: 0.8rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.stage {
		flex: 1;
		min-height: 0;
		position: relative;
		display: grid;
		place-items: center;
		container-type: size;
	}
	.slide {
		position: relative;
		width: min(100cqw, calc(100cqh * var(--aspect)));
		aspect-ratio: var(--aspect);
		overflow: hidden;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		touch-action: pinch-zoom;
		cursor: pointer;
	}
	.face {
		display: block;
		width: 100%;
		height: 100%;
	}
	.above {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.frame {
		position: absolute;
		overflow: hidden;
		pointer-events: none;
	}
	.frame[hidden] {
		display: none;
	}
	.frame video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	/* Slides letterboxes a video inside its frame. */
	.frame video.contain {
		object-fit: contain;
		background: #000;
	}
	.frame video.cropped {
		position: absolute;
		max-width: none;
		object-fit: fill;
	}

	.unmute {
		position: absolute;
		left: 50%;
		bottom: 16px;
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 44px;
		padding: 0 18px 0 14px;
		border: 0;
		border-radius: 22px;
		background: var(--accent);
		color: var(--md-sys-color-on-primary, #fff);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		z-index: 3;
	}

	.count {
		padding: 0 8px 0 4px;
		font-size: 0.9rem;
		flex: none;
	}
	.of {
		color: var(--dim);
	}
	.scrub {
		flex: 1;
		min-width: 40px;
		height: 40px;
		margin: 0 8px;
		background: transparent;
		appearance: none;
		-webkit-appearance: none;
		cursor: pointer;
	}
	.scrub::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(to right, var(--accent) var(--p), var(--line) var(--p));
	}
	.scrub::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(to right, var(--accent) var(--p), var(--line) var(--p));
	}
	.scrub::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		margin-top: -5px;
		border-radius: 50%;
		background: var(--fg);
		border: 0;
	}
	.scrub::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--fg);
		border: 0;
	}

	.grid {
		position: absolute;
		inset: 0;
		z-index: 4;
		display: flex;
		flex-direction: column;
		background: rgb(0 0 0 / 0.94);
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
	}
	.grid-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 8px 6px 16px;
		min-height: 52px;
	}
	.thumbs {
		flex: 1;
		overflow-y: auto;
		margin: 0;
		padding: 8px 16px 24px;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 16px 12px;
		align-content: start;
	}
	.thumbs button {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: 0.8rem;
		text-align: left;
		cursor: pointer;
	}
	.thumbs img {
		display: block;
		width: 100%;
		aspect-ratio: var(--aspect);
		object-fit: cover;
		border-radius: 4px;
		background: #1a1a1a;
		outline: 1px solid var(--line);
	}
	.thumbs button:hover img {
		outline-color: var(--dim);
	}
	.thumbs button[aria-current='true'] {
		color: var(--fg);
	}
	.thumbs button[aria-current='true'] img {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.deck :focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	@media (max-width: 560px) {
		.back-label,
		.tool-label {
			display: none;
		}
		.back {
			width: 40px;
			padding: 0;
			justify-content: center;
		}
		.scrub {
			margin: 0 2px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bar {
			transition: none;
		}
	}
</style>
