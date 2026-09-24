/**
 * What a student is allowed to hand in — one list, shared by the file input's
 * `accept`, the presign endpoint, and the action that records the submission.
 * Three copies of this list is how you get a file the picker offers and the
 * server then refuses.
 *
 * HEIC/HEIF are here because that is what an iPhone camera produces. Safari
 * usually transcodes to JPEG on upload, but not always — AirDropped photos,
 * files picked out of Files.app, and some iOS versions hand over the original.
 * Those submissions used to fail with "Invalid file type for image" after the
 * student had already waited through the upload.
 */
export const IMAGE_TYPES = [
	'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif'
];
export const VIDEO_TYPES = [
	'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'
];

/** Generous, but not unbounded — R2 is ours to fill and a phone is not. */
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

export function allowedTypesFor(kind) {
	return kind === 'image' ? IMAGE_TYPES : kind === 'video' ? VIDEO_TYPES : [];
}

export function maxBytesFor(kind) {
	return kind === 'image' ? MAX_IMAGE_BYTES : kind === 'video' ? MAX_VIDEO_BYTES : 0;
}

/** For the file input, so the picker only offers what we can accept. */
export function acceptFor(kind) {
	const types = allowedTypesFor(kind);
	// The bare `image/*` keeps the iOS picker showing the photo library rather
	// than a file browser; the explicit list narrows what it returns.
	return types.length ? `${kind}/*,${types.join(',')}` : '';
}

/** Human-readable cap, for the error a student actually sees. */
export function maxLabelFor(kind) {
	return `${Math.round(maxBytesFor(kind) / (1024 * 1024))}MB`;
}
