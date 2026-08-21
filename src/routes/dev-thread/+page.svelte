<script>
	// Renders ThreadPanel in isolation with mock data, so its chrome can be
	// inspected at a phone width without a login or a live conversation.
	// Guarded to dev in +page.server.js.
	import ThreadPanel from '$lib/components/ThreadPanel.svelte';

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

<ThreadPanel
	convId="devconv"
	{parent}
	{currentUser}
	{userMap}
	chatName="# class"
	classId="idc-fall-2026"
	onClose={() => {}}
/>
