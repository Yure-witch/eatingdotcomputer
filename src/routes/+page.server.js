import { redirect } from '@sveltejs/kit';

export async function load({ locals, request }) {
	// Already signed in → skip the marketing landing and go straight to the app.
	// This is what lets the native app (which opens at "/") land directly in /app
	// instead of the login screen, so you don't have to tap "Log in" every launch.
	const session = await locals.auth();
	if (session) redirect(302, '/app');

	// Inside the native shell there's no marketing story to tell — an
	// unauthenticated launch should open the login form directly rather than a
	// landing page whose only action is a "log in" chip. Keyed off the shell's
	// appended user agent (see capacitor.config.ts); a plain browser still gets
	// the landing page.
	const ua = request.headers.get('user-agent') ?? '';
	if (ua.includes('eatingcomputer-native')) redirect(302, '/login');
}
