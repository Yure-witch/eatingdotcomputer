// Shared file-attachment helpers. Extracted so the message-attachment
// component (used by threads, react-previews, etc.) matches the inline
// copies in the channel/DM chat pages without re-deriving the same logic.

export function formatSize(bytes) {
	if (!bytes) return '';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const isDocxFile = (filename) => (filename ?? '').split('.').pop()?.toLowerCase() === 'docx';

const VIEWABLE_EXTS = new Set(['js','mjs','cjs','ts','tsx','jsx','py','html','htm','css','json','md','txt','csv','sql','sh','bash','env','yml','yaml','xml','svg','toml','ini','cfg','conf','log','c','h','cpp','hpp','rs','go','java','swift','svelte','vue','rb','php','pl','r','lua','kt','scala','ex','exs','hs','ml','clj','dockerfile','makefile','gitignore','env.example','env.local']);
const MAX_VIEW_SIZE = 500 * 1024; // 500 KB
const MAX_DOC_VIEW_SIZE = 15 * 1024 * 1024; // 15 MB — docx renders in-app via mammoth

export function isViewableFile(filename, mimetype, size) {
	if (isDocxFile(filename)) return size <= MAX_DOC_VIEW_SIZE;
	if (size > MAX_VIEW_SIZE) return false;
	if (mimetype?.startsWith('text/')) return true;
	if (mimetype === 'application/json' || mimetype === 'application/xml') return true;
	const ext = (filename ?? '').split('.').pop()?.toLowerCase();
	return VIEWABLE_EXTS.has(ext) || VIEWABLE_EXTS.has(filename?.toLowerCase());
}

const _langMap = { js:'javascript', mjs:'javascript', cjs:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript', py:'python', html:'html', htm:'html', css:'css', json:'json', md:'markdown', txt:'plaintext', csv:'csv', sql:'sql', sh:'bash', bash:'bash', env:'env', yml:'yaml', yaml:'yaml', xml:'xml', svg:'xml', toml:'ini', ini:'ini', cfg:'ini', conf:'ini', log:'plaintext', c:'cpp', h:'cpp', cpp:'cpp', hpp:'cpp', rs:'rust', go:'go', java:'java', swift:'swift', svelte:'html', vue:'html', rb:'ruby', php:'php', r:'r', lua:'lua' };
export function langFromFilename(filename) {
	const ext = (filename ?? '').split('.').pop()?.toLowerCase();
	return _langMap[ext] ?? 'plaintext';
}

const FILE_TYPE_NAMES = { js:'JavaScript file', mjs:'JavaScript file', cjs:'JavaScript file', jsx:'JSX file', ts:'TypeScript file', tsx:'TSX file', py:'Python file', html:'HTML file', htm:'HTML file', css:'CSS file', json:'JSON file', md:'Markdown file', txt:'Text file', csv:'CSV file', sql:'SQL file', sh:'Shell script', bash:'Shell script', env:'Environment file', yml:'YAML file', yaml:'YAML file', xml:'XML file', svg:'SVG file', toml:'TOML file', ini:'Config file', cfg:'Config file', conf:'Config file', log:'Log file', c:'C file', h:'C header', cpp:'C++ file', hpp:'C++ header', rs:'Rust file', go:'Go file', java:'Java file', swift:'Swift file', svelte:'Svelte file', vue:'Vue file', rb:'Ruby file', php:'PHP file', lua:'Lua file', kt:'Kotlin file', pdf:'PDF document', zip:'ZIP archive', gz:'GZIP archive', tar:'TAR archive', png:'PNG image', jpg:'JPEG image', jpeg:'JPEG image', gif:'GIF image', webp:'WebP image', mp4:'MP4 video', mov:'MOV video', mp3:'MP3 audio', wav:'WAV audio' };
export function fileTypeName(filename) {
	const ext = (filename ?? '').split('.').pop()?.toLowerCase();
	return FILE_TYPE_NAMES[ext] ?? null;
}

// Download via the CORS-dodging proxy; fall back to opening the URL.
export async function downloadFile(url, filename) {
	try {
		const r = await fetch(`/api/file-proxy?url=${encodeURIComponent(url)}`);
		const blob = await r.blob();
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = filename;
		a.click();
		URL.revokeObjectURL(a.href);
	} catch { window.open(url, '_blank'); }
}
