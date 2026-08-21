<script>
	// Renders ThreadPanel in isolation with mock data, so its chrome can be
	// inspected at a phone width without a login or a live conversation.
	// Guarded to dev in +page.server.js.
	import ThreadPanel from '$lib/components/ThreadPanel.svelte';
	import ReactionEmote from '$lib/components/ReactionEmote.svelte';

	// Every token shape a reaction can be, so the shared renderer can be eyeballed
	// without a live conversation.
	const SAMPLES = ['😀', '[ce:creature]', '[tg:1f600]', '[tgc:party:5789]', '[ek:1a:1f600:1f601]'];

	const currentUser = { id: 'u1', name: 'Ricky', role: 'instructor' };
	const parent = {
		id: 'p1', userId: 'u2', userName: 'Jess Kuronen',
		content: 'Does the crit start at 10 or 10:30?', createdAt: Date.now() - 900000
	};
	const userMap = {
		u1: { name: 'Ricky', role: 'instructor', avatarKind: 'gen', avatarValue: null },
		u2: { name: 'Jess Kuronen', role: 'student', avatarKind: 'gen', avatarValue: null }
	};
</script>

<div class="rx-probe">
	{#each SAMPLES as t}
		<span class="rx-cell"><ReactionEmote token={t} size={18} /><code>{t}</code></span>
	{/each}
</div>

<ThreadPanel
	convId="devconv"
	{parent}
	{currentUser}
	{userMap}
	chatName="# class"
	classId="idc-fall-2026"
	onClose={() => {}}
/>

<style>
	.rx-probe {
		position: fixed; top: 0; left: 0; z-index: 9999;
		display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 0.5rem;
		background: #fff; border-bottom: 1px solid #ccc; font-size: 10px;
	}
	.rx-cell { display: inline-flex; align-items: center; gap: 0.25rem; }
</style>
