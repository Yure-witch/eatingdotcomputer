<script>
	import { tick } from 'svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import ExpressionPicker from '$lib/components/ExpressionPicker.svelte';
	import { createContentRenderer } from '$lib/message-render.js';
	import { mountStaticEmotes } from '$lib/emote-mount.js';
	import { popoverPos } from '$lib/popover-pos.js';
	import { GRADIENTS, FONTS, EFFECTS, sanitizeStyle } from '$lib/profile-style.js';

	let { data } = $props();
	const { profile, isOwnProfile, currentUserId } = data;
	const { contentHtml } = createContentRenderer();

	// The live style. Starts from what the server loaded; the owner's
	// customizer mutates it in place (instant preview) and autosaves.
	let style = $state(sanitizeStyle(profile.style));

	const gradient = $derived(GRADIENTS.find(g => g.id === style.bg) ?? GRADIENTS[0]);
	const nameFont = $derived(FONTS.find(f => f.id === style.font) ?? FONTS[0]);

	// Mount static-frame emotes after the bio renders so TG / TGC
	// tokens animate / show frames instead of empty spans.
	let bioEl = $state(null);
	$effect(() => {
		if (!bioEl) return;
		void profile.bio;
		tick().then(() => mountStaticEmotes(bioEl));
	});

	// Signature expression — same mounting dance, re-run when it changes.
	let sigEl = $state(null);
	$effect(() => {
		if (!sigEl) return;
		void style.sig;
		tick().then(() => sigEl && mountStaticEmotes(sigEl));
	});
	// Small preview of the sig inside the customizer panel.
	let sigPreviewEl = $state(null);
	$effect(() => {
		if (!sigPreviewEl) return;
		void style.sig;
		tick().then(() => sigPreviewEl && mountStaticEmotes(sigPreviewEl));
	});

	// ---- Custom HTML page ("MySpace mode") ----
	// The owner can author a full HTML document — their own CSS and JS —
	// that replaces the standard profile card for every visitor. It only
	// ever renders inside a sandboxed iframe WITHOUT allow-same-origin,
	// so the document gets an opaque origin: no cookies, no session, no
	// fetch into the app's APIs, no reach into the parent DOM. Scripts
	// run free inside their own little world, which is exactly the deal.
	let customHtml = $state(profile.customHtml ?? null);
	let htmlEditorOpen = $state(false);
	let htmlDraft = $state('');
	let htmlSaveStatus = $state('');
	let confirmRemoveHtml = $state(false);

	function escapeHtml(s) {
		return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function starterTemplate() {
		const name = escapeHtml(profile.name || 'me');
		const bio = escapeHtml(profile.bio || 'welcome to my corner of the internet');
		const grad = gradient.css || 'linear-gradient(135deg, #ff71ce, #01cdfe)';
		return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* Anything goes in here. This page is yours. */
  body {
    margin: 0;
    min-height: 100vh;
    font-family: 'Comic Sans MS', cursive;
    background: ${grad};
    background-size: 300% 300%;
    animation: drift 12s ease-in-out infinite;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #fff;
    text-shadow: 0 2px 8px rgba(0,0,0,0.4);
    overflow-x: hidden;
  }
  @keyframes drift { 0%,100% { background-position: 0% 0%; } 50% { background-position: 100% 100%; } }
  h1 { font-size: 3rem; margin: 0.5rem; transform: rotate(-3deg); }
  .bio { max-width: 420px; text-align: center; font-size: 1.1rem; }
  marquee { width: 100%; font-size: 1.4rem; margin-top: 2rem; }
  .spark { position: fixed; pointer-events: none; animation: pop 0.8s ease-out forwards; }
  @keyframes pop { to { transform: translateY(-40px) scale(0.2); opacity: 0; } }
</style>
</head>
<body>
  <h1>${name}</h1>
  <p class="bio">${bio}</p>
  <marquee>★ thanks for stopping by ★ sign my guestbook ★ best viewed in Netscape Navigator ★</marquee>
  <script>
    // Scripts work too — this one leaves a sparkle trail.
    addEventListener('pointermove', (e) => {
      const s = document.createElement('div');
      s.className = 'spark';
      s.textContent = '✦';
      s.style.left = e.clientX + 'px';
      s.style.top = e.clientY + 'px';
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 800);
    });
  <\/script>
</body>
</html>`;
	}

	function openHtmlEditor() {
		htmlDraft = customHtml ?? starterTemplate();
		htmlEditorOpen = true;
	}

	// Debounced copy of the draft for the preview iframe — srcdoc swaps
	// reload the whole frame, so retyping shouldn't thrash it per key.
	let previewHtml = $state('');
	$effect(() => {
		const v = htmlDraft;
		if (!htmlEditorOpen) return;
		const t = setTimeout(() => (previewHtml = v), 400);
		return () => clearTimeout(t);
	});

	async function saveHtml() {
		htmlSaveStatus = 'publishing…';
		try {
			const r = await fetch('/api/profile-style', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ html: htmlDraft })
			});
			if (r.ok) {
				customHtml = htmlDraft.trim() || null;
				htmlEditorOpen = false;
				customizing = false;
				htmlSaveStatus = '';
			} else {
				const j = await r.json().catch(() => ({}));
				htmlSaveStatus = j?.message || 'failed to save';
			}
		} catch { htmlSaveStatus = 'failed to save'; }
	}

	async function removeHtml() {
		if (!confirmRemoveHtml) { confirmRemoveHtml = true; return; }
		confirmRemoveHtml = false;
		try {
			const r = await fetch('/api/profile-style', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ html: null })
			});
			if (r.ok) customHtml = null;
		} catch { /* leave as-is */ }
	}

	// Tab inserts a real tab in the HTML editor instead of leaving the field.
	function editorKeydown(e) {
		if (e.key !== 'Tab') return;
		e.preventDefault();
		const t = e.currentTarget;
		const { selectionStart: s, selectionEnd: en } = t;
		htmlDraft = htmlDraft.slice(0, s) + '\t' + htmlDraft.slice(en);
		tick().then(() => { t.selectionStart = t.selectionEnd = s + 1; });
	}

	// ---- Customizer (own profile only) ----
	let customizing = $state(false);
	// Owner toggling the customizer drops back to the standard card view
	// so the preset controls stay reachable while a custom page is live.
	const showCustomPage = $derived(!!customHtml && !(isOwnProfile && customizing));
	let showSigPicker = $state(false);
	let sigBtnEl = $state(null);
	let saveStatus = $state('');
	let saveTimer = null;

	function scheduleSave() {
		saveStatus = 'saving…';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			try {
				const r = await fetch('/api/profile-style', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ style: $state.snapshot(style) })
				});
				saveStatus = r.ok ? 'saved ✓' : 'failed to save';
			} catch { saveStatus = 'failed to save'; }
			setTimeout(() => (saveStatus = ''), 2000);
		}, 500);
	}

	function setBg(id)   { style.bg = id;   scheduleSave(); }
	function setFont(id) { style.font = id; scheduleSave(); }
	function setFx(id)   { style.fx = id;   scheduleSave(); }
	function setSig(token) {
		style.sig = token ?? '';
		showSigPicker = false;
		scheduleSave();
	}

	// ExpressionPicker → token mapping, same shapes AvatarPicker uses.
	function onSigEmoji(emoji)       { setSig(emoji); }
	function onSigKitchen(token)     { setSig(token); }
	function onSigCustomEmoji(emoji) { setSig(`[ce:${emoji.shortcode}]`); }
	function onSigTgEmoji(it) {
		if (!it) return;
		if (it.custom) {
			if (it.mode === 'emoji') setSig(it.alt || '');
			else setSig(`[tgc:${it.short}:${it.id}]`);
		} else {
			setSig(`[tg:${it.cp}]`);
		}
	}

	// ---- Mouse effect: one canvas, particle behaviors per effect id ----
	let fxCanvas = $state(null);
	$effect(() => {
		const canvas = fxCanvas;
		const fx = style.fx;
		if (!canvas || fx === 'none') return;

		const ctx = canvas.getContext('2d');
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		let w = 0, h = 0;
		function resize() {
			w = window.innerWidth; h = window.innerHeight;
			canvas.width = w * dpr; canvas.height = h * dpr;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		resize();

		const particles = [];
		let hue = 0;
		let lastSpawn = 0;

		const GLYPHS = {
			sparkles: ['✨', '⭐', '✦'],
			hearts: ['💗', '💖', '💕'],
			bubbles: ['🫧']
		};

		function spawn(x, y) {
			const now = performance.now();
			if (now - lastSpawn < 28) return; // throttle spawn rate
			lastSpawn = now;
			if (particles.length > 140) return;

			if (fx === 'confetti') {
				for (let i = 0; i < 3; i++) {
					particles.push({
						x, y,
						vx: (Math.random() - 0.5) * 3.2,
						vy: -Math.random() * 2 - 0.5,
						rot: Math.random() * Math.PI * 2,
						vr: (Math.random() - 0.5) * 0.3,
						life: 1,
						decay: 0.012 + Math.random() * 0.01,
						size: 5 + Math.random() * 5,
						color: `hsl(${Math.floor(Math.random() * 360)}, 90%, 60%)`
					});
				}
			} else if (fx === 'trail') {
				hue = (hue + 6) % 360;
				particles.push({
					x, y, vx: 0, vy: 0, rot: 0, vr: 0,
					life: 1, decay: 0.03,
					size: 10 + Math.random() * 8,
					color: `hsl(${hue}, 100%, 60%)`
				});
			} else {
				const glyphs = GLYPHS[fx] ?? GLYPHS.sparkles;
				particles.push({
					x: x + (Math.random() - 0.5) * 16,
					y: y + (Math.random() - 0.5) * 16,
					vx: (Math.random() - 0.5) * 0.8,
					vy: fx === 'bubbles' ? -1 - Math.random() : -0.4 - Math.random() * 0.8,
					rot: (Math.random() - 0.5) * 0.6,
					vr: (Math.random() - 0.5) * 0.04,
					life: 1,
					decay: 0.011 + Math.random() * 0.008,
					size: 12 + Math.random() * 10,
					glyph: glyphs[Math.floor(Math.random() * glyphs.length)],
					sway: Math.random() * Math.PI * 2
				});
			}
		}

		function onMove(e) { spawn(e.clientX, e.clientY); }
		window.addEventListener('pointermove', onMove, { passive: true });
		window.addEventListener('resize', resize);

		let raf;
		function frame() {
			ctx.clearRect(0, 0, w, h);
			for (let i = particles.length - 1; i >= 0; i--) {
				const p = particles[i];
				p.life -= p.decay;
				if (p.life <= 0) { particles.splice(i, 1); continue; }
				p.x += p.vx; p.y += p.vy; p.rot += p.vr;
				if (fx === 'confetti') p.vy += 0.08; // gravity
				if (p.sway !== undefined) { p.sway += 0.06; p.x += Math.sin(p.sway) * 0.5; }

				ctx.save();
				ctx.globalAlpha = Math.min(1, p.life * 1.4);
				ctx.translate(p.x, p.y);
				ctx.rotate(p.rot);
				if (fx === 'confetti') {
					ctx.fillStyle = p.color;
					ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
				} else if (fx === 'trail') {
					const r = p.size * p.life;
					const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
					grad.addColorStop(0, p.color);
					grad.addColorStop(1, 'transparent');
					ctx.globalCompositeOperation = 'lighter';
					ctx.fillStyle = grad;
					ctx.beginPath();
					ctx.arc(0, 0, r, 0, Math.PI * 2);
					ctx.fill();
				} else {
					const s = p.size * (0.6 + p.life * 0.4);
					ctx.font = `${s}px sans-serif`;
					ctx.textAlign = 'center';
					ctx.textBaseline = 'middle';
					ctx.fillText(p.glyph, 0, 0);
				}
				ctx.restore();
			}
			raf = requestAnimationFrame(frame);
		}
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('resize', resize);
			ctx.clearRect(0, 0, w, h);
		};
	});

	function formatJoined(str) {
		if (!str) return '';
		return new Date(str).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	}

	function formatLastSeen(ts) {
		if (!ts) return 'never';
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'just now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<svelte:head><title>{profile.name || 'Profile'} — eating.computer</title></svelte:head>

<div class="shell" class:vibed={gradient.css && !showCustomPage} class:takeover={showCustomPage}>
	{#if gradient.css && !showCustomPage}
		<div class="bg-gradient" style="background-image: {gradient.css}"></div>
	{/if}
	{#if style.fx !== 'none' && !showCustomPage}
		<canvas class="fx-canvas" bind:this={fxCanvas}></canvas>
	{/if}

	<!-- No in-flow header: the layout's fixed AppHeader covers /app pages;
	     content pads below it by the measured --header-h. -->
	{#if showCustomPage}
		<!-- MySpace mode: the owner's own HTML document replaces the whole
		     profile. sandbox WITHOUT allow-same-origin gives it an opaque
		     origin — scripts run, but with no cookies, no session, and no
		     access to the app. Do not add allow-same-origin here. -->
		<div class="custom-bar">
			<a class="back-inline" href="/app">← Back</a>
			<span class="custom-note">{profile.name || 'This user'}'s custom page</span>
			<span class="custom-actions">
				{#if isOwnProfile}
					<button class="btn-secondary sm" onclick={() => (customizing = true)}>✨ Customize</button>
				{:else}
					<a class="btn-primary sm" href="/app/chat/dm/{[currentUserId, profile.id].sort().join('-')}">Message</a>
				{/if}
			</span>
		</div>
		<iframe
			class="custom-frame"
			title="{profile.name || 'User'}'s profile page"
			sandbox="allow-scripts allow-popups allow-modals"
			srcdoc={customHtml}
		></iframe>
	{:else}
	<main>
		<a class="back" href="/app">← Back</a>

		<div class="profile-card" class:glassy={gradient.css}>
			<div class="profile-top">
				<Avatar
					name={profile.name ?? ''}
					uid={profile.id}
					avatarKind={profile.avatarKind ?? 'gen'}
					avatarValue={profile.avatarValue ?? null}
					size={84}
				/>
				<div class="profile-meta">
					<div class="name-row">
						<h1 style:font-family={nameFont.css}>{profile.name || 'Unnamed'}</h1>
						{#if style.sig}
							<span class="sig" bind:this={sigEl}>{@html contentHtml(style.sig, false)}</span>
						{/if}
					</div>
					<div class="name-sub">
						{#if profile.pronouns}
							<span class="pronouns">{profile.pronouns}</span>
						{/if}
						<span class="role-pill" class:instructor={profile.role === 'instructor'}>{profile.role}</span>
					</div>
					<div class="status-row">
						{#if profile.online}
							<span class="status-online">● online</span>
						{:else}
							<span class="status-offline">○ last seen {formatLastSeen(profile.lastSeen)}</span>
						{/if}
						{#if profile.joinedAt}
							<span class="joined">Joined {formatJoined(profile.joinedAt)}</span>
						{/if}
					</div>
				</div>
				<div class="profile-actions">
					{#if isOwnProfile}
						<button class="btn-secondary" class:active={customizing} onclick={() => (customizing = !customizing)}>
							✨ Customize
						</button>
						<a class="btn-secondary" href="/app/profile/edit">Edit profile</a>
					{:else}
						<a class="btn-primary" href="/app/chat/dm/{[currentUserId, profile.id].sort().join('-')}">Message</a>
					{/if}
				</div>
			</div>

			{#if isOwnProfile && customizing}
				<div class="customizer">
					<div class="cz-head">
						<h2>Make it yours</h2>
						{#if saveStatus}<span class="cz-status">{saveStatus}</span>{/if}
					</div>

					<div class="cz-group">
						<span class="cz-label">Background</span>
						<div class="cz-row">
							{#each GRADIENTS as g}
								<button
									class="swatch"
									class:selected={style.bg === g.id}
									style:background-image={g.css}
									title={g.label}
									aria-label={g.label}
									onclick={() => setBg(g.id)}
								>{#if !g.css}∅{/if}</button>
							{/each}
						</div>
					</div>

					<div class="cz-group">
						<span class="cz-label">Name font</span>
						<div class="cz-row">
							{#each FONTS as f}
								<button
									class="chip"
									class:selected={style.font === f.id}
									style:font-family={f.css}
									onclick={() => setFont(f.id)}
								>{f.label}</button>
							{/each}
						</div>
					</div>

					<div class="cz-group">
						<span class="cz-label">Mouse effect</span>
						<div class="cz-row">
							{#each EFFECTS as e}
								<button
									class="chip"
									class:selected={style.fx === e.id}
									onclick={() => setFx(e.id)}
								>{e.emoji} {e.label}</button>
							{/each}
						</div>
					</div>

					<div class="cz-group">
						<span class="cz-label">Custom page — MySpace mode</span>
						<div class="cz-row">
							{#if customHtml}
								<button class="chip" onclick={openHtmlEditor}>Edit HTML</button>
								<button class="chip danger" onclick={removeHtml} onmouseleave={() => (confirmRemoveHtml = false)}>
									{confirmRemoveHtml ? 'Really remove?' : 'Remove'}
								</button>
							{:else}
								<button class="chip" onclick={openHtmlEditor}>Build your own page →</button>
							{/if}
						</div>
						<p class="cz-hint">
							{#if customHtml}
								Your custom page is live — visitors see it instead of the standard profile. The presets above only apply if you remove it.
							{:else}
								Write a whole page in HTML/CSS/JS. It replaces your profile entirely — any style, any script.
							{/if}
						</p>
					</div>

					<div class="cz-group">
						<span class="cz-label">Signature expression</span>
						<div class="cz-row">
							{#if style.sig}
								<span class="sig-preview" bind:this={sigPreviewEl}>{@html contentHtml(style.sig, false)}</span>
							{/if}
							<button bind:this={sigBtnEl} class="chip" onclick={() => (showSigPicker = !showSigPicker)}>
								{style.sig ? 'Change' : 'Pick one'}
							</button>
							{#if style.sig}
								<button class="chip" onclick={() => setSig('')}>Clear</button>
							{/if}
						</div>
						<p class="cz-hint">An emoji or emote that floats next to your name. Animated ones animate.</p>
					</div>

					{#if showSigPicker}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="sig-backdrop" onclick={() => (showSigPicker = false)}></div>
						<div class="sig-popover" use:popoverPos={{ anchor: sigBtnEl, side: 'bottom' }}>
							<ExpressionPicker
								inline={true}
								onSelectEmoji={onSigEmoji}
								onInsertKitchen={onSigKitchen}
								onInsertCustomEmoji={onSigCustomEmoji}
								onInsertTgEmoji={onSigTgEmoji}
							/>
						</div>
					{/if}
				</div>
			{/if}

			{#if profile.bio}
				<div class="section">
					<h2>About</h2>
					<p class="bio" bind:this={bioEl}>{@html contentHtml(profile.bio, false)}</p>
				</div>
			{/if}

			<!-- Study details: year + school + focus. Rendered together
			     as a key/value list whenever any of the three is set so
			     the layout stays cohesive even with partial info. -->
			{#if profile.year || profile.school || profile.focus}
				<div class="section">
					<h2>Studies</h2>
					<dl class="detail-list">
						{#if profile.year}
							<div class="detail-row">
								<dt>Year</dt>
								<dd>{profile.year}</dd>
							</div>
						{/if}
						{#if profile.school}
							<div class="detail-row">
								<dt>School</dt>
								<dd>{profile.school}</dd>
							</div>
						{/if}
						{#if profile.focus}
							<div class="detail-row">
								<dt>Focus</dt>
								<dd>{profile.focus}</dd>
							</div>
						{/if}
					</dl>
				</div>
			{/if}

			{#if profile.website}
				<div class="section">
					<h2>Website</h2>
					<a class="website-link" href={profile.website} target="_blank" rel="noopener noreferrer">{profile.website.replace(/^https?:\/\//, '')}</a>
				</div>
			{/if}

			{#if !profile.bio && !profile.website && !profile.year && !profile.school && !profile.focus && !isOwnProfile}
				<p class="empty">This person hasn't filled out their profile yet.</p>
			{/if}

			{#if isOwnProfile && !profile.bio && !profile.website && !profile.year && !profile.school && !profile.focus}
				<div class="empty-own">
					<p>Your profile is pretty bare. <a href="/app/profile/edit">Add a bio, school, and more →</a> — or hit ✨ Customize to give it a vibe.</p>
				</div>
			{/if}
		</div>
	</main>
	{/if}
</div>

{#if isOwnProfile && htmlEditorOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="he-backdrop" onclick={() => (htmlEditorOpen = false)}></div>
	<div class="he-modal">
		<div class="he-head">
			<h2>Your page, your rules</h2>
			<span class="he-meta">
				{#if htmlSaveStatus}<span class="he-status">{htmlSaveStatus}</span>{/if}
				<span class="he-chars">{(htmlDraft.length / 1000).toFixed(1)}k / 100k</span>
			</span>
		</div>
		<div class="he-body">
			<textarea
				class="he-editor"
				bind:value={htmlDraft}
				spellcheck="false"
				autocapitalize="off"
				autocomplete="off"
				onkeydown={editorKeydown}
			></textarea>
			<!-- Live preview — same sandbox as the real thing. -->
			<iframe class="he-preview" title="Preview" sandbox="allow-scripts allow-modals" srcdoc={previewHtml}></iframe>
		</div>
		<div class="he-actions">
			<span class="he-hint">Runs in a sandbox — your scripts can't see the app, cookies, or other people's sessions.</span>
			<button class="btn-ghost" onclick={() => (htmlEditorOpen = false)}>Cancel</button>
			<button class="btn-primary" onclick={saveHtml}>Save &amp; publish</button>
		</div>
	</div>
{/if}

<style>
	@font-face {
		font-family: 'Cambridge';
		src: url('/fonts/Cambridge.otf') format('opentype');
		font-display: swap;
	}

	.shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--paper);
		position: relative;
	}

	/* Full-bleed animated gradient backdrop. background-size 300% +
	   a slow position drift gives the "alive" MySpace-y feel without
	   any JS. */
	.bg-gradient {
		position: fixed;
		inset: 0;
		z-index: 0;
		background-size: 300% 300%;
		animation: bg-drift 16s ease-in-out infinite;
	}
	@keyframes bg-drift {
		0%   { background-position: 0% 0%; }
		50%  { background-position: 100% 100%; }
		100% { background-position: 0% 0%; }
	}

	/* Canvas is a replaced element — inset: 0 alone doesn't stretch it,
	   it renders at its intrinsic (DPR-scaled) buffer size, which offset
	   every particle from the real cursor position on retina displays.
	   Explicit width/height pin the CSS box to the viewport. */
	.fx-canvas {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		z-index: 50;
		pointer-events: none;
	}

	main {
		padding: calc(1.5rem + var(--header-h, 52px)) 2rem 2rem;
		max-width: 640px;
		width: 100%;
		margin: 0 auto;
		position: relative;
		z-index: 1;
	}

	.back {
		display: inline-block;
		font-size: 0.85rem;
		color: var(--muted-fg);
		text-decoration: none;
		margin-bottom: 1.5rem;
	}
	.vibed .back {
		color: var(--ink);
		text-shadow: 0 1px 8px color-mix(in srgb, var(--paper) 60%, transparent);
	}
	.back:hover { color: var(--ink); }

	.profile-card {
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 16px;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	/* Over a gradient the card goes translucent + blurred so the vibe
	   shows through but the text stays on brand-color ink. */
	.profile-card.glassy {
		background: color-mix(in srgb, var(--paper) 80%, transparent);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		border-color: color-mix(in srgb, var(--border) 55%, transparent);
		box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
	}

	.profile-top {
		display: flex;
		align-items: flex-start;
		gap: 1.25rem;
		flex-wrap: wrap;
	}

	.profile-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.name-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	h1 {
		font-size: 1.75rem;
		font-weight: 400;
		margin: 0;
		color: var(--ink);
		line-height: 1.15;
	}

	/* Signature expression: emotes inside size at 1.4em of the wrapper,
	   so the big font-size here is what makes it big. Gentle bob. */
	.sig {
		font-size: 2.4rem;
		line-height: 1;
		display: inline-block;
		animation: sig-bob 2.6s ease-in-out infinite;
	}
	@keyframes sig-bob {
		0%, 100% { transform: translateY(0) rotate(-4deg); }
		50%      { transform: translateY(-5px) rotate(4deg); }
	}

	.name-sub {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.pronouns {
		font-size: 0.85rem;
		color: var(--muted-fg);
	}

	.role-pill {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--surface-2);
		color: var(--muted-fg);
		padding: 0.15rem 0.5rem;
		border-radius: 99px;
	}
	.role-pill.instructor { background: var(--ink); color: var(--paper); }

	.status-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.82rem;
		flex-wrap: wrap;
	}

	.status-online { color: #2e7d32; font-weight: 600; }
	.status-offline { color: #bbb; }
	.joined { color: var(--muted-fg); }

	.profile-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
		flex-wrap: wrap;
	}

	.btn-primary {
		padding: 0.5rem 1.1rem;
		background: var(--ink);
		color: var(--paper);
		border: none;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		display: inline-block;
		transition: opacity 0.15s;
	}
	.btn-primary:hover { opacity: 0.8; }

	.btn-secondary {
		padding: 0.5rem 1.1rem;
		background: none;
		color: var(--ink);
		border: 1.5px solid var(--border);
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		display: inline-block;
		transition: border-color 0.15s;
	}
	.btn-secondary:hover { border-color: var(--ink); }
	.btn-secondary.active { border-color: var(--ink); background: var(--surface-2); }

	/* ---- Customizer panel ---- */
	.customizer {
		border: 1.5px dashed var(--border);
		border-radius: 12px;
		padding: 1rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		position: relative;
	}
	.cz-head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	.cz-head h2 {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
		margin: 0;
	}
	.cz-status { font-size: 0.72rem; color: var(--muted-fg); }

	.cz-group { display: flex; flex-direction: column; gap: 0.4rem; }
	.cz-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--ink);
	}
	.cz-row {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.cz-hint {
		font-size: 0.72rem;
		color: var(--muted-fg);
		margin: 0;
	}

	.swatch {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 2px solid var(--border);
		background: var(--surface-2);
		background-size: cover;
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--muted-fg);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		transition: transform 0.12s, border-color 0.12s;
	}
	.swatch:hover { transform: scale(1.12); }
	.swatch.selected {
		border-color: var(--ink);
		box-shadow: 0 0 0 2px var(--paper), 0 0 0 4px var(--ink);
	}

	.chip {
		padding: 0.35rem 0.75rem;
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 500;
		background: var(--paper);
		color: var(--ink);
		border: 1.5px solid var(--border);
		border-radius: 999px;
		cursor: pointer;
		transition: border-color 0.12s, background 0.12s;
	}
	.chip:hover { border-color: var(--ink); }
	.chip.selected {
		background: var(--ink);
		color: var(--paper);
		border-color: var(--ink);
	}

	.sig-preview {
		font-size: 1.6rem;
		line-height: 1;
		display: inline-block;
	}

	.sig-backdrop {
		position: fixed; inset: 0; background: transparent; z-index: 998;
	}
	.sig-popover {
		z-index: 999;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
		border-radius: 12px;
		overflow: hidden;
	}

	/* ---- Custom page (MySpace mode) ---- */
	/* Takeover: the shell pins to the viewport and the iframe eats all
	   remaining height under the header + slim bar. */
	.shell.takeover {
		height: 100dvh;
		overflow: hidden;
		/* Custom page sits below the fixed global header. */
		padding-top: var(--header-h, 52px);
		box-sizing: border-box;
	}
	.custom-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.4rem 2rem;
		border-bottom: 1.5px solid var(--border);
		font-size: 0.8rem;
		position: relative;
		z-index: 1;
	}
	.back-inline {
		color: var(--muted-fg);
		text-decoration: none;
		flex-shrink: 0;
	}
	.back-inline:hover { color: var(--ink); }
	.custom-note {
		color: var(--muted-fg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.custom-actions {
		margin-left: auto;
		display: flex;
		gap: 0.4rem;
		flex-shrink: 0;
	}
	.btn-primary.sm, .btn-secondary.sm {
		padding: 0.3rem 0.75rem;
		font-size: 0.78rem;
	}
	.custom-frame {
		flex: 1;
		width: 100%;
		border: 0;
		display: block;
		background: #fff;
	}

	.chip.danger:hover {
		border-color: #e53935;
		color: #e53935;
	}

	/* ---- HTML editor modal ---- */
	.he-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		z-index: 1000;
	}
	.he-modal {
		position: fixed;
		inset: 1.25rem;
		z-index: 1001;
		background: var(--paper);
		border: 1.5px solid var(--border);
		border-radius: 16px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
	}
	.he-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem 0.75rem;
	}
	.he-head h2 {
		font-family: 'Avara', serif;
		font-size: 1.15rem;
		font-weight: 400;
		margin: 0;
		color: var(--ink);
	}
	.he-meta { display: flex; gap: 0.75rem; font-size: 0.75rem; color: var(--muted-fg); }
	.he-status { color: #e53935; }
	.he-body {
		flex: 1;
		display: flex;
		gap: 0;
		min-height: 0;
		border-top: 1.5px solid var(--border);
	}
	.he-editor {
		flex: 1;
		min-width: 0;
		border: 0;
		border-right: 1.5px solid var(--border);
		border-radius: 0;
		resize: none;
		padding: 1rem;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.78rem;
		line-height: 1.5;
		color: var(--ink);
		background: var(--paper);
		outline: none;
		tab-size: 2;
		white-space: pre;
	}
	.he-preview {
		flex: 1;
		min-width: 0;
		border: 0;
		background: #fff;
	}
	.he-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1.25rem;
		border-top: 1.5px solid var(--border);
	}
	.he-hint {
		font-size: 0.72rem;
		color: var(--muted-fg);
		margin-right: auto;
	}
	.btn-ghost {
		padding: 0.5rem 0.75rem;
		background: none;
		border: none;
		font-family: inherit;
		font-size: 0.875rem;
		color: var(--muted-fg);
		cursor: pointer;
	}
	.btn-ghost:hover { color: var(--ink); }

	/* Editing HTML on a phone: stack editor over preview. */
	@media (max-width: 720px) {
		.he-body { flex-direction: column; }
		.he-editor {
			border-right: 0;
			border-bottom: 1.5px solid var(--border);
			flex: 1.2;
		}
		.he-hint { display: none; }
		.custom-bar { padding: 0.4rem 1rem; }
	}

	.section h2 {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
		margin: 0 0 0.5rem;
	}

	.bio {
		font-size: 0.9rem;
		color: var(--ink);
		line-height: 1.6;
		margin: 0;
		white-space: pre-wrap;
	}

	.detail-list {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.detail-row {
		display: grid;
		grid-template-columns: 80px 1fr;
		gap: 0.75rem;
		align-items: baseline;
	}
	.detail-row dt {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted-fg);
		margin: 0;
	}
	.detail-row dd {
		font-size: 0.9rem;
		color: var(--ink);
		margin: 0;
		line-height: 1.4;
	}

	.website-link {
		font-size: 0.9rem;
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.empty {
		font-size: 0.9rem;
		color: var(--muted-fg);
		margin: 0;
	}

	.empty-own {
		background: var(--surface-2);
		border: 1.5px dashed var(--border);
		border-radius: 10px;
		padding: 1rem 1.25rem;
		font-size: 0.9rem;
		color: var(--muted-fg);
	}
	.empty-own p { margin: 0; }
	.empty-own a { color: var(--ink); }
</style>
