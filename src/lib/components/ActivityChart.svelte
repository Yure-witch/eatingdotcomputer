<script>
	/**
	 * Who was online, when — one horizontal lane per student, a bar in every
	 * time bucket they were active and nothing when they weren't, so the gaps
	 * are what you read. Extracted from Manage → Activity (it was a per-user
	 * line chart of message counts, which answered "how chatty" rather than
	 * "who's around"); `/dev-chart` renders it with synthetic data.
	 *
	 * Props:
	 *   series   [{ userId, name, points: [{ bucket, count }] }] — bucket keys
	 *            are UTC 'YYYY-MM-DDTHH:00' (hourly) or 'YYYY-MM-DD' (daily).
	 *   range    { key, hours } | { key, days } — the window to draw.
	 *   members  [{ id, name }] — everyone who should have a lane, including
	 *            people with no activity at all (an empty lane is an answer).
	 *   now      epoch ms, injectable so the harness renders deterministically.
	 */
	let { series = [], range, members = [], now = Date.now() } = $props();

	const W = 480;
	const PAD = 4;
	const LABEL_W = 62;      // name column
	const TOTAL_W = 34;      // "12h online" column on the right
	const ROW_H = 30;        // lane
	const BAR_INSET = 10;    // bar is the lane less this, so 10px of air
	const BAR_GAP = 0.5;
	const AXIS_H = 18;       // timestamp keys along the bottom

	let hoverIdx = $state(null);
	let hoverPct = $state(0);

	const chart = $derived.by(() => {
		if (!range) return { rows: [], buckets: [], ticks: [], days: [], bandW: 0, barW: 0, lanesH: ROW_H, svgH: ROW_H };
		const hourly = !!range.hours;

		// Every bucket in the window is on the axis, not just the ones somebody
		// was active in — a gap can only mean "offline" if the empty buckets
		// take up their own space. Keys are built in UTC, like the server's.
		const buckets = [];
		if (hourly) {
			const end = Math.floor(now / 3600_000) * 3600_000;
			for (let t = end - (range.hours - 1) * 3600_000; t <= end; t += 3600_000) {
				buckets.push(new Date(t).toISOString().slice(0, 13) + ':00');
			}
		} else {
			const end = Math.floor(now / 86400_000) * 86400_000;
			for (let i = range.days - 1; i >= 0; i--) {
				buckets.push(new Date(end - i * 86400_000).toISOString().slice(0, 10));
			}
		}
		const inWindow = new Set(buckets);

		// A lane for every member, active or not: "never showed up this week" is
		// the answer an instructor is usually looking for, and it can only be
		// read off the chart if the person has a lane to be empty.
		const byUser = new Map(series.map((u) => [u.userId, u]));
		const lanes = members.map((m) => {
			const points = (byUser.get(m.id)?.points ?? []).filter((p) => inWindow.has(p.bucket));
			return {
				userId: m.id,
				name: m.name || '—',
				byBucket: new Map(points.map((p) => [p.bucket, p.count])),
				live: points.length
			};
		});
		for (const u of series) {
			if (!members.some((m) => m.id === u.userId)) {
				const points = u.points.filter((p) => inWindow.has(p.bucket));
				lanes.push({ userId: u.userId, name: u.name, byBucket: new Map(points.map((p) => [p.bucket, p.count])), live: points.length });
			}
		}
		// Busiest first; everyone with nothing sinks to the bottom, alphabetical.
		lanes.sort((a, b) => b.byBucket.size - a.byBucket.size || a.name.localeCompare(b.name));

		const chartW = W - LABEL_W - TOTAL_W - PAD * 2;
		const bandW = chartW / Math.max(buckets.length, 1);
		// A single online hour still has to be visible on a 7-day axis.
		const barW = Math.max(bandW - BAR_GAP, 1.5);
		const barH = ROW_H - BAR_INSET;

		const rows = lanes.map((lane, i) => {
			const rowTop = i * ROW_H;
			return {
				...lane,
				rowY: rowTop,
				labelY: rowTop + ROW_H / 2 + 3,
				barY: rowTop + BAR_INSET / 2,
				barH,
				bars: buckets
					.map((b, bi) => ({ bucket: b, count: lane.byBucket.get(b) ?? 0, x: LABEL_W + PAD + bi * bandW }))
					.filter((bar) => bar.count > 0)
			};
		});

		// ~6 timestamp keys, and (on hourly ranges) a hairline at each local
		// midnight so a week of hours still reads as days.
		const tickEvery = Math.max(1, Math.ceil(buckets.length / 6));
		const ticks = buckets
			.map((b, bi) => ({ bucket: b, x: LABEL_W + PAD + (bi + 0.5) * bandW, i: bi }))
			.filter((t) => t.i % tickEvery === 0);
		const days = hourly
			? buckets
				.map((b, bi) => ({ x: LABEL_W + PAD + bi * bandW, midnight: new Date(b + ':00Z').getHours() === 0, i: bi }))
				.filter((d) => d.midnight && d.i > 0)
			: [];

		const lanesH = Math.max(rows.length, 1) * ROW_H;
		return { rows, buckets, ticks, days, bandW, barW, lanesH, svgH: lanesH + AXIS_H };
	});

	/** Axis keys: hour (with the weekday once the range spans days), or date. */
	function formatTick(bucket) {
		if (!bucket) return '';
		if (bucket.includes('T')) {
			const d = new Date(bucket + ':00Z');
			const hour = d.toLocaleString('en-US', { hour: 'numeric', hour12: true }).replace(' ', '').toLowerCase();
			return range.hours > 24 ? `${d.toLocaleString('en-US', { weekday: 'short' })} ${hour}` : hour;
		}
		const [y, m, d] = bucket.split('-').map(Number);
		return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	/** Tooltip heading — the full timestamp for the hovered bucket. */
	function formatBucket(bucket) {
		if (!bucket) return '';
		if (bucket.includes('T')) {
			return new Date(bucket + ':00Z').toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true });
		}
		const [y, m, d] = bucket.split('-').map(Number);
		return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	/** "9h" / "4d" — how much of the window the student was around for. */
	function laneTotal(row) {
		return row.byBucket.size ? `${row.byBucket.size}${range.hours ? 'h' : 'd'}` : '—';
	}

	function handleMouseMove(e) {
		const rect = e.currentTarget.getBoundingClientRect();
		const svgX = ((e.clientX - rect.left) / rect.width) * W;
		if (!chart.buckets.length) return;
		const raw = Math.floor((svgX - LABEL_W - PAD) / (chart.bandW || 1));
		hoverIdx = raw < 0 || raw >= chart.buckets.length ? null : raw;
		hoverPct = (e.clientX - rect.left) / rect.width;
	}
	function handleMouseLeave() { hoverIdx = null; }
