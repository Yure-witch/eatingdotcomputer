/**
 * Force WKWebView to flush a paint after a client-side navigation.
 *
 * On the iOS shell, tapping a conversation updated the DOM but left the
 * PREVIOUS screen's pixels on display: the header (its own compositing layer)
 * showed the new conversation's name while the body underneath still showed
 * the chat list. Nothing was broken in the app — the route had loaded, the
 * messages were there, Firebase was connected — WebKit simply never composited
 * the changed layer. Opening the app switcher and coming back fixed it every
 * time, because that forces the web view to re-composite from scratch. That is
 * the tell: a stale paint, not stale data.
 *
 * The kick is a transform on the scrolling container for exactly one frame.
 * `translateZ(0)` moves nothing visually but does promote the element and
 * invalidate its layer, which is what makes WebKit paint it. Removed on the
 * next frame so nothing keeps a promoted layer alive (a permanent
 * `will-change`/transform here would also make the element a containing block
 * for its fixed-position descendants — the docked picker anchors to the
 * viewport and must stay that way; see the .input-area note in app.css).
 *
 * Native shell only. Every other browser repaints correctly, and a no-op
 * transform is still a layer promotion nobody else needs to pay for.
 */

/** The Capacitor shell marks the document; the UA is the belt-and-braces. */
export function isNativeShell() {
	if (typeof document === 'undefined') return false;
	return document.body?.classList.contains('native-app')
		|| /eatingcomputer-native/.test(navigator.userAgent);
}

/**
 * @param {Element | null} el element whose layer to invalidate; defaults to
 *                            the document body.
 */
export function kickRepaint(el = null) {
	if (typeof window === 'undefined' || !isNativeShell()) return;
	const target = el ?? document.body;
	if (!target) return;
	// Two frames: one to apply, one to take it away. Applying and removing in
	// the same frame is coalesced by the engine into no change at all, which
	// is the whole problem we're working around.
	requestAnimationFrame(() => {
		const previous = target.style.transform;
		target.style.transform = 'translateZ(0)';
		requestAnimationFrame(() => {
			target.style.transform = previous;
		});
	});
}
