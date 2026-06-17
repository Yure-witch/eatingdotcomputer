/**
 * Reaction tokens double as Firebase RTDB keys (reactions/{msgId}/{token}/{uid}).
 * Firebase forbids these characters in a key: . $ # [ ] /
 *
 * Plain-emoji reactions ('👍') contain none of them, so they encode to
 * themselves — fully backward-compatible with reactions already in Firebase.
 * But the rich-reaction tokens the expression picker emits all wrap their
 * payload in square brackets:
 *   [ek:…]  Emoji Kitchen mix
 *   [ce:…]  custom emote
 *   [tg:…]  Telegram animated/static emoji
 *   [tgc:…] Telegram custom-pack emoji
 * Those `[` / `]` (and any `/` inside a kitchen token) make Firebase reject the
 * write outright, which is why animated/custom emotes never showed up as
 * reactions. Encode the token at the Firebase boundary and decode it the moment
 * we read it back, so the rest of the app only ever deals in raw tokens.
 *
 * The scheme is a minimal percent-escape over just the forbidden set (plus `%`
 * itself so the decode is unambiguous). decodeURIComponent is NOT used because
 * it would also try to decode `%`-sequences that are really part of an emoji.
 */
const ENC = { '%': '%25', '.': '%2E', '$': '%24', '#': '%23', '[': '%5B', ']': '%5D', '/': '%2F' };
const DEC = { '%25': '%', '%2E': '.', '%24': '$', '%23': '#', '%5B': '[', '%5D': ']', '%2F': '/' };

/** Raw reaction token → Firebase-safe key. No-op for plain emoji. */
export function encodeReactionKey(token) {
	return String(token).replace(/[%.$#\[\]/]/g, (c) => ENC[c]);
}

/** Firebase-safe key → raw reaction token. Inverse of encodeReactionKey. */
export function decodeReactionKey(key) {
	return String(key).replace(/%25|%2E|%24|%23|%5B|%5D|%2F/g, (m) => DEC[m]);
}
