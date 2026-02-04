<script>
	const text = 'eating.computer';

	const fonts = [
		{
			label: 'Blackletter',
			family: '"UnifrakturMaguntia", "UnifrakturCook", "Old English Text MT", serif',
			className: 'blackletter'
		},
		{
			label: 'Sans Serif',
			family: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif',
			className: 'sans'
		},
		{
			label: 'Script',
			family: '"Pacifico", "Brush Script MT", cursive',
			className: 'script'
		},
		{
			label: '8-bit',
			family: '"Press Start 2P", "VT323", monospace',
			className: 'eight-bit'
		}
	];

	const lines = fonts.map((font) => ({
		label: font.label,
		defaultFamily: font.family,
		className: font.className,
		letters: Array.from(text)
	}));

	let letterFonts = lines.map((line) => line.letters.map(() => line.defaultFamily));

	function swapFont(lineIndex, letterIndex) {
		const current = letterFonts[lineIndex][letterIndex];
		const options = fonts.map((font) => font.family).filter((family) => family !== current);
		const next = options[Math.floor(Math.random() * options.length)];
		letterFonts[lineIndex][letterIndex] = next;
		letterFonts = [...letterFonts];
	}
</script>

<main>
	<div class="stage">
		{#each lines as line, lineIndex}
			<div class={`line ${line.className}`}>
				{#each line.letters as letter, letterIndex}
					<span
						class="letter"
						style={`font-family: ${letterFonts[lineIndex][letterIndex]}`}
						on:mouseenter={() => swapFont(lineIndex, letterIndex)}
					>
						{#if letter === '.'}
							<span class="dot">.</span>
						{:else}
							{letter}
						{/if}
					</span>
				{/each}
			</div>
		{/each}
	</div>
</main>