</script>

<div class="activity-chart">
	{#if chart.rows.length}
		<svg
			viewBox="0 0 {W} {chart.svgH}" width="100%" height={chart.svgH}
			class="chart-svg" role="img"
			aria-label="Who was online over time, one lane per student"
			onmousemove={handleMouseMove}
			onmouseleave={handleMouseLeave}
		>
			<!-- Lanes. A hairline track rather than a filled stripe: a zebra
			     stripe the width of the chart reads as a full-width bar, so an
			     empty lane looked like a student who was online the whole time. -->
			{#each chart.rows as row (row.userId)}
				<line
					x1={LABEL_W + PAD} y1={row.rowY + ROW_H / 2}
					x2={W - TOTAL_W - PAD} y2={row.rowY + ROW_H / 2}
					stroke="var(--border)" stroke-width="1"
				/>
				<text x={LABEL_W - 6} y={row.labelY} text-anchor="end" font-size="9" fill="var(--ink)" class:faded={!row.live}>
					{row.name.split(' ')[0]}
				</text>
				<text x={W - 4} y={row.labelY} text-anchor="end" font-size="8" fill="var(--muted-fg)">{laneTotal(row)}</text>
			{/each}

			<!-- Day boundaries (hourly ranges only) -->
			{#each chart.days as d}
				<line x1={d.x.toFixed(2)} y1={0} x2={d.x.toFixed(2)} y2={chart.lanesH} stroke="var(--border)" stroke-width="0.5" />
			{/each}

			<!-- Column rules -->
			<line x1={LABEL_W} y1={0} x2={LABEL_W} y2={chart.lanesH} stroke="var(--border)" stroke-width="0.75" />
			<line x1={W - TOTAL_W} y1={0} x2={W - TOTAL_W} y2={chart.lanesH} stroke="var(--border)" stroke-width="0.75" />

			<!-- Presence bars: online = bar, offline = nothing. One colour —
			     the lane already says who, so a hue per person added noise. -->
			{#each chart.rows as row (row.userId)}
				{#each row.bars as bar (bar.bucket)}
					<rect x={bar.x.toFixed(2)} y={row.barY} width={chart.barW.toFixed(2)} height={row.barH} rx="0.75" fill="var(--chart-bar, hsl(200 55% 42%))" />
				{/each}
			{/each}

			<!-- Timestamp keys -->
			<line x1={LABEL_W} y1={chart.lanesH} x2={W - TOTAL_W} y2={chart.lanesH} stroke="var(--border)" stroke-width="0.75" />
			{#each chart.ticks as t (t.bucket)}
				<line x1={t.x.toFixed(2)} y1={chart.lanesH} x2={t.x.toFixed(2)} y2={chart.lanesH + 3} stroke="var(--border)" stroke-width="0.75" />
				<text x={t.x.toFixed(2)} y={chart.lanesH + 12} text-anchor="middle" font-size="7.5" fill="var(--muted-fg)">{formatTick(t.bucket)}</text>
			{/each}

			<!-- Hover crosshair -->
			{#if hoverIdx !== null}
				{@const bx = (LABEL_W + PAD + (hoverIdx + 0.5) * chart.bandW).toFixed(1)}
				<line x1={bx} y1={0} x2={bx} y2={chart.lanesH} stroke="rgba(0,0,0,0.25)" stroke-width="0.75" stroke-dasharray="2,2" />
			{/if}
		</svg>

		{#if hoverIdx !== null}
			{@const bucket = chart.buckets[hoverIdx]}
			{@const online = chart.rows.filter((r) => (r.byBucket.get(bucket) ?? 0) > 0)}
			<div class="chart-tooltip" style="left: {Math.min(Math.max(hoverPct * 100, 15), 75)}%">
				<div class="tooltip-date">{formatBucket(bucket)}</div>
				{#each online as row (row.userId)}
					<div class="tooltip-row"><span class="tooltip-dot"></span><span>{row.name.split(' ')[0]}</span></div>
				{/each}
				{#if !online.length}<div class="tooltip-row tooltip-none">Nobody online</div>{/if}
			</div>
		{/if}
	{:else}
		<p class="chart-empty">No activity in this period.</p>
	{/if}
</div>

<style>
	.activity-chart { margin-top: 0.75rem; position: relative; }
	.chart-svg { width: 100%; display: block; border-radius: 6px; cursor: crosshair; }
	/* A lane with nothing in it still names its student, just more quietly. */
	.faded { fill: var(--muted-fg); }
	.chart-tooltip {
		position: absolute; top: 0.25rem; transform: translateX(-50%);
		background: var(--paper); border: 1px solid var(--border); border-radius: 8px;
		padding: 0.4rem 0.55rem; font-size: 0.72rem; pointer-events: none;
		box-shadow: 0 6px 18px -10px rgba(0,0,0,0.4); z-index: 3; min-width: 96px;
	}
	.tooltip-date { font-weight: 600; margin-bottom: 0.2rem; white-space: nowrap; }
	.tooltip-row { display: flex; align-items: center; gap: 0.35rem; line-height: 1.5; }
	.tooltip-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--chart-bar, hsl(200 55% 42%)); flex-shrink: 0; }
	.tooltip-none { color: var(--muted-fg); }
	.chart-empty { font-size: 0.85rem; color: var(--muted-fg); margin: 0.5rem 0 0; }
</style>
