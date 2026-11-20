// Members-only extras for the teaching archive. $lib/archive.js is public (it
// ships to logged-out visitors on "/"); anything here is sent only to signed-in
// class members on /app/years, and the logged-out page never gets these links.
//
// Ricky's rule (2026-11-20): a link that shouldn't be public is shown to
// members only, not posted openly. A guest's deck can show their ID, birthday
// or home address on a slide, which is fine in the room but not on the web.
//
// Files live in R2 under archive-members/<random>/<name>. The bucket has a
// public base URL, so the random folder is what keeps them unguessable: it is
// never written in this repo (which is public on GitHub). The server finds a
// file by listing the prefix, and /app/years/files/<name> checks class access
// and then hands back a short-lived signed URL.
//
// Shape: { [course term]: { [people group key]: { [person name]: work[] } } }
// where work is { label, file } (a file in R2) or { label, url }.

import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '$env/dynamic/private';
import { getR2Client } from '$lib/server/r2.js';

export const MEMBER_WORK = {
	'Fall 2025': {
		guestLecturers: {
			'Diego Herrera': [{ label: 'Slides', file: 'on-glitch.pdf', title: 'On Glitch.pdf' }]
		}
	},
	'Fall 2026': {
		guestLecturers: {
			'Diego Herrera': [
				{ label: 'Slides', file: 'surviving-apocalypse.pdf', title: 'Surviving Apocalypse.pdf' },
				{
					label: 'Notes',
					url: 'https://docs.google.com/document/d/1DCf1IPK2F-lF1DzbpiT8BhcXwsKFernQugNkGyKzwMU/edit?usp=sharing'
				}
			],
			// A copy of Mason's interactive talk (first made as a claude.ai
			// artifact, with the claude.ai wrapper script removed). It names
			// real people and private history, hence members-only.
			'Mason Webb': [{ label: 'Lecture', file: 'the-string.html', title: 'The String' }]
		}
	}
};

const PREFIX = 'archive-members/';

/** Every file named in MEMBER_WORK, by name. Only these can be fetched. */
function memberFiles() {
	const files = new Map();
	for (const groups of Object.values(MEMBER_WORK))
		for (const people of Object.values(groups))
			for (const work of Object.values(people))
				for (const w of work) if (w.file) files.set(w.file, w);
	return files;
}

/** The links for the page: file items become /app/years/files/<name>. */
export function memberWorkForPage() {
	const out = {};
	for (const [term, groups] of Object.entries(MEMBER_WORK)) {
		out[term] = {};
		for (const [group, people] of Object.entries(groups)) {
			out[term][group] = {};
			for (const [name, work] of Object.entries(people)) {
				out[term][group][name] = work.map((w) => ({
					label: w.label,
					url: w.file ? `/app/years/files/${encodeURIComponent(w.file)}` : w.url
				}));
			}
		}
	}
	return out;
}

let keys = null; // name → R2 key, cached per server instance

async function findKey(name) {
	const r2 = getR2Client();
	if (!r2 || !env.R2_BUCKET) return null;
	if (!keys?.has(name)) {
		keys = new Map();
		let token;
		do {
			const res = await r2.send(
				new ListObjectsV2Command({ Bucket: env.R2_BUCKET, Prefix: PREFIX, ContinuationToken: token })
			);
			for (const o of res.Contents ?? []) keys.set(o.Key.split('/').pop(), o.Key);
			token = res.IsTruncated ? res.NextContinuationToken : undefined;
		} while (token);
	}
	return keys.get(name) ?? null;
}

/** The MEMBER_WORK entry for a file name, or undefined. */
export function memberFile(name) {
	return memberFiles().get(name);
}

/** A 10-minute signed URL for a members-only file, or null if unknown. */
export async function memberFileUrl(name) {
	const item = memberFile(name);
	if (!item) return null;
	const key = await findKey(name);
	if (!key) return null;
	const filename = (item.title ?? name).replace(/"/g, '');
	return getSignedUrl(
		getR2Client(),
		new GetObjectCommand({
			Bucket: env.R2_BUCKET,
			Key: key,
			ResponseContentDisposition: `inline; filename="${filename}"`
		}),
		{ expiresIn: 600 }
	);
}
