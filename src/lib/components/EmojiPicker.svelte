<script>
	let { onSelect } = $props();

	const EMOJI = [
		['👍', '❤️', '😂', '🔥', '🎉', '✨', '💯', '🙏'],
		['😀', '😍', '🥰', '😎', '🤔', '😭', '😤', '🥹'],
		['💀', '🫡', '🤯', '😅', '🫶', '💪', '👀', '🤌'],
		['👏', '🥲', '😬', '🤣', '⭐', '💔', '😊', '🫠'],
	];
</script>

<div class="picker">
	{#each EMOJI as row}
		<div class="row">
			{#each row as emoji}
				<button class="emoji-btn" onclick={() => onSelect(emoji)}>{emoji}</button>
			{/each}
		</div>
	{/each}
</div>

<style>
	.picker {
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.row {
		display: flex;
		gap: 0.1rem;
	}
	.emoji-btn {
		background: none;
		border: none;
		font-size: 1.3rem;
		width: 2.2rem;
		height: 2.2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.1s;
		line-height: 1;
	}
	.emoji-btn:hover {
		background: #f0ebe3;
	}
</style>
