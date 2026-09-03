<script>
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import AvatarPicker from '$lib/components/AvatarPicker.svelte';
	import FormattedInput from '$lib/components/FormattedInput.svelte';
	let { data, form } = $props();

	const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate', 'Other'];

	// Avatar state. Pre-filled from whatever is already on the row;
	// the AvatarPicker binds these so submit picks them up. photoFile
	// is the raw File object the user picked — appended to the form
	// FormData inside use:enhance so the server can stream it to R2.
	let avatarKind = $state(data.prefill.avatarKind ?? 'gen');
	let avatarValue = $state(data.prefill.avatarValue ?? null);
	let photoFile = $state(null);

	// Instant save for expression / generative picks: committing in the
	// picker IS the decision, so don't make it also depend on remembering to
	// hit "Save changes". invalidateAll() then re-runs every load, which is
	// what pushes the new avatar into the header, sidebar, and chat
	// immediately. Photos still save via the form (they carry an upload).
	let avatarStatus = $state('');
	async function saveAvatar({ kind, value }) {
		avatarStatus = 'saving…';
		try {
			const r = await fetch('/api/profile/avatar', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ kind, value })
			});
			if (!r.ok) throw new Error(String(r.status));
			avatarStatus = 'saved';
			invalidateAll();
		} catch {
			avatarStatus = 'could not save — try again';
		}
		setTimeout(() => (avatarStatus = ''), 2500);
	}

	// Bio uses FormattedInput so inline emotes work here too. Hidden
	// input mirrors the value into the form payload; the existing
	// server action reads `data.get('bio')` unchanged.
	let bioValue = $state(form?.bio ?? data.prefill.bio ?? '');

	// Message analysis (instant save, independent of the form). Synced from
	// the server at mount — page-load data can be stale if the setting changed
	// elsewhere (e.g. the opt-out button on the Gemma page). One switch drives
	// both underlying columns; see /api/gemma/settings.
	import { onMount } from 'svelte';
	let msgAnalysis = $state(data.prefill.gemmaDigest ?? true);
	let msgAnalysisStatus = $state('');
	onMount(async () => {
		try {
			const r = await fetch('/api/gemma/settings');
			if (r.ok) msgAnalysis = (await r.json()).messageAnalysis;
		} catch { /* keep prefill */ }
	});
	async function toggleMsgAnalysis() {
		msgAnalysis = !msgAnalysis;
		msgAnalysisStatus = 'saving…';
		try {
			const r = await fetch('/api/gemma/settings', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messageAnalysis: msgAnalysis })
			});
			msgAnalysisStatus = r.ok ? 'saved' : 'failed';
			if (!r.ok) msgAnalysis = !msgAnalysis;
		} catch { msgAnalysisStatus = 'failed'; msgAnalysis = !msgAnalysis; }
		setTimeout(() => (msgAnalysisStatus = ''), 2000);
	}

	// ── Notifications ────────────────────────────────────────────────────
	// A manual (re-)enable that works everywhere: the native shell asks the
	// OS again via the Capacitor plugin; web/PWA runs the permission prompt +
	// push subscription. Neither platform re-prompts once DENIED — the only
	// honest thing to show then is where to flip it back on.
	import { isNativeApp, registerNativePush, nativePushPermission } from '$lib/native.js';
	import { subscribeToPush, unsubscribeFromPush, isPushSubscribed } from '$lib/push.js';
	let notifState = $state('loading'); // enabled | ready | prompt | denied | unsupported | loading
	let notifBusy = $state(false);
	const notifIsNative = typeof window !== 'undefined' && isNativeApp();
	async function refreshNotifState() {
		if (notifIsNative) {
			const p = await nativePushPermission();
			notifState = p === 'granted' ? 'enabled' : p === 'denied' ? 'denied' : p === 'prompt' ? 'prompt' : 'unsupported';
			return;
		}
		if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
			notifState = 'unsupported';
			return;
		}
		if (Notification.permission === 'denied') { notifState = 'denied'; return; }
		if (Notification.permission === 'default') { notifState = 'prompt'; return; }
		notifState = (await isPushSubscribed()) ? 'enabled' : 'ready';
	}
	onMount(refreshNotifState);
	async function enableNotifs() {
		notifBusy = true;
		try {
			if (notifIsNative) {
				await registerNativePush();
			} else {
				if (Notification.permission === 'default') await Notification.requestPermission();
				if (Notification.permission === 'granted') await subscribeToPush();
			}
		} catch { /* state readout below tells the truth */ }
		await refreshNotifState();
		notifBusy = false;
	}
	async function disableNotifs() {
		notifBusy = true;
		try { await unsubscribeFromPush(); } catch {}
		await refreshNotifState();
		notifBusy = false;
	}

	// ── Blocked users (App Store Guideline 1.2) ─────────────────────────
	// The single place the whole block list is visible and reversible —
	// blocking happens in chat, unblocking happens here (or inline in a
	// blocked DM).
	let blockedList = $state([]);
	let blockedLoaded = $state(false);
	onMount(async () => {
		try {
			const r = await fetch('/api/moderation/block');
			if (r.ok) blockedList = (await r.json()).blocked;
		} catch { /* section shows as empty */ }
		blockedLoaded = true;
	});
	async function unblock(userId) {
		try {
			const r = await fetch('/api/moderation/block', {
				method: 'DELETE', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});
			if (!r.ok) throw new Error(String(r.status));
			blockedList = blockedList.filter((b) => b.userId !== userId);
		} catch {
			alert('Could not unblock — check your connection and try again.');
		}
	}

	// ── Account deletion (App Store Guideline 5.1.1(v)) ─────────────────
	// Two-step: the button reveals a typed-confirmation row, and only the
	// exact word DELETE arms the final button. After the server confirms,
	// the signout form (server action → cookie cleared → /login) runs; the
	// account is already gone at that point.
	let deleteArmed = $state(false);
	let deleteConfirmText = $state('');
	let deleteBusy = $state(false);
	let deleteError = $state('');
	let signoutForm = $state(null);
	async function deleteAccount() {
		if (deleteConfirmText !== 'DELETE' || deleteBusy) return;
		deleteBusy = true;
		deleteError = '';
		try {
			const r = await fetch('/api/profile/delete-account', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ confirm: 'DELETE' })
			});
			if (!r.ok) {
				const j = await r.json().catch(() => null);
				deleteError = j?.message || 'Deletion failed — please try again.';
				deleteBusy = false;
				return;
			}
			// The account is gone — its device state goes with it, so the next
			// sign-in (possibly someone else) starts clean.
			try { sessionStorage.clear(); } catch {}
			try { localStorage.clear(); } catch {}
			signoutForm?.requestSubmit();
		} catch {
			deleteError = 'Deletion failed — check your connection and try again.';
			deleteBusy = false;
		}
	}
