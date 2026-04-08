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
	define: {
		__BUILD_NUMBER__: JSON.stringify(count),
		__BUILD_SHA__: JSON.stringify(sha)
	},
	optimizeDeps: {
		exclude: ['@huggingface/transformers']
	},
	worker: {
		format: 'es'
	}
});
