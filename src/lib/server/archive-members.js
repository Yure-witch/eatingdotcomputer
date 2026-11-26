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
// where work is { label, file } (a file in R2), { label, url }, or
// { label, deck, pdf } (a slide deck for the viewer at /app/years/decks/<deck>).
//
// A deck is a folder in R2, archive-members/<random>/<deck>/: deck.json lists
// the slides (s/NNN.webp, thumbnails t/NNN.webp) and the videos, GIFs and
// sounds on each one (m/NN.mp4|mp3), placed as % of the slide. A slide where
// something was layered above a video also has s/NNN-top.webp, that layer
// alone with transparency, drawn over the videos. Keynote and
// PDF exports lose those, which is why the viewer exists. scripts/decks/
// builds and uploads a deck folder (see its README).

import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '$env/dynamic/private';
import { getR2Client } from '$lib/server/r2.js';
import { archive, person } from '$lib/archive.js';

export const MEMBER_WORK = {
	'Fall 2025': {
		guestLecturers: {
			'Yeji Kim': [
				{ label: 'Slides', deck: 'yeji-kim-cooper-union-talk', pdf: 'yeji-kim-cooper-union-talk.pdf', title: 'Cooper Union Talk' }
			],
			'Diego Herrera': [{ label: 'Slides', deck: 'on-glitch', pdf: 'on-glitch.pdf', title: 'On Glitch' }]
		}
	},
	'Fall 2026': {
		guestLecturers: {
			'Char Stiles': [
				{ label: 'Slides', deck: 'char-stiles-lecture', pdf: 'char-stiles-lecture.pdf', title: 'Char Stiles lecture' }
			],
			'Diego Herrera': [
				{ label: 'Slides', deck: 'surviving-apocalypse', pdf: 'surviving-apocalypse.pdf', title: 'Surviving Apocalypse' },
				{
					label: 'Notes',
					url: 'https://docs.google.com/document/d/1DCf1IPK2F-lF1DzbpiT8BhcXwsKFernQugNkGyKzwMU/edit?usp=sharing'
				}
			],
			// A copy of Mason's interactive talk (first made as a claude.ai
			// artifact, with the claude.ai wrapper script removed). It names
			// real people and private history, hence members-only.
			'Mason Webb': [{ label: 'Lecture', file: 'the-string.html', title: 'The String' }],
			'Clarence Kwan': [
				{
					label: 'Slides',
					deck: 'coding-yourself-into-existence',
					pdf: 'coding-yourself-into-existence.pdf',
					title: 'Coding Yourself into Existence'
				}
			]
		}
	}
};

const PREFIX = 'archive-members/';

/** Every work item in MEMBER_WORK, with who and when it belongs to. */
function* memberItems() {
	for (const [term, groups] of Object.entries(MEMBER_WORK))
		for (const people of Object.values(groups))
			for (const [name, work] of Object.entries(people)) for (const w of work) yield { term, name, w };
}

/** Every single file named in MEMBER_WORK, by name. Only these can be fetched
 *  through /app/years/files/; a deck's PDF is one of them. */
function memberFiles() {
	const files = new Map();
	for (const { w } of memberItems()) {
		if (w.file) files.set(w.file, w);
		if (w.pdf) files.set(w.pdf, { title: `${w.title}.pdf` });
	}
	return files;
}

/** The links for the page: file items become /app/years/files/<name>, decks
 *  /app/years/decks/<deck>. */
export function memberWorkForPage() {
	const out = {};
	for (const [term, groups] of Object.entries(MEMBER_WORK)) {
		out[term] = {};
		for (const [group, people] of Object.entries(groups)) {
			out[term][group] = {};
			for (const [name, work] of Object.entries(people)) {
				out[term][group][name] = work.map((w) => ({
					label: w.label,
					url: w.deck
						? `/app/years/decks/${encodeURIComponent(w.deck)}`
						: w.file
							? `/app/years/files/${encodeURIComponent(w.file)}`
							: w.url
				}));
			}
		}
	}
	return out;
}

// Path under the random folder ("on-glitch.pdf", "on-glitch/s/001.webp") →
// R2 key, cached per server instance and relisted when a path is missing.
// One listing at a time: a deck asks for hundreds of paths at once.
let keys = null;
let listing = null;

async function relist(r2) {
	const next = new Map();
	let token;
	do {
		const res = await r2.send(
			new ListObjectsV2Command({ Bucket: env.R2_BUCKET, Prefix: PREFIX, ContinuationToken: token })
		);
		for (const o of res.Contents ?? []) next.set(o.Key.split('/').slice(2).join('/'), o.Key);
		token = res.IsTruncated ? res.NextContinuationToken : undefined;
	} while (token);
	keys = next;
}

async function findKey(path) {
	const r2 = getR2Client();
	if (!r2 || !env.R2_BUCKET) return null;
	if (!keys?.has(path)) {
		listing ??= relist(r2).finally(() => (listing = null));
		await listing;
	}
	return keys?.get(path) ?? null;
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

/** A guest's public talk title (the note in $lib/archive.js), or null. */
function talkTitle(term, name) {
	for (const y of archive.years)
		for (const c of y.courses)
			if (c.term === term)
				for (const p of c.guestLecturers ?? []) if (person(p).name === name) return person(p).note ?? null;
	return null;
}

const manifests = new Map(); // deck → parsed deck.json, per server instance
const WINDOW = 6 * 3600 * 1000;

/**
 * A deck for the viewer, every asset as a signed URL, or null if unknown.
 * URLs are signed as of the start of the current 6-hour window and last 12
 * hours, so they stay the same across reloads in that window (the browser
 * cache keeps working) and always have at least 6 hours left.
 */
export async function memberDeck(slug) {
	let found = null;
	for (const it of memberItems()) if (it.w.deck === slug) found = it;
	if (!found) return null;

	let manifest = manifests.get(slug);
	if (!manifest) {
		const key = await findKey(`${slug}/deck.json`);
		if (!key) return null;
		const res = await getR2Client().send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
		manifest = JSON.parse(await res.Body.transformToString());
		manifests.set(slug, manifest);
	}

	const r2 = getR2Client();
	const signingDate = new Date(Math.floor(Date.now() / WINDOW) * WINDOW);
	const sign = async (rel) => {
		const key = await findKey(`${slug}/${rel}`);
		if (!key) return null;
		return getSignedUrl(r2, new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), {
			expiresIn: (2 * WINDOW) / 1000,
			signingDate
		});
	};
	const signAll = (list) => (list ? Promise.all(list.map(async (m) => ({ ...m, src: await sign(m.src) }))) : undefined);

	const slides = await Promise.all(
		manifest.slides.map(async (s) => ({
			img: await sign(s.img),
			thumb: await sign(s.thumb),
			top: s.top ? await sign(s.top) : undefined,
			media: await signAll(s.media),
			audio: await signAll(s.audio)
		}))
	);
	return {
		slug,
		title: found.w.title,
		person: found.name,
		talk: talkTitle(found.term, found.name),
		term: found.term,
		aspect: manifest.aspect,
		pdf: found.w.pdf ? `/app/years/files/${encodeURIComponent(found.w.pdf)}` : null,
		slides
	};
}
