/** Deterministic conversation ID from two user IDs — same result regardless of order. */
export function getConvId(userId1, userId2) {
	return [userId1, userId2].sort().join('_');
}

export function convParticipants(convId) {
	const idx = convId.indexOf('_', 8); // UUIDs start with 8 chars before first hyphen
	return [convId.slice(0, idx), convId.slice(idx + 1)];
}
