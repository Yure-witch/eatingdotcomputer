<script>
	import { page } from '$app/stores';

	let { children } = $props();

	const STEPS = [
		{ key: 'profile', label: 'Your profile', path: '/onboarding/profile' },
		{ key: 'class',   label: 'Choose a class', path: '/onboarding/class' },
		{ key: 'pending', label: 'Awaiting approval', path: '/onboarding/pending' }
	];

	let currentStep = $derived(
		STEPS.findIndex((s) => $page.url.pathname.startsWith(s.path))
	);
</script>

<div class="shell">
	<header>
		<span class="wordmark">eating.computer</span>
	</header>

	<div class="stepper">
		{#each STEPS as step, i}
			<div class="step" class:done={i < currentStep} class:active={i === currentStep} class:future={i > currentStep}>
				<div class="step-dot">
					{#if i < currentStep}
						<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
							<path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					{:else}
						<span class="step-num">{i + 1}</span>
					{/if}
				</div>
				<span class="step-label">{step.label}</span>
			</div>
			{#if i < STEPS.length - 1}
				<div class="step-line" class:filled={i < currentStep}></div>
			{/if}
		{/each}
	</div>

	<main>
		{@render children()}
	</main>
</div>

<style>
	:global(body) { margin: 0; }

	.shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--paper, #f7f2ea);
	}

	header {
		padding: 1.25rem 2rem;
		border-bottom: 1.5px solid #ddd7cc;
	}

	.wordmark {
		font-family: 'Avara', serif;
		font-size: 1.2rem;
		color: var(--ink, #1a1a1a);
	}

	/* ── Stepper ── */
	.stepper {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem 2rem 0;
		gap: 0;
	}

	.step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		min-width: 100px;
	}

	.step-dot {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid #ddd7cc;
		background: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.72rem;
		font-weight: 700;
		color: #a09688;
		transition: background 0.2s, border-color 0.2s, color 0.2s;
		flex-shrink: 0;
	}

	.step.done .step-dot {
		background: var(--ink, #1a1a1a);
		border-color: var(--ink, #1a1a1a);
		color: var(--paper, #f7f2ea);
	}

	.step.active .step-dot {
		border-color: var(--ink, #1a1a1a);
		color: var(--ink, #1a1a1a);
		font-weight: 700;
	}

	.step-num { line-height: 1; }

	.step-label {
		font-size: 0.72rem;
		font-weight: 500;
		color: #a09688;
		white-space: nowrap;
		transition: color 0.2s;
	}

	.step.active .step-label { color: var(--ink, #1a1a1a); font-weight: 600; }
	.step.done .step-label { color: #a09688; }

	.step-line {
		flex: 1;
		max-width: 80px;
		height: 2px;
		background: #ddd7cc;
		margin-bottom: 1.4rem; /* align with dots, not labels */
		transition: background 0.2s;
	}
	.step-line.filled { background: var(--ink, #1a1a1a); }

	main {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 1rem;
	}
</style>
