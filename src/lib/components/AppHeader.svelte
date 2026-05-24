<script>
	import ClassSwitcher from './ClassSwitcher.svelte';
	import UserMenu from './UserMenu.svelte';

	let { currentClass = null, allClasses = [], user = null } = $props();
</script>

<header class="app-header">
	<div class="wordmark-wrap">
		<a class="wordmark" href="/">eating.computer</a>
		<ClassSwitcher {currentClass} {allClasses} />
	</div>
	<div class="header-right">
		<UserMenu {user} />
	</div>
</header>

<style>
	.app-header {
		display: flex; align-items: center; gap: 2rem;
		padding: 1rem 2rem; border-bottom: 1.5px solid #ddd7cc;
		position: fixed; top: 0; right: 0; left: var(--sidebar-width, 220px); z-index: 10;
		background: var(--paper); box-sizing: border-box;
	}
	.wordmark-wrap {
		display: flex; flex-direction: column; gap: 0.1rem; flex-shrink: 0;
	}
	.wordmark {
		font-family: 'Avara', serif; font-size: 1.25rem; color: var(--ink);
		text-decoration: none; white-space: nowrap;
	}
	.wordmark:hover { opacity: 0.7; }
	.header-right { margin-left: auto; flex-shrink: 0; }

	@media (max-width: 640px) {
		.app-header { left: 0; padding: 0.6rem 1rem; gap: 0.5rem; }
	}
</style>
