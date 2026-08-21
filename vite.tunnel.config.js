// TEMPORARY dev config for HTTPS tunnel testing on a phone.
//
// Separate from vite.config.js on purpose: other sessions run dev servers off
// the shared config, and `server.allowedHosts` is only meaningful for whoever
// is tunnelling. Run with:  npx vite dev --config vite.tunnel.config.js
//
// Delete alongside /renderprobe and EmoteProfiler.
import base from './vite.config.js';

export default {
	...base,
	server: {
		...(base.server || {}),
		host: '0.0.0.0',
		port: 5199,
		strictPort: true,
		// Cloudflare quick tunnels get a random *.trycloudflare.com name each
		// run, so allow the whole suffix rather than pinning one hostname.
		allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', 'localhost'],
		// The tunnel terminates TLS, so the HMR socket has to be told it is
		// behind https on 443 or the client tries ws:// on the dev port and
		// silently never reconnects.
		hmr: { clientPort: 443, protocol: 'wss' }
	}
};
