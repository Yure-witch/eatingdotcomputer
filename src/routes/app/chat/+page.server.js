export async function load({ parent }) {
	const { channels } = await parent();
	// No server redirect anymore: on mobile this route shows the chat-menu
	// pager panel (rendered by the app layout). Desktop redirects to the first
	// conversation client-side (see +page.svelte) to preserve its behaviour.
	return { firstChannelId: channels?.[0]?.id ?? null };
}
