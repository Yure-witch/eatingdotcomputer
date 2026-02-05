<script>
	import { onMount, tick } from 'svelte';

	const text = 'eating.computer';

	const fonts = [
		'"Cambridge", "UnifrakturCook", "Old English Text MT", serif',
		'"Space Grotesk", "Helvetica Neue", Arial, sans-serif',
		'"Pacifico", "Brush Script MT", cursive',
		'"Press Start 2P", "VT323", monospace'
	];

	const letters = Array.from(text);
	let letterFonts = letters.map(() => fonts[0]);
	let letterWidths = letters.map(() => null);
	let lineEl;

	const scaleByFont = {
		[fonts[0]]: 1.5,
		[fonts[1]]: 1.2,
		[fonts[2]]: 1.15,
		[fonts[3]]: 1.1
	};

	function swapFont(letterIndex) {
		const current = letterFonts[letterIndex];
		const options = fonts.filter((family) => family !== current);
		const next = options[Math.floor(Math.random() * options.length)];
		letterFonts[letterIndex] = next;
		letterFonts = [...letterFonts];
	}

	async function measureWidths() {
		if (!lineEl) return;
		await tick();

		const sample = document.createElement('span');
		sample.style.position = 'absolute';
		sample.style.visibility = 'hidden';
		sample.style.whiteSpace = 'pre';
		sample.style.top = '-9999px';
		sample.style.left = '-9999px';

		const { fontSize, fontWeight, letterSpacing } = getComputedStyle(lineEl);
		const baseSize = parseFloat(fontSize);
		sample.style.fontSize = fontSize;
		sample.style.fontWeight = fontWeight;
		sample.style.letterSpacing = letterSpacing;

		document.body.appendChild(sample);

		letterWidths = letters.map((letter) => {
			let max = 0;
			for (const family of fonts) {
				sample.style.fontFamily = family;
				const scale = scaleByFont[family] ?? 1;
				sample.style.fontSize = `${baseSize * scale}px`;
				sample.textContent = letter;
				const width = sample.getBoundingClientRect().width;
				if (width > max) max = width;
			}
			return Math.ceil(max * 100) / 100;
		});

		document.body.removeChild(sample);
	}

	onMount(() => {
		measureWidths();
		window.addEventListener('resize', measureWidths);
		return () => window.removeEventListener('resize', measureWidths);
	});
</script>

<main>
	<div class="stage">
		<div class="line" bind:this={lineEl}>
			{#each letters as letter, letterIndex}
				<span
					class="letter"
					style={`font-family: ${letterFonts[letterIndex]}; width: ${
						letterWidths[letterIndex] ? `${letterWidths[letterIndex].toFixed(2)}px` : 'auto'
					}; font-size: ${scaleByFont[letterFonts[letterIndex]] ?? 1}em;`}
					on:mouseenter={() => swapFont(letterIndex)}
				>
					{#if letter === '.'}
						<span class="dot">.</span>
					{:else}
						{letter}
					{/if}
				</span>
			{/each}
		</div>
	</div>
</main>
