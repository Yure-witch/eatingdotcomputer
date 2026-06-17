<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	let { data } = $props();
	onMount(() => {
		// Desktop lands directly in a conversation (it always shows the channel
		// list in the rail). Mobile stays here — the chat menu IS the pager's
		// left panel, so this page component isn't even rendered there.
		if (!window.matchMedia('(max-width: 640px)').matches && data.firstChannelId) {
			goto(`/app/chat/channel/${data.firstChannelId}`, { replaceState: true });
		}
	});
</script>

<div class="chat-empty">Select a conversation</div>

<style>
	.chat-empty { display: grid; place-items: center; height: 100%; min-height: 60vh; color: var(--muted-fg); font-size: 0.9rem; }
</style>
