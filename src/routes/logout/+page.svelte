<script>
	import { onMount } from 'svelte';

	let form;
	onMount(() => form.requestSubmit());
</script>

<form bind:this={form} method="POST">
	<button type="submit">Logging out…</button>
</form>
