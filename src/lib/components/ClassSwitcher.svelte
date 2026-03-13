<script>
	import { goto } from '$app/navigation';

	let { currentClass, allClasses } = $props();

	async function switchClass(e) {
		const classId = e.target.value;
		await fetch('/api/class/select', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ class_id: classId })
		});
		// Reload so all server loads re-run with the new class
		window.location.reload();
	}
</script>

{#if allClasses && allClasses.length > 1}
	<select class="class-select" value={currentClass?.id} onchange={switchClass}>
		{#each allClasses as c}
			<option value={c.id}>{c.name} — {c.term}</option>
		{/each}
	</select>
{:else if currentClass}
	<span class="class-label">{currentClass.name} — {currentClass.term}</span>
{/if}

<style>
	.class-label {
		font-size: 0.72rem;
		color: #888;
		font-weight: 500;
		letter-spacing: 0.01em;
	}

	.class-select {
		font-family: inherit;
		font-size: 0.72rem;
		color: #666;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		outline: none;
		max-width: 280px;
	}
	.class-select:hover { color: #0c0c0c; }
</style>