</script>

<svelte:head><title>Edit profile — eating.computer</title></svelte:head>

<div class="shell">
	<main>
		<a class="back" href="/app">← Back</a>

		<div class="card">
			<h1>Edit profile</h1>

			{#if form?.error}
				<p class="error">{form.error}</p>
			{/if}

			<form method="POST" enctype="multipart/form-data" use:enhance={({ formData }) => {
				// AvatarPicker holds the photo File outside the form so
				// SvelteKit's FormData serialisation doesn't know about
				// it. Append at submit time. The hidden fields below
				// already carry kind + value.
				if (avatarKind === 'photo' && photoFile) {
					formData.append('avatar_photo', photoFile);
				}
			}}>
				<div class="avatar-section">
					<AvatarPicker
						name={form?.name ?? data.prefill.name}
						uid={data.session?.user?.id ?? data.prefill.name}
						bind:avatarKind
						bind:avatarValue
						bind:photoFile
						oncommit={saveAvatar}
					/>
				</div>
				{#if avatarStatus}
					<p class="avatar-status">{avatarStatus}</p>
				{/if}
				<input type="hidden" name="avatar_kind" value={avatarKind} />
				<input type="hidden" name="avatar_value" value={avatarKind === 'expr' ? (avatarValue ?? '') : ''} />

				<label>
					<span>Name <span class="req">*</span></span>
					<input type="text" name="name" value={form?.name ?? data.prefill.name} required placeholder="Your full name" />
				</label>

				<label>
					<span>Pronouns</span>
					<input type="text" name="pronouns" value={form?.pronouns ?? data.prefill.pronouns} placeholder="e.g. she/her, they/them" />
				</label>

				<div class="row-2">
					<label>
						<span>Year</span>
						<select name="year">
							<option value="">Select year</option>
							{#each YEARS as y}
								<option value={y} selected={(form?.year ?? data.prefill.year) === y}>{y}</option>
							{/each}
						</select>
					</label>

					<label class="grow">
						<span>School / University</span>
						<input type="text" name="school" value={form?.school ?? data.prefill.school} placeholder="e.g. RISD, Parsons" />
					</label>
				</div>

				<label>
					<span>Focus / Major</span>
					<input type="text" name="focus" value={form?.focus ?? data.prefill.focus} placeholder="e.g. Graphic Design, Illustration" />
				</label>

				<label>
					<span>Bio</span>
					<input type="hidden" name="bio" value={bioValue} />
					<div class="bio-fi">
						<FormattedInput bind:value={bioValue} placeholder="A little about yourself…" />
					</div>
				</label>

				<label>
					<span>Website / portfolio</span>
					<input type="url" name="website" value={form?.website ?? data.prefill.website} placeholder="https://yoursite.com" />
				</label>

				<div class="form-actions">
					<a class="btn-ghost" href="/app">Cancel</a>
					<button type="submit" class="btn-primary">Save changes</button>
				</div>
			</form>

			<!-- Message analysis — saved instantly, separate from the profile
			     form (hits /api/gemma/settings directly). -->
			<label class="gemma-optin-row">
				<input type="checkbox" checked={msgAnalysis} onchange={toggleMsgAnalysis} />
				<span class="gemma-optin-text">
					<span class="gemma-optin-title">Message analysis</span>
					<span class="gemma-optin-sub">Gemma reads the class channels and your DMs so she can send you a digest: what you missed, what's still unfinished, and something to look at. She writes every couple of days, or daily if you're reading them, and never sends a new one while the last is still unopened. Turn it off any time.{msgAnalysisStatus ? ` — ${msgAnalysisStatus}` : ''}</span>
				</span>
			</label>

			<!-- Notifications: manual (re-)enable, since the OS prompt only
			     ever appears once on its own. -->
			{#if notifState !== 'unsupported' && notifState !== 'loading'}
				<div class="notif-section">
					<h2>Notifications</h2>
					{#if notifState === 'enabled'}
						<p class="notif-sub">Notifications are on for this device.</p>
						{#if !notifIsNative}
							<button type="button" class="btn-notif" disabled={notifBusy} onclick={disableNotifs}>{notifBusy ? '…' : 'Turn off on this device'}</button>
						{/if}
					{:else if notifState === 'denied'}
						<p class="notif-sub">
							Notifications are blocked for this
							{notifIsNative ? 'app — turn them on in Settings → eating.computer → Notifications.' : 'site — allow them in your browser settings, then come back and enable.'}
						</p>
						<button type="button" class="btn-notif" disabled={notifBusy} onclick={enableNotifs}>{notifBusy ? '…' : 'Check again'}</button>
					{:else}
						<p class="notif-sub">Get notified about mentions, replies, and DMs.</p>
						<button type="button" class="btn-notif" disabled={notifBusy} onclick={enableNotifs}>{notifBusy ? '…' : 'Enable notifications'}</button>
					{/if}
				</div>
			{/if}

			<!-- Blocked users: the block list lives here; blocking itself
			     happens from the ⋮ menu on a message in chat. Always rendered
			     (with an empty state) — a section that only exists when
			     non-empty is undiscoverable. -->
			{#if blockedLoaded}
				<div class="blocked-section">
					<h2>Blocked users</h2>
					<p>You won't see messages from these people, and they can't notify you. Blocking is private — they aren't told. Block someone from the ⋮ menu on any of their messages.</p>
					{#if blockedList.length === 0}
						<p class="blocked-empty">No one is blocked.</p>
					{:else}
						{#each blockedList as b (b.userId)}
							<div class="blocked-row">
								<span class="blocked-name">{b.name}</span>
								<button type="button" class="btn-unblock" onclick={() => unblock(b.userId)}>Unblock</button>
							</div>
						{/each}
					{/if}
				</div>
			{/if}

			<!-- Danger zone: in-app account deletion. The hidden signout form
			     is the same server action the user menu uses — it clears the
			     session cookie AFTER the account row is already gone. -->
			<div class="danger-zone">
				<h2>Delete account</h2>
				<p>
					Permanently deletes your profile, uploads, submissions, saved messages,
					notifications, and device registrations. Messages you sent stay in the
					class conversation, shown as “Deleted user”. This cannot be undone.
					See the <a href="/privacy" target="_blank" rel="noopener noreferrer">privacy policy</a> for details.
				</p>
				{#if !deleteArmed}
					<button type="button" class="btn-danger-ghost" onclick={() => { deleteArmed = true; deleteError = ''; }}>
						Delete my account…
					</button>
				{:else}
					<label>
						<span>Type <strong>DELETE</strong> to confirm</span>
						<!-- The confirm field is the LAST thing on the page, and in the
						     native shell the keyboard overlays the web view without
						     resizing it — so it typed blind under the keyboard. The
						     --kb-h padding on main (below) creates room to scroll into,
						     and the focus handler does the scrolling once the keyboard
						     has committed to opening. -->
						<input type="text" bind:value={deleteConfirmText} placeholder="DELETE" autocomplete="off" autocapitalize="characters"
							onfocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)} />
					</label>
					<div class="danger-actions">
						<button type="button" class="btn-ghost" onclick={() => { deleteArmed = false; deleteConfirmText = ''; deleteError = ''; }}>Cancel</button>
						<button type="button" class="btn-danger" disabled={deleteConfirmText !== 'DELETE' || deleteBusy} onclick={deleteAccount}>
							{deleteBusy ? 'Deleting…' : 'Permanently delete my account'}
						</button>
					</div>
				{/if}
				{#if deleteError}
					<p class="error">{deleteError}</p>
				{/if}
				<form method="POST" action="/app?/signout" style="display:none" bind:this={signoutForm}></form>
			</div>
		</div>
	</main>
</div>

<style>
	.shell { min-height: 100vh; display: flex; flex-direction: column; background: var(--paper); }

	main { padding: calc(1.5rem + var(--header-h, 52px)) 2rem 2rem; max-width: 480px; width: 100%; margin: 0 auto; }
	/* Mobile: the bottom nav pill floats over the page, so the page has to
	   scroll past it — without this reservation the Danger zone (the LAST
	   thing on the page) ends up underneath the pill and can't be reached.
	   64px ≈ pill height + its 6px float gap; the safe-area and
	   --browser-chrome-h terms mirror the pill's own bottom offset
	   (BottomNav.svelte), so the clearance holds on notched phones and under
	   Safari/Chrome's browser bars alike. */
	@media (max-width: 640px) {
		/* --kb-h: when the keyboard is up (native shell overlays the webview
		   without resizing it), this adds exactly the covered strip as
		   scrollable room, so the DELETE confirm field can scroll above it. */
		main { padding-bottom: calc(2rem + 64px + env(safe-area-inset-bottom, 0px) + var(--browser-chrome-h, 0px) + var(--kb-h, 0px)); }
	}

	.back { display: inline-block; font-size: 0.85rem; color: var(--muted-fg); text-decoration: none; margin-bottom: 1.5rem; }
	.back:hover { color: var(--ink); }

	.gemma-optin-row {
		display: flex; align-items: flex-start; gap: 0.6rem;
		margin-top: 1.25rem; padding-top: 1.25rem;
		border-top: 1.5px solid var(--border);
		cursor: pointer;
	}
	.gemma-optin-row input { margin-top: 0.2rem; accent-color: var(--ink); cursor: pointer; }
	.gemma-optin-text { display: flex; flex-direction: column; gap: 0.15rem; }
	.gemma-optin-title { font-weight: 600; font-size: 0.9rem; }
	.gemma-optin-sub { font-size: 0.78rem; color: var(--muted-fg); line-height: 1.4; }

	.card {
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 16px;
		padding: 2rem; display: flex; flex-direction: column; gap: 1rem;
	}

	h1 { font-family: 'Avara', serif; font-size: 1.75rem; font-weight: 400; margin: 0 0 0.25rem; color: var(--ink); }

	.error { background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 0.6rem 0.85rem; font-size: 0.85rem; color: #b91c1c; margin: 0; }

	form { display: flex; flex-direction: column; gap: 1rem; }
	label { display: flex; flex-direction: column; gap: 0.35rem; }
	label span { font-size: 0.82rem; font-weight: 600; color: var(--ink); }
	.req { color: #e53935; }

	.row-2 { display: flex; gap: 0.75rem; }
	.row-2 label { flex: 1; min-width: 0; }
	.grow { flex: 2 !important; }

	input, textarea, select {
		padding: 0.6rem 0.85rem; border: 1.5px solid var(--border); border-radius: 8px;
		font-family: inherit; font-size: 0.9rem; color: var(--ink); background: var(--paper);
		outline: none; transition: border-color 0.15s; width: 100%; box-sizing: border-box;
	}
	input:focus, textarea:focus, select:focus { border-color: var(--ink); }
	textarea { resize: vertical; }

	.form-actions { display: flex; justify-content: flex-end; align-items: center; gap: 0.5rem; margin-top: 0.25rem; }

	.btn-primary {
		padding: 0.6rem 1.4rem; background: var(--ink); color: var(--paper);
		border: none; border-radius: 8px; font-family: inherit; font-size: 0.95rem;
		font-weight: 600; cursor: pointer; transition: opacity 0.15s;
	}
	.btn-primary:hover { opacity: 0.8; }

	.btn-ghost { padding: 0.6rem 0.75rem; background: none; border: none; font-family: inherit; font-size: 0.9rem; color: var(--muted-fg); cursor: pointer; text-decoration: none; }
	.btn-ghost:hover { color: var(--ink); }
	/* No border/background here: FormattedInput's own `.fi-editor` already
	   draws the 1.5px box and paper fill. Painting a second one around it
	   stacked two rounded rectangles — and because this radius was 8px while
	   the inner one is 10px, the inner corners bulged THROUGH the outer box.
	   The wrapper is now just a positioning box; the field owns its own look. */
	.bio-fi {
		display: block;
	}
	.bio-fi :global(.fi-wrap) { padding: 0; }
	.bio-fi :global(.fi-ce) {
		min-height: 80px; padding: 0.6rem 0.85rem;
		font-size: 0.9rem; line-height: 1.45;
	}

	.avatar-section {
		display: flex; justify-content: center;
		padding: 0.25rem 0 0.75rem;
		position: relative;
	}
	.avatar-status {
		margin: -0.5rem 0 0; text-align: center;
		font-size: 0.78rem; color: var(--muted-fg);
	}

	/* ── Notifications ── */
	.notif-section {
		margin-top: 1.25rem; padding-top: 1.25rem;
		border-top: 1.5px solid var(--border);
		display: flex; flex-direction: column; gap: 0.6rem;
	}
	.notif-section h2 { margin: 0; font-size: 1rem; font-weight: 600; color: var(--ink); }
	.notif-sub { margin: 0; font-size: 0.8rem; color: var(--muted-fg); line-height: 1.45; }
	.btn-notif {
		align-self: flex-start;
		padding: 0.5rem 0.9rem; background: none;
		border: 1.5px solid var(--border); border-radius: 8px;
		font-family: inherit; font-size: 0.85rem; font-weight: 600;
		color: var(--ink); cursor: pointer; transition: border-color 0.15s;
	}
	.btn-notif:hover { border-color: var(--ink); }
	.btn-notif:disabled { opacity: 0.5; cursor: default; }

	/* ── Blocked users ── */
	.blocked-section {
		margin-top: 1.25rem; padding-top: 1.25rem;
		border-top: 1.5px solid var(--border);
		display: flex; flex-direction: column; gap: 0.6rem;
	}
	.blocked-section h2 { margin: 0; font-size: 1rem; font-weight: 600; color: var(--ink); }
	.blocked-section p { margin: 0; font-size: 0.8rem; color: var(--muted-fg); line-height: 1.45; }
	.blocked-row {
		display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border: 1.5px solid var(--border); border-radius: 8px;
	}
	.blocked-name { font-size: 0.9rem; font-weight: 600; color: var(--ink); }
	.blocked-empty { font-size: 0.85rem; color: var(--muted-fg); margin: 0; font-style: italic; }
	.btn-unblock {
		padding: 0.4rem 0.9rem; background: none;
		border: 1.5px solid var(--border); border-radius: 8px;
		font-family: inherit; font-size: 0.82rem; font-weight: 600;
		color: var(--ink); cursor: pointer; transition: border-color 0.15s;
	}
	.btn-unblock:hover { border-color: var(--ink); }

	/* ── Danger zone ── */
	.danger-zone {
		margin-top: 1.25rem; padding-top: 1.25rem;
		border-top: 1.5px solid var(--border);
		display: flex; flex-direction: column; gap: 0.6rem;
	}
	.danger-zone h2 { margin: 0; font-size: 1rem; font-weight: 600; color: #b91c1c; }
	.danger-zone p { margin: 0; font-size: 0.8rem; color: var(--muted-fg); line-height: 1.45; }
	.danger-zone p a { color: inherit; }
	.btn-danger-ghost {
		align-self: flex-start;
		padding: 0.5rem 0.9rem; background: none;
		border: 1.5px solid #fca5a5; border-radius: 8px;
		font-family: inherit; font-size: 0.85rem; font-weight: 600;
		color: #b91c1c; cursor: pointer; transition: background 0.15s;
	}
	.btn-danger-ghost:hover { background: #fef2f2; }
	.danger-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
	.btn-danger {
		padding: 0.6rem 1.1rem; background: #b91c1c; color: #fff;
		border: none; border-radius: 8px; font-family: inherit;
		font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: opacity 0.15s;
	}
	.btn-danger:hover { opacity: 0.85; }
	.btn-danger:disabled { opacity: 0.4; cursor: default; }
</style>
