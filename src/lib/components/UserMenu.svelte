<script>
	import { onMount } from 'svelte';
	import Avatar from './Avatar.svelte';
	import { nativeGoogleSignOut } from '$lib/native.js';

	let { user = null } = $props();

	let menuOpen = $state(false);
	let menuEl = $state(null);
	let switchForm = $state(null);

	// Clear the native Google session BEFORE signing out of the app. Our cookie
	// going away isn't enough — GIDSignIn keeps its own session, so the next
	// "Continue with Google" would silently restore the account you just left.
	async function switchAccount() {
		await nativeGoogleSignOut();
		switchForm?.requestSubmit();
	}

	function firstName(name) {
		return (name || '').split(/\s+/)[0] || name;
	}

	function onClickOutside(e) {
		if (menuEl && !menuEl.contains(e.target)) menuOpen = false;
	}

	onMount(() => {
		document.addEventListener('pointerdown', onClickOutside);
		return () => document.removeEventListener('pointerdown', onClickOutside);
	});
</script>

{#if user}
	<div class="user-menu-wrap" bind:this={menuEl}>
		<button
			class="user-trigger"
			onclick={() => menuOpen = !menuOpen}
			onpointerdown={(e) => e.stopPropagation()}
		>
			<Avatar
				name={user.name || user.email || '?'}
				uid={user.id}
				avatarKind={user.avatarKind ?? 'gen'}
				avatarValue={user.avatarValue ?? null}
				size={28}
			/>
			<span class="user-first-name">{firstName(user.name || user.email)}</span>
		</button>
		{#if menuOpen}
			<div class="user-dropdown">
				<a href="/app/profile/{user.id}" class="dropdown-item" onclick={() => menuOpen = false}>
					Profile
				</a>
				<a href="/app/theme" class="dropdown-item" onclick={() => menuOpen = false}>
					Customize theme
				</a>
				<a href="/app/ai" class="dropdown-item" onclick={() => menuOpen = false}>
					Gemma AI
				</a>
				<form method="POST" action="/app?/switchaccount" style="display:contents" bind:this={switchForm}>
					<button type="button" class="dropdown-item dropdown-item-btn" onclick={switchAccount}>Switch account</button>
				</form>
				<form method="POST" action="/app?/signout" style="display:contents">
					<button type="submit" class="dropdown-item dropdown-item-btn">Sign out</button>
				</form>
			</div>
		{/if}
	</div>
{/if}

<style>
	.user-menu-wrap {
		position: relative; flex-shrink: 0;
	}
	.user-trigger {
		display: flex; align-items: center; gap: 0.5rem;
		background: none; border: none; padding: 0.25rem 0.5rem;
		border-radius: 8px; cursor: pointer; font-family: inherit;
		transition: background 0.15s;
	}
	.user-trigger:hover { background: rgba(0,0,0,0.04); }
	/* Old .user-avatar styles removed — the Avatar component owns
	   its own typography (matches the user-menu chip we used to
	   hand-roll here) and palette, so any other surface that mounts
	   <Avatar size={28}> reads identically. */
	.user-first-name {
		font-size: 0.82rem; font-weight: 500; color: var(--muted-fg);
	}
	/* Mobile: the name overflows the narrow header — show just the avatar
	   circle (to the right of the notification bell). */
	@media (max-width: 640px) {
		.user-first-name { display: none; }
	}

	.user-dropdown {
		position: absolute; top: calc(100% + 6px); right: 0;
		background: var(--paper); border: 1.5px solid var(--border); border-radius: 10px;
		box-shadow: 0 4px 16px rgba(0,0,0,0.1);
		min-width: 160px; overflow: hidden; z-index: 20;
		display: flex; flex-direction: column;
	}
	.dropdown-item {
		display: block; padding: 0.6rem 0.85rem;
		font-size: 0.82rem; font-weight: 500; color: var(--ink);
		text-decoration: none; transition: background 0.1s;
		white-space: nowrap;
	}
	.dropdown-item:hover { background: var(--surface-2); }
	.dropdown-item-btn {
		background: none; border: none; border-top: 1px solid var(--surface-2);
		font-family: inherit; cursor: pointer; text-align: left; width: 100%;
		color: var(--muted-fg);
	}
	.dropdown-item-btn:hover { background: var(--surface-2); color: var(--ink); }
</style>
