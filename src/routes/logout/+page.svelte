<script>
	import { onMount } from 'svelte';

	let form;
	onMount(() => form.requestSubmit());
</script>

<form bind:this={form} method="POST">
	<!-- Without an explicit target Auth.js redirects back to /logout itself,
	     where onMount resubmits — an infinite sign-out loop. -->
	<input type="hidden" name="redirectTo" value="/login" />
	<button type="submit">Logging out…</button>
</form>
