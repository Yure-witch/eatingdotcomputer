// Work Archive — rules shared by the server (validation, presigning) and the
// browser uploader on /app/archive. The agent-facing spec lives in
// static/work-archive/PROTOCOL.md; keep the two in step when changing either.

export const ARCHIVE_SCHEMA = 'eating.computer/work-archive@1';
export const MANIFEST_PATH = 'manifest.json';
export const ARCHIVE_ORIGIN = 'https://www.eating.computer';
export const PROTOCOL_URL = `${ARCHIVE_ORIGIN}/work-archive/PROTOCOL.md`;

const MB = 1024 * 1024;

/** Extension → [content type, kind]. The SERVER picks the content type from
 *  the extension; the uploader must PUT with exactly the type it is handed. */
export const ARCHIVE_TYPES = {
	png: ['image/png', 'image'],
	jpg: ['image/jpeg', 'image'],
	jpeg: ['image/jpeg', 'image'],
	webp: ['image/webp', 'image'],
	gif: ['image/gif', 'image'],
	avif: ['image/avif', 'image'],
	svg: ['image/svg+xml', 'image'],
	heic: ['image/heic', 'image'],
	mp4: ['video/mp4', 'video'],
	webm: ['video/webm', 'video'],
	mov: ['video/quicktime', 'video'],
	pdf: ['application/pdf', 'pdf'],
	md: ['text/markdown', 'text'],
	txt: ['text/plain', 'text']
};

export const ARCHIVE_LIMITS = {
	maxFiles: 2000,
	maxTotalBytes: 3 * 1024 * MB,
	maxBytes: { image: 30 * MB, video: 250 * MB, pdf: 50 * MB, text: 5 * MB, manifest: 10 * MB },
	presignBatch: 50,
	presignTtlSeconds: 900
};

export const PROJECT_STATUSES = ['idea', 'prototype', 'in_progress', 'shipped', 'paused', 'abandoned'];
export const ATTRIBUTIONS = ['full_name', 'first_name', 'initials', 'anonymous'];

/**
 * A path inside the archive, normalised, or null when it isn't acceptable.
 * Relative POSIX paths of [A-Za-z0-9._-] segments only — no spaces, no
 * dot-segments, no hidden files — because the path becomes part of an R2 key
 * and a public URL.
 */
export function normalizeArchivePath(raw) {
	if (typeof raw !== 'string') return null;
	let p = raw.trim().replace(/\\/g, '/');
	while (p.startsWith('./')) p = p.slice(2);
	if (!p || p.length > 200 || p.startsWith('/') || p.includes('//')) return null;
	const segs = p.split('/');
	if (segs.length > 6) return null;
	for (const s of segs) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s)) return null;
		if (s.includes('..')) return null;
	}
	return p;
}

/** { contentType, kind } for a normalised path, or null if the type isn't accepted. */
export function typeForPath(path) {
	if (path === MANIFEST_PATH) return { contentType: 'application/json', kind: 'manifest' };
	const ext = (path.split('.').pop() ?? '').toLowerCase();
	const t = ARCHIVE_TYPES[ext];
	return t ? { contentType: t[0], kind: t[1] } : null;
}

// Where the manifest points at uploaded files. Deliberately a fixed set of
// keys rather than "any string ending in .png": a project's technical notes
// can legitimately mention README.md or logo.png without meaning an upload.
const REF_KEYS = new Set(['path', 'src', 'hero_asset', 'cover', 'thumbnail', 'portrait', 'image', 'asset']);
const REF_LIST_KEYS = new Set(['assets', 'images', 'media', 'gallery']);

/** Every uploaded-file reference in the manifest → Map(path → first JSON location). */
export function collectAssetRefs(manifest) {
	const refs = new Map();
	const add = (v, at) => {
		if (typeof v !== 'string' || !v.trim() || v.includes('://') || v.startsWith('data:')) return;
		const p = normalizeArchivePath(v) ?? v.trim();
		if (!refs.has(p)) refs.set(p, at);
	};
	const walk = (node, at, listKey) => {
		if (Array.isArray(node)) {
			node.forEach((v, i) => {
				if (listKey && typeof v === 'string') add(v, `${at}[${i}]`);
				else walk(v, `${at}[${i}]`, null);
			});
		} else if (node && typeof node === 'object') {
			for (const [k, v] of Object.entries(node)) {
				const here = at ? `${at}.${k}` : k;
				if (REF_KEYS.has(k) && typeof v === 'string') add(v, here);
				else walk(v, here, REF_LIST_KEYS.has(k));
			}
		}
	};
	walk(manifest, '', false);
	return refs;
}

/**
 * Given a flat list of { path, file } (from a folder pick or an unzipped
 * archive), find manifest.json and re-root every other file relative to it.
 * Drops OS junk (__MACOSX, .DS_Store) and anything outside the manifest's
 * folder. Returns { root, files, skipped } or { error }.
 */
export function rerootArchiveFiles(entries) {
	const clean = entries.filter(({ path }) => !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(path));
	const manifests = clean.filter(({ path }) => path === MANIFEST_PATH || path.endsWith('/' + MANIFEST_PATH));
	if (!manifests.length) return { error: 'No manifest.json found. The archive needs a manifest.json at its top level.' };
	// The shallowest manifest wins (a project folder might contain its own).
	manifests.sort((a, b) => a.path.split('/').length - b.path.split('/').length);
	const root = manifests[0].path.slice(0, -MANIFEST_PATH.length);
	const files = [];
	const skipped = [];
	for (const e of clean) {
		if (!e.path.startsWith(root)) { skipped.push({ path: e.path, reason: 'outside the archive folder' }); continue; }
		const rel = normalizeArchivePath(e.path.slice(root.length));
		if (!rel) { skipped.push({ path: e.path, reason: 'name has spaces or unsupported characters' }); continue; }
		const type = typeForPath(rel);
		if (!type) { skipped.push({ path: e.path, reason: 'file type not accepted' }); continue; }
		files.push({ ...e, path: rel, ...type });
	}
	return { root, files, skipped };
}
