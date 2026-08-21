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

export default defineConfig({
	plugins: [sveltekit()],
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
		exclude: ['@huggingface/transformers']
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
