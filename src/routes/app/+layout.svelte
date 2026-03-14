<script>
	import { browser } from '$app/environment';
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { auth, db as rtdb } from '$lib/firebase.js';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import { signInWithCustomToken } from 'firebase/auth';
	import { ref, onValue, off } from 'firebase/database';

	let { data, children } = $props();

	let userChatsRef;
	const prevDmLastAt = {};

	// Install prompt
	let installPrompt = $state(null);
	let installed = $state(false);
	let dismissed = $state(false);

	// In-app notifications
	let toasts = $state([]);
	let soundEnabled = $state(true);

	function playSound() {
		try {
			const ctx = new AudioContext();
			// Two-tone Slack-esque "ding"
			const frequencies = [880, 1100];
			let t = ctx.currentTime;
			for (const freq of frequencies) {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.type = 'sine';
				osc.frequency.value = freq;
				gain.gain.setValueAtTime(0, t);
				gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
				gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
				osc.start(t);
				osc.stop(t + 0.35);
				t += 0.1;
			}
		} catch {
			// AudioContext not available
		}
	}

	function addToast(toast) {
		const id = crypto.randomUUID();
		toasts = [{ id, ...toast }, ...toasts].slice(0, 5);
		if (soundEnabled) playSound();
		setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); }, 5000);
	}

	onMount(async () => {
		logActivity();
		activityTimer = setInterval(logActivity, 5 * 60_000);

		// Subscribe to DMs globally so toasts appear on any app page
		if (data?.firebaseToken && data?.userId) {
			try {
				await signInWithCustomToken(auth, data.firebaseToken);
				userChatsRef = ref(rtdb, `userChats/${data.userId}`);
				onValue(userChatsRef, (snap) => {
					if (!snap.exists()) return;
					for (const [convId, meta] of Object.entries(snap.val())) {
						const prev = prevDmLastAt[convId];
						const lastAt = meta.lastAt ?? 0;
						if (prev !== undefined && lastAt > prev && !window.location.pathname.startsWith('/app/chat')) {
							addToast({
								title: meta.otherUserName ?? 'New message',
								body: meta.lastMessage ?? '',
								url: `/app/chat/dm/${convId}`
							});
						}
						prevDmLastAt[convId] = lastAt;
					}
				});
			} catch { /* firebase unavailable */ }
		}

		soundEnabled = localStorage.getItem('notif_sound') !== 'false';

		if (window.matchMedia('(display-mode: standalone)').matches) {
			installed = true;
		}

		window.addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault();
			installPrompt = e;
		});
		window.addEventListener('appinstalled', () => {
			installed = true;
			installPrompt = null;
		});

		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.addEventListener('message', (e) => {
				if (e.data?.type === 'push') addToast(e.data.data);
			});
		}
	});

	// Activity logging — fires on load + every 5 min so instructor can see usage patterns
	let activityTimer;
	async function logActivity() {
		try { await fetch('/api/presence/log', { method: 'POST' }); } catch { /* ignore */ }
	}
	onDestroy(() => {
		clearInterval(activityTimer);
		if (userChatsRef) off(userChatsRef);
	});

	async function install() {
		if (!installPrompt) return;
		installPrompt.prompt();
		const { outcome } = await installPrompt.userChoice;
		if (outcome === 'accepted') installed = true;
		installPrompt = null;
	}

	function toggleSound() {
		soundEnabled = !soundEnabled;
		localStorage.setItem('notif_sound', String(soundEnabled));
	}
</script>

<div class="app-shell">
	{@render children()}
</div>

<BottomNav />

<!-- In-app notification toasts -->
<div class="toast-stack">
	{#each toasts as toast (toast.id)}
		<div class="toast">
			<div class="toast-content">
				<strong>{toast.title}</strong>
				{#if toast.body}<span>{toast.body}</span>{/if}
			</div>
			{#if toast.url}
				<a href={toast.url} class="toast-link" onclick={() => { toasts = toasts.filter(t => t.id !== toast.id); }}>View</a>
			{/if}
			<button class="toast-close" onclick={() => { toasts = toasts.filter(t => t.id !== toast.id); }}>×</button>
		</div>
	{/each}
</div>


<!-- Install banner -->
{#if browser && installPrompt && !installed && !dismissed}
	<div class="install-banner">
		<div class="install-text">
			<strong>Install eating.computer</strong>
			<span>Get the full app experience with notifications</span>
		</div>
		<div class="install-actions">
			<button class="btn-install" onclick={install}>Install</button>
			<button class="btn-dismiss" onclick={() => (dismissed = true)} aria-label="Dismiss">×</button>
		</div>
	</div>
{/if}

<style>
	/* ── Toasts ── */
	.toast-stack {
		position: fixed;
		top: 1rem;
		right: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		z-index: 200;
		max-width: 320px;
		width: calc(100vw - 2rem);
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		background: var(--ink);
		color: var(--paper);
		border-radius: 10px;
		padding: 0.75rem 1rem;
		box-shadow: 0 4px 20px rgba(0,0,0,0.2);
		animation: slide-in 0.2s ease;
	}

	@keyframes slide-in {
		from { opacity: 0; transform: translateX(1rem); }
		to   { opacity: 1; transform: translateX(0); }
	}

	.toast-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.toast-content strong { font-size: 0.875rem; }
	.toast-content span { font-size: 0.8rem; opacity: 0.75; }

	.toast-link {
		color: var(--paper);
		font-size: 0.8rem;
		font-weight: 600;
		opacity: 0.8;
		text-decoration: underline;
		flex-shrink: 0;
		align-self: center;
	}
	.toast-link:hover { opacity: 1; }

	.toast-close {
		background: none;
		border: none;
		color: var(--paper);
		opacity: 0.5;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
		flex-shrink: 0;
	}
	.toast-close:hover { opacity: 1; }

/* ── Install banner ── */
	.install-banner {
		position: fixed;
		bottom: 1.25rem;
		left: 50%;
		transform: translateX(-50%);
		width: calc(100% - 2.5rem);
		max-width: 480px;
		background: var(--ink);
		color: var(--paper);
		border-radius: 12px;
		padding: 0.85rem 1rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		box-shadow: 0 4px 24px rgba(0,0,0,0.18);
		z-index: 100;
	}

	.install-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.install-text strong { font-size: 0.9rem; }
	.install-text span { font-size: 0.78rem; opacity: 0.7; }

	.install-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.btn-install {
		padding: 0.4rem 0.9rem;
		background: var(--paper);
		color: var(--ink);
		border: none;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.btn-install:hover { opacity: 0.85; }

	.btn-dismiss {
		background: none;
		border: none;
		color: var(--paper);
		opacity: 0.6;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0 0.2rem;
		line-height: 1;
	}
	.btn-dismiss:hover { opacity: 1; }

	@media (max-width: 640px) {
		.install-banner {
			bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 0.75rem);
		}
	}
</style>
