// Classic Web Worker hosting the rlottie WASM engine. Main thread parses the
// Lottie JSON itself (so it knows frameRate / totalFrames without needing extra
// WASM exports), then asks this worker for specific frame numbers; worker
// renders into an OffscreenCanvas and ships back transferable ImageBitmaps.
//
// rlottie-wasm exports we use:
//   _lottie_init() -> handle
//   _lottie_load_from_data(handle, jsonPtr, jsonSize)
//   _lottie_resize(handle, w, h)
//   _lottie_render(handle, frame)
//   _lottie_buffer(handle) -> RGBA8 byte ptr (length = w*h*4)
//   _lottie_destroy(handle)

let wasmReady = false;
const pending = [];
const handles = new Map(); // id -> { handle, w, h, canvas, ctx }

self.Module = {
	locateFile: (path) => path,           // .wasm lives next to .js here
	onRuntimeInitialized: () => {
		wasmReady = true;
		while (pending.length) handle(pending.shift());
		self.postMessage({ type: 'ready' });
	}
};
importScripts('rlottie-wasm.js');

function mount({ id, json, w, h }) {
	try {
		const handle = Module._lottie_init();
		const bytes = new TextEncoder().encode(json);
		const ptr = Module._malloc(bytes.length + 1);
		Module.HEAPU8.set(bytes, ptr);
		Module.HEAPU8[ptr + bytes.length] = 0;
		Module._lottie_load_from_data(handle, ptr, bytes.length);
		Module._free(ptr);
		Module._lottie_resize(handle, w, h);
		const canvas = new OffscreenCanvas(w, h);
		const ctx = canvas.getContext('2d');
		handles.set(id, { handle, w, h, canvas, ctx });
		self.postMessage({ type: 'mounted', id });
	} catch (e) {
		self.postMessage({ type: 'mount_error', id, message: String(e && e.message || e) });
	}
}

function renderFrame({ id, frame }) {
	const slot = handles.get(id);
	if (!slot) return;
	const { handle, w, h, ctx, canvas } = slot;
	try {
		Module._lottie_render(handle, frame);
		const bufPtr = Module._lottie_buffer(handle);
		const pixels = new Uint8ClampedArray(Module.HEAPU8.buffer, bufPtr, w * h * 4);
		// Copy out of the WASM heap before next render mutates it.
		const img = new ImageData(new Uint8ClampedArray(pixels), w, h);
		ctx.putImageData(img, 0, 0);
		const bitmap = canvas.transferToImageBitmap();
		self.postMessage({ type: 'frame', id, frame, bitmap }, [bitmap]);
	} catch (e) {
		// Include `frame` so the pool can fail the specific waiting request
		// and decrement the inflight counter, instead of stalling the queue.
		self.postMessage({ type: 'error', id, frame, message: String(e && e.message || e) });
	}
}

function destroy({ id }) {
	const slot = handles.get(id);
	if (!slot) return;
	try { Module._lottie_destroy(slot.handle); } catch {}
	handles.delete(id);
}

function handle(data) {
	switch (data.type) {
		case 'mount':   return mount(data);
		case 'render':  return renderFrame(data);
		case 'destroy': return destroy(data);
	}
}

self.addEventListener('message', (e) => {
	if (wasmReady) handle(e.data);
	else pending.push(e.data);
});
