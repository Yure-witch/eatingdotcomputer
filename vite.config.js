import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'child_process';

function gitInfo() {
	try {
		const count = execSync('git rev-list --count HEAD').toString().trim();
		const sha = execSync('git rev-parse --short HEAD').toString().trim();
		return { count, sha };
	} catch {
		return { count: '0', sha: 'unknown' };
	}
}

const { count, sha } = gitInfo();

// The Emo SDK fetches its core from `new URL("EmoWeb.wasm", import.meta.url)`
// with no load option to override it; point that at our R2 build with usage
// key-generation, storage and reporting code removed (vendor/emo/tools/patch-usage.mjs).
// The immutable URL's revision prevents reuse of the original reporting build.
function emoWasmFromR2() {
	const needle = 'new URL("EmoWeb.wasm", import.meta.url)';
	const url = 'https://pub-62e59b4ebf1d45d2ad5f669369e907fe.r2.dev/vendor/emo/sdk-3.1.0-no-usage-v2/EmoWeb.wasm';
	return {
		name: 'emo-wasm-from-r2',
		enforce: 'pre',
		transform(code, id) {
			if (!id.includes('@desert-ant-labs/emo/dist/index.js')) return;
			if (!code.includes(needle)) throw new Error('emo-wasm-from-r2: EmoWeb.wasm loader changed — update the plugin');
			return code.replace(needle, JSON.stringify(url));
		}
	};
}

export default defineConfig({
	plugins: [emoWasmFromR2(), sveltekit()],
	server: {
		// Dev only. Vite rejects requests whose Host header it does not
		// recognise, which blocks tunnelling the dev server to a phone for
		// real-device testing (Safari's bottom address bar and mobile Chrome's
		// toolbar cannot be emulated in a headless browser). Not used by the
		// production build — `vite build` ignores `server`.
		allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.loca.lt']
	},
	define: {
		__BUILD_NUMBER__: JSON.stringify(count),
		__BUILD_SHA__: JSON.stringify(sha)
	},
	optimizeDeps: {
		// Emo must stay out of pre-bundling so emoWasmFromR2 can rewrite it.
		exclude: ['@huggingface/transformers', '@desert-ant-labs/emo']
	},
	ssr: {
		// `@material/material-color-utilities` ships extension-less
		// internal imports (e.g. `./dynamiccolor/dynamic_scheme`)
		// which Node's strict ESM resolver rejects during SSR. Letting
		// Vite bundle it ourselves bypasses Node's resolver entirely.
		noExternal: ['@material/material-color-utilities']
	},
	worker: {
		format: 'es'
	}
});
