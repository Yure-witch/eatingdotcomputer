<script>
	// Renders the Manage → Activity presence chart in isolation with mock data,
	// so it can be eyeballed (and checked at a phone width) without an
	// instructor login or real class activity. Guarded to dev in +page.server.js.
	import ActivityChart from '$lib/components/ActivityChart.svelte';

	const RANGES = [
		{ key: '12h', label: '12hr', hours: 12 },
		{ key: '1d', label: '1d', hours: 24 },
		{ key: '7d', label: '7d', hours: 24 * 7 },
		{ key: '1m', label: '1m', days: 30 },
		{ key: '6m', label: '6m', days: 180 }
	];
	let rangeKey = $state('7d');
	const range = $derived(RANGES.find((r) => r.key === rangeKey));

	// A fixed "now" so the mock renders the same on every reload.
	const now = Date.UTC(2026, 8, 16, 15, 0, 0);

	const members = [
		{ id: 'u1', name: 'Jess Kuronen' },
		{ id: 'u2', name: 'Yuval Amir' },
		{ id: 'u3', name: 'Harel Cohen' },
		{ id: 'u4', name: 'Sam Okafor' },
		{ id: 'u5', name: 'Ada Lin' },
		{ id: 'u6', name: 'Kai Mendez' },
		{ id: 'u7', name: 'Noor Haddad' } // never online — an empty lane on purpose
	];

	// Rough class shapes: evenings, a night owl, a weekday-only student, someone
	// who showed up once, someone who never did.
	const SHAPES = {
		u1: (h, day) => (h >= 18 && h <= 23) || (h >= 13 && h <= 15 && day % 2 === 0),
		u2: (h) => h >= 22 || h <= 3,
		u3: (h, day) => day < 5 && h >= 9 && h <= 17 && h % 2 === 0,
		u4: (h, day) => day === 3 && h >= 14 && h <= 16,
		u5: (h) => h === 12 || h === 20,
		u6: (h, day) => (day + h) % 7 === 0
	};

	const series = $derived.by(() => {
		const hourly = !!range.hours;
		const buckets = [];
		if (hourly) {
			const end = Math.floor(now / 3600_000) * 3600_000;
			for (let t = end - (range.hours - 1) * 3600_000; t <= end; t += 3600_000) buckets.push(t);
		} else {
			const end = Math.floor(now / 86400_000) * 86400_000;
			for (let i = range.days - 1; i >= 0; i--) buckets.push(end - i * 86400_000);
		}
		return members
			.filter((m) => SHAPES[m.id])
			.map((m) => ({
				userId: m.id,
				name: m.name,
				points: buckets
					.filter((t) => SHAPES[m.id](new Date(t).getUTCHours(), new Date(t).getUTCDay()))
					.map((t) => ({
						bucket: hourly
							? new Date(t).toISOString().slice(0, 13) + ':00'
							: new Date(t).toISOString().slice(0, 10),
						count: 1 + (new Date(t).getUTCHours() % 5)
					}))
			}));
	});
</script>

<div class="wrap">
	<h1>Activity chart harness</h1>
	<p class="note">Mock data, fixed clock. The real one lives in Manage → Activity.</p>

	<div class="range-tabs">
		{#each RANGES as r}
			<button class="range-tab" class:active={rangeKey === r.key} onclick={() => (rangeKey = r.key)}>{r.label}</button>
		{/each}
	</div>

	<section>
		<ActivityChart {series} {range} {members} {now} />
	</section>

	<h2>Phone width</h2>
	<section class="narrow">
		<ActivityChart {series} {range} {members} {now} />
	</section>
</div>

<style>
	.wrap { padding: 1.25rem; max-width: 900px; margin: 0 auto; font-family: 'Google Sans Flex', system-ui, sans-serif; }
	h1 { font-size: 1.1rem; margin: 0; }
	h2 { font-size: 0.85rem; margin: 1.5rem 0 0; color: var(--muted-fg); }
	.note { font-size: 0.8rem; color: var(--muted-fg); margin: 0.25rem 0 1rem; }
	section { background: var(--paper); border: 1px solid var(--border); border-radius: 10px; padding: 0.75rem; }
	.narrow { max-width: 360px; }
	.range-tabs { display: flex; gap: 0.25rem; margin-bottom: 0.75rem; }
	.range-tab {
		font: inherit; font-size: 0.75rem; padding: 0.2rem 0.55rem; border-radius: 999px;
		border: 1px solid var(--border); background: var(--paper); color: var(--muted-fg); cursor: pointer;
	}
	.range-tab.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
</style>
