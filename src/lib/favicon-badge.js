// Favicon unread badge — draws the app icon with a red count bubble in
// the top-right corner and swaps it in as the page icon. Count 0 removes
// the override so the normal (theme-aware) favicon links take back over.
let _baseImg = null;
let _baseLoad = null;
let _link = null;
let _lastKey = null;

function loadBase() {
	if (_baseLoad) return _baseLoad;
	_baseLoad = new Promise((resolve) => {
		const img = new Image();
		img.onload = () => { _baseImg = img; resolve(img); };
		img.onerror = () => resolve(null);
		img.src = '/icon-192.png';
	});
	return _baseLoad;
}

export async function setFaviconBadge(count) {
	if (typeof document === 'undefined') return;
	const n = Math.max(0, Math.floor(count) || 0);
	const key = n > 9 ? '9+' : String(n);
	if (key === _lastKey) return;
	_lastKey = key;

	if (n === 0) {
		_link?.remove();
		_link = null;
		return;
	}

	const base = await loadBase();
	const S = 64;
	const cv = document.createElement('canvas');
	cv.width = S; cv.height = S;
	const ctx = cv.getContext('2d');
	if (base) ctx.drawImage(base, 0, 0, S, S);

	// red bubble, ALWAYS top-right
	const r = 17, cx = S - r - 1, cy = r + 1;
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.fillStyle = '#e53935';
	ctx.fill();
	// slight ring so the bubble reads on any tab background
	ctx.lineWidth = 3;
	ctx.strokeStyle = 'rgba(255,255,255,0.9)';
	ctx.stroke();

	ctx.fillStyle = '#ffffff';
	ctx.font = `700 ${key.length > 1 ? 19 : 23}px -apple-system, system-ui, sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(key, cx, cy + 1);

	if (!_link) {
		_link = document.createElement('link');
		_link.rel = 'icon';
		_link.type = 'image/png';
		// appended LAST so it wins over the static favicon links
		document.head.appendChild(_link);
	}
	_link.href = cv.toDataURL('image/png');
}
