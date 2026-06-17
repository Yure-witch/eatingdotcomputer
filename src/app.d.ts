declare const __BUILD_NUMBER__: string;
declare const __BUILD_SHA__: string;

// Shape of the object returned by handleError (hooks.server.js) → `$page.error`.
declare global {
	namespace App {
		interface Error {
			message: string;
			code?: string;
			detail?: string;
		}
	}
}

export {};
