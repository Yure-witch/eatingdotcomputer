// Shared loader for CanvasKit (Skia compiled to WASM). Async-initialised once
// and reused across all SkottieSticker components. ~7.7 MB binary is fetched
// from /canvaskit/canvaskit.wasm and cached by the browser forever after.
//
// Note: we import from `canvaskit-wasm/bin/full/canvaskit.js` (NOT the default
// entrypoint) because Skottie (`MakeAnimation`, `MakeManagedAnimation`) lives
// only in the "full" build. The default slim build's `MakeAnimation` is
// undefined — calling it throws "MakeAnimation is not a function".
// The corresponding canvaskit.wasm in /static/canvaskit/ is also the full one.
import CanvasKitInit from 'canvaskit-wasm/full';

let _canvasKitPromise = null;

export function loadCanvasKit() {
	if (_canvasKitPromise) return _canvasKitPromise;
	_canvasKitPromise = CanvasKitInit({
		locateFile: (file) => `/canvaskit/${file}`
	});
	return _canvasKitPromise;
}
