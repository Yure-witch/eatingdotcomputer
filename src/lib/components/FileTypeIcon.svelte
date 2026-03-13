<script>
	/**
	 * Renders a file-type icon:
	 * - Images with a URL get a thumbnail
	 * - Everything else gets a coloured extension badge
	 *
	 * Props:
	 *   filename  – original file name (used for extension detection)
	 *   mimetype  – MIME type string
	 *   url       – (optional) public URL; enables thumbnail for images
	 *   iconSize  – badge size in px (default 40)
	 */
	let { filename = '', mimetype = '', url = '', iconSize = 40 } = $props();

	const ext = (filename.split('.').pop() ?? '').toLowerCase();

	const CODE_COLORS = {
		js:   '#f0db4f', ts:   '#3178c6', jsx:  '#61dafb', tsx:  '#3178c6',
		py:   '#3572a5', html: '#e34c26', css:  '#563d7c', scss: '#c6538c',
		sass: '#c6538c', json: '#6b6b6b', md:   '#083fa1', sh:   '#4eaa25',
		bash: '#4eaa25', sql: '#e38c00',  xml:  '#0060ac', svg:  '#ff9a00',
		rs:   '#dea584', go:  '#00add8',  rb:   '#701516', php: '#4f5d95',
		java: '#b07219', c:   '#555',     cpp:  '#f34b7d', cs:  '#178600',
		kt:   '#a97bff', swift: '#fa7343', r: '#198ce7',
		vue:  '#41b883', svelte: '#ff3e00', dart: '#0175c2',
		yaml: '#cb171e', yml: '#cb171e',  toml: '#9c4221',
	};

	const ARCHIVE_EXTS = new Set(['zip','rar','7z','tar','gz','bz2','xz','dmg','iso']);
	const DOC_EXTS     = new Set(['doc','docx','odt','rtf','pages']);
	const SHEET_EXTS   = new Set(['xls','xlsx','ods','csv','numbers']);
	const SLIDE_EXTS   = new Set(['ppt','pptx','odp','key']);
	const TEXT_EXTS    = new Set(['txt','log','env','ini','cfg','conf']);
	const AUDIO_EXTS   = new Set(['mp3','wav','aac','flac','ogg','m4a','wma']);
	const VIDEO_EXTS   = new Set(['mp4','mov','avi','mkv','webm','m4v','wmv','flv']);
	const IMG_EXTS     = new Set(['jpg','jpeg','png','gif','webp','avif','bmp','tiff','svg','heic']);

	function classify() {
		// Mimetype takes priority for broad categories
		if (mimetype.startsWith('image/') || IMG_EXTS.has(ext))
			return { label: ext.toUpperCase() || 'IMG', bg: '#5ba4cf', fg: '#fff', thumb: true };
		if (mimetype.startsWith('video/') || VIDEO_EXTS.has(ext))
			return { label: ext.toUpperCase() || 'VID', bg: '#ab84d4', fg: '#fff' };
		if (mimetype.startsWith('audio/') || AUDIO_EXTS.has(ext))
			return { label: ext.toUpperCase() || 'AUD', bg: '#e091b0', fg: '#fff' };
		if (mimetype === 'application/pdf' || ext === 'pdf')
			return { label: 'PDF', bg: '#e07550', fg: '#fff' };

		if (ARCHIVE_EXTS.has(ext))
			return { label: ext.toUpperCase(), bg: '#c9a227', fg: '#fff' };

		if (ext in CODE_COLORS) {
			const bg = CODE_COLORS[ext];
			// Keep text readable: light bg → dark text
			const light = ['#f0db4f','#61dafb','#4eaa25'].includes(bg);
			return { label: ext.length > 3 ? ext.slice(0,4).toUpperCase() : ext.toUpperCase(), bg, fg: light ? '#111' : '#fff' };
		}

		if (DOC_EXTS.has(ext))    return { label: 'DOC',  bg: '#2b579a', fg: '#fff' };
		if (SHEET_EXTS.has(ext))  return { label: ext === 'csv' ? 'CSV' : 'XLS', bg: '#217346', fg: '#fff' };
		if (SLIDE_EXTS.has(ext))  return { label: 'PPT',  bg: '#d24726', fg: '#fff' };
		if (TEXT_EXTS.has(ext))   return { label: 'TXT',  bg: '#888',    fg: '#fff' };

		return { label: ext ? ext.slice(0, 4).toUpperCase() : 'FILE', bg: '#a09688', fg: '#fff' };
	}

	const info = classify();
	const isThumb = info.thumb && url;
	const fontSize = iconSize <= 20 ? Math.round(iconSize * 0.38) : Math.round(iconSize * 0.28);
</script>

{#if isThumb}
	<img
		src={url}
		alt={filename}
		class="icon-thumb"
		style:width="{iconSize}px"
		style:height="{iconSize}px"
	/>
{:else}
	<span
		class="icon-badge"
		style:width="{iconSize}px"
		style:height="{iconSize}px"
		style:background={info.bg}
		style:color={info.fg}
		style:font-size="{fontSize}px"
		style:border-radius="{Math.round(iconSize * 0.18)}px"
	>{info.label}</span>
{/if}

<style>
	.icon-thumb {
		object-fit: cover;
		border-radius: 6px;
		display: block;
		flex-shrink: 0;
	}
	.icon-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		letter-spacing: -0.03em;
		flex-shrink: 0;
		font-family: 'SF Mono', 'Fira Code', ui-monospace, monospace;
		line-height: 1;
		user-select: none;
	}
</style>
