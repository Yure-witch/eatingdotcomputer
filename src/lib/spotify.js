// Recognising Spotify links in a message, and reading the metadata Spotify
// already publishes about them.
//
// No API credentials anywhere: every field on the card comes from the Open
// Graph tags on the public page, which /api/link-meta already fetches and
// caches. A track page gives:
//
//   og:title        Never Gonna Give You Up
//   og:description  Rick Astley · Whenever You Need Somebody · Song · 1987
//   og:image        640×640 cover art
//
// The kinds Spotify puts behind /<kind>/<id>. `artist` has no track title, and
// `show`/`episode` are podcasts — all of them still make a perfectly good card.
const KINDS = ['track', 'album', 'playlist', 'artist', 'episode', 'show'];

const RE = new RegExp(
	String.raw`https?://(?:open|play)\.spotify\.com/(?:intl-[a-z-]+/)?(${KINDS.join('|')})/([A-Za-z0-9]{16,32})`,
	'i'
);

/**
 * First Spotify link in a string, or null.
 *
 * Returns a CANONICAL url built from the kind and id rather than the matched
 * text: shared links arrive carrying `?si=` tracking params and locale
 * prefixes, and two people sharing the same song should hit the same cache row
 * rather than two.
 */
export function parseSpotifyUrl(text) {
	const m = RE.exec(String(text ?? ''));
	if (!m) return null;
	const kind = m[1].toLowerCase();
	const id = m[2];
	return { kind, id, url: `https://open.spotify.com/${kind}/${id}` };
}

/**
 * Split Spotify's og:description into something a card can show.
 *
 * The shape varies by kind — "Rick Astley · Whenever You Need Somebody · Song ·
 * 1987" for a track, "Playlist · 50 songs" for a playlist — so rather than
 * guess at fixed positions, drop the parts that just restate the kind and keep
 * what's left. Whatever survives is the useful line.
 */
export function spotifySubtitle(description, kind) {
	const parts = String(description ?? '')
		.split('·')
		.map((p) => p.trim())
		.filter(Boolean);
	if (!parts.length) return '';
	const noise = new Set(['song', 'album', 'playlist', 'artist', 'episode', 'show', 'podcast', kind]);
	const kept = parts.filter((p) => !noise.has(p.toLowerCase()));
	return (kept.length ? kept : parts).join(' · ');
}

export const SPOTIFY_LABEL = {
	track: 'Song',
	album: 'Album',
	playlist: 'Playlist',
	artist: 'Artist',
	episode: 'Episode',
	show: 'Podcast'
};

/**
 * Trim Spotify's boilerplate off og:title.
 *
 * Tracks and playlists come back clean, but albums arrive as
 * "Whenever You Need Somebody - Album by Rick Astley | Spotify" — the artist is
 * already on the subtitle line, and the site name is already on the badge, so
 * repeating both inside the title just pushes the actual name out of view.
 */
export function spotifyTitle(raw) {
	let t = String(raw ?? '').trim();
	t = t.replace(/\s*[|·]\s*Spotify\s*$/i, '');
	// " - Album by X", " - EP by X", " - Single by X", " - song and lyrics by X"
	t = t.replace(/\s+-\s+(?:album|ep|single|compilation|mixtape|song and lyrics|podcast|episode)\s+by\s+.+$/i, '');
	return t.trim();
}
