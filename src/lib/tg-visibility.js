/**
 * Per-user "hide Telegram emoji" switch (users.hide_tg_emoji), set once by
 * the app layout on the client before any chat content renders. When on,
 * the expression picker hides its Telegram surfaces (Animated tab, Library
 * sub-tab) and message-render strips [tg:]/[tgc:] sticker tokens.
 *
 * Module state is only ever set in the browser — on the server it stays
 * false so one request can't leak the flag into another user's render.
 */
let hidden = false;

export function setTgHidden(value) {
	hidden = !!value;
}

export function isTgHidden() {
	return hidden;
}
