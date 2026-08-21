// One place to hand emote-renderer memory back, across every engine.
//
// There are two independent rasterisers holding large canvases — the WebGL
// worker atlas (skottie-stage-worker) and the CPU atlas (cpu-atlas) — and
// three moments worth releasing at: the picker closing, the app backgrounding,
// and iOS memory pressure.
//
// All three call sites used to name `skottie-stage-worker` directly. That was
// correct while the WebGL worker was the default engine, and silently stopped
// being correct the moment `cpu-rasterized` took over: every reclaim hook in
// the app was pointed at a renderer the device was no longer using, so the
// engine actually allocating never heard about any of them. Route through here
// so adding an engine means adding it in one place, not remembering three.

/**
 * Release atlas memory on every engine that has one.
 * @param {{ all?: boolean }} [opts] `all` also drops sizes with live cells —
 *   for backgrounding, where nothing is on screen to re-bake for. The default
 *   drops only what nothing is displaying, and is safe at any moment.
 */
export async function reclaimEmoteMemory({ all = false } = {}) {
	await Promise.allSettled([
		import('./skottie-stage-worker.js').then((m) => m.reclaimMemory?.({ all })),
		import('./cpu-atlas.js').then((m) => m.reclaimMemory?.({ all }))
	]);
}

/** Combined page/byte counts per engine — for confirming the budget holds. */
export async function emoteMemoryStats() {
	const out = {};
	try { out.cpu = (await import('./cpu-atlas.js')).atlasStats?.(); } catch {}
	return out;
}
