// The public teaching archive: what logged-out visitors see at "/", and what
// signed-in members see under "Archive" in the app sidebar (/app/years).
//
// Everything here is PUBLIC and indexable, and so is this repo on GitHub. Edit
// this file and deploy; there is no database behind it. Years are listed
// newest first.
//
// Names (Ricky's rule, 2026-11-19): students, auditors, TAs and friends appear
// as first name + last initial ("Akis B."), never a full name, not even in a
// comment. Guest lecturers, guest critics and guests are public figures here
// and keep their full names. Full names, and who made what, are kept privately
// in PEOPLE.md in the private Yure-witch/teaching-archive repo, never here.
//
// Never put a student's name next to a project (title, label, note or
// comment). Students are listed by name, and projects by title, but the two
// are never paired.
//
// Shape of one course (every list is optional; empty lists are hidden):
//
//   {
//     title: 'Interactive Design Concepts',
//     term: 'Fall 2026',
//     school: 'The Cooper Union',
//     current: true,                      // marks the course as in session
//     description: 'One or two sentences about the course.',
//     materials: [
//       { label: 'Syllabus', url: 'https://…' },
//       { label: 'Shared Drive folder', url: 'https://drive.google.com/…', note: 'Readings and references' }
//     ],
//     lectures: [
//       { week: 1, title: 'Intro', url: 'https://docs.google.com/presentation/d/…', homework: 'Make a text adventure' },
//       { week: 9, title: 'Midterm crit' }   // url and homework optional
//     ],
//     highlights: [                       // "Selected work", shown first
//       { title: 'Project', about: 'One or two plain sentences.', url: 'https://…' }
//     ],                                  // url optional (installations, lost links)
//     students: ['First L.', { name: 'First L.', school: 'Engineering' }, …],
//                                         // school: only for students outside the
//                                         // School of Art (Engineering, Architecture)
//     projects: [                         // "All projects", shown under Students
//       { label: 'Project', url: 'https://…' }
//     ],
//     // Work by someone who isn't a student (highlights or projects) adds
//     // from: 'an auditor' / 'a friend', shown as "from an auditor".
//     // Any person may be a bare name or { name, school?, note?, url?, work? };
//     // work ({ label, url }, shown under the name) is for guests only, never
//     // students, auditors or friends.
//     auditors: ['First L.', …],
//     tas: ['First L.', …],
//     guestLecturers: [{ name: 'Full Name', note: 'Talk title or affiliation', url: 'https://…' }],
//     guestCritics: ['Full Name', { name: 'Full Name', url: 'https://…' }],
//     guests: ['Full Name', …],
//     friends: [{ name: 'First L.', note: 'Audited' }]   // full name if they also spoke
//   }
//
// Links only signed-in class members should see (a guest's deck with their
// ID on a slide, say) don't go here: put them in $lib/server/archive-members.js,
// which adds them on /app/years only.
//
// Don't link the Fall 2025 syllabus or midterm brief PDFs: both print a
// personal phone number. The weekly homework below is copied from the syllabus.

// Lecture decks live in Google Slides, shared "anyone with the link".
const slides = (id) => `https://docs.google.com/presentation/d/${id}/edit?usp=sharing`;

export const archive = {
	owner: 'Ricky Yurewitch',
	intro:
		'Classes I have taught, year by year: syllabi, lectures, shared folders, and everyone who came through the room.',
	years: [
		{
			year: 2026,
			courses: [
				{
					title: 'Interactive Design Concepts',
					term: 'Fall 2026',
					school: 'The Cooper Union',
					current: true,
					materials: [],
					// Copied from the Fall 2026 roster on 2026-11-18 (approved members,
					// minus the TA and shadowbanned accounts).
					students: [
						'Abigail V.',
						{ name: 'Angela G.', school: 'Engineering' },
						'Bailey W.',
						'Casey C.',
						'Daeun C.',
						'Elle C.',
						{ name: 'Isabel Z.', school: 'Engineering' },
						'Isaiah N.',
						'Noah O.',
						'Ryan J.',
						'Yuval H.'
					],
					auditors: [],
					tas: ['Ani V.'],
					guestLecturers: [
						'Char Stiles',
						// Diego's, Mason's and Clarence's materials are members-only:
						// $lib/server/archive-members.js.
						{ name: 'Diego Herrera', note: 'Surviving Apocalypse: On Raving, Cyborgs, and The Underground' },
						{ name: 'Mason Webb', note: 'The String' },
						{ name: 'Clarence Kwan', note: 'Coding Yourself into Existence' },
						{ name: 'Yeji Kim', note: 'Upcoming' },
						{ name: 'Perrin Anto', note: 'Upcoming' }
					],
					guestCritics: ['Fabio Suarez', { name: 'Perrin Anto', note: 'Upcoming' }],
					guests: [],
					friends: ['Babe A.', 'Diego Herrera']
				}
			]
		},
		{
			year: 2025,
			courses: [
				{
					title: 'Interactive Design Concepts',
					term: 'Fall 2025',
					school: 'The Cooper Union',
					description: 'The first class I taught.',
					materials: [],
					lectures: [
						{
							week: 1,
							title: 'Intro',
							url: slides('1P6zIystDxHxdwOhwjjmuUgThhTWG9AhQ0KfeTWDoP4Y'),
							homework: 'Make a text adventure.'
						},
						{
							week: 2,
							title: 'Internet',
							url: slides('1T60SWZg9elv2rVkLFg1kdYtOqJDetx94kZ5QeXmkPrc'),
							homework: 'Find something you like on the web and describe how it was made.'
						},
						{
							week: 3,
							title: 'Tracking',
							url: slides('1gsthuY4db6HFp1QknsL6EvO_xCQCbkjkzjfBqAFoevk'),
							homework: 'Find three examples of misinformation or dark patterns, and show who benefits.'
						},
						{
							week: 4,
							title: 'Misinformation',
							url: slides('1XrrFjCfjSfH-KMCKelIhFJTfKaXajceUPGJeKnAXlJA'),
							homework: 'Make something you never thought you could make on your own, using AI a bit.'
						},
						{
							week: 5,
							title: 'AI intro',
							url: slides('1W2eToXPWhkFZxYHsiMw2zivfQe3EFz07sdXi_EHS12I'),
							homework: 'Work out the steps to run a model yourself, then try it.'
						},
						{
							week: 6,
							title: 'Deepfakes',
							url: slides('1UZnW9n-UJCdJOeGXUVkdNp7TDTqQvDm8EgHzKwUda2Q'),
							homework: 'Make a deepfake.'
						},
						{
							week: 7,
							title: 'AI agents',
							url: slides('1cqBMGEmuaOG11MRIaIgjghJ2g6xOXmwcARDtMwLYYVg'),
							homework: 'Make something with an agent, or have one or many perform, and document it.'
						},
						{
							week: 8,
							title: 'Guest lectures: Yeji Kim, and Diego Herrera on Glitch Feminism',
							homework: 'Finish the midterm.'
						},
						{
							week: 9,
							title: 'Midterm crit',
							homework: 'Bring a selection of ideas for the final.'
						},
						{
							week: 10,
							title: 'Anonymity',
							url: slides('1YoN_WwJGjkc4bAx4B9tz762Ay9YTO6GMPV-rP78L47g'),
							homework: 'Make an out-of-character creation, disconnected from you. Bonus: publish it anonymously.'
						},
						{
							week: 11,
							title: 'Hardware',
							url: slides('1cMXJ6xvgjFG4NWuKpZ6poUZiHN_d6BJ5GGp2nKeknTU'),
							homework: 'Take the first steps on the final.'
						},
						{
							week: 12,
							title: 'Generative',
							url: slides('1_oUdjfBhDDyGpFL8zCDpocle86jFItK0ftpr4GkF93Y'),
							homework: 'Make art using code.'
						},
						{
							week: 13,
							title: 'Money and art',
							url: slides('1fVBm_cCRxRAukoTrogtryvXjvvvDWQT9LibguEXjuaU'),
							homework: 'Get the final close to done.'
						},
						{ week: 14, title: 'Hype, virality and fake people online', homework: 'Finish the final.' },
						{ week: 15, title: 'Final crit' }
					],
					// The projects that went furthest out, picked by Ricky. No names: who
					// made each one is in the private PEOPLE.md. Neighbours are mixed on
					// purpose so one student's work doesn't sit in a run.
					highlights: [
						{
							title: 'Evil Fridge',
							about: 'Show it a photo of a refrigerator and an AI model tells you which weapons you could make from it. The model hallucinated.',
							url: 'https://github.com/Akis-B/EvilFridgeApp'
						},
						{
							title: 'Osci Draw',
							about: 'Draw a line with a whiteboard marker and a camera reads it as a waveform, so the drawing plays as a synthesizer.',
							url: 'https://saucekia.github.io/WaveDraw/'
						},
						{
							title: 'Colegio Simón Bolívar',
							about: 'A 3D world of rooms, sounds and memories from Ecuador. It went on to a senior show.',
							url: 'https://juliasolines.github.io/Trabajo/'
						},
						{
							title: 'Doily generator',
							about: 'Generates randomized needle-tatting doily patterns. The doilies were then made by hand.',
							url: 'https://github.com/phredmorris/TattingGenerator'
						},
						{
							title: 'Interactive Dot Grid',
							about: 'Tracks your hands and grows or shrinks a field of circles around them, so your hands seem to give off an aura.',
							url: 'https://samanthakye.github.io/finalproject/'
						},
						{
							title: 'Degrading Editions',
							about: 'Anonymous file hosting where every upload has ten copies, and each download degrades the file until it can\'t be read.',
							url: 'https://madmaxdod.github.io/site/'
						},
						{
							title: 'Bio-Love Simulator',
							about: 'A walk through the inside of a body, built in three.js. Freaky.',
							url: 'https://hollywoodcelebrity.github.io/LoveSim/'
						},
						{
							title: 'Reach 4 Stars',
							about: 'A hand-tracking game of exercises for carpal tunnel.',
							url: 'https://kamaiwilliams.github.io/hand-game/'
						},
						{
							title: 'Border',
							about: 'An installation of six iPads, every camera pointed at your shoes. The closer you walk, the smaller your feet get on screen.',
							url: 'https://border-gilt-three.vercel.app'
						},
						{
							title: 'Letters',
							about: 'Listens to everything you say and rebuilds it as a poem in experimental form.',
							url: 'https://juliasolines.github.io/Trabajo/letters/'
						},
						{
							title: 'STRNG Journal',
							about: 'A journal that weaves each entry, rated for intensity and pleasantness, into strings.',
							url: 'https://elainelufy000elfy.github.io/STRG-journal/'
						},
						{
							title: 'Gestural 3D model viewer',
							about: 'Pinch your fingers in the air to turn and move around a 3D world.'
						},
						{
							title: 'Plane Viewer',
							about: 'Something like a flight simulator, except what you do is look at planes in the sky.',
							url: 'https://plane-viewer.vercel.app'
						},
						{
							title: 'Loop Pad',
							about: 'A pad for chopping and screwing loops.',
							url: 'https://kamaiwilliams.github.io/chopandscrew/loop-pad.html'
						},
						{
							title: 'Audio to Cellular Automata',
							about: 'Drop in an MP3 and the music drives the Game of Life, Lenia and other cellular automata.',
							url: 'https://campbe1l.github.io/camsgenaudioart/'
						},
						{
							title: 'Urban Fossil',
							from: 'an auditor',
							about: 'A generative type tool made from trash found on the street.',
							url: 'https://suyeonkimdesign.github.io/urban-fossil/'
						},
						{
							title: 'IMPRESS',
							about: 'A webcam presses what it sees into a 3D membrane, which you can export as a file for 3D printing.',
							url: 'https://saucekia.github.io/IMPRESS/'
						},
						{
							title: 'Where the Cows Move',
							about: 'Daily movements of cattle herds on the Logone Floodplain in Cameroon, played back over time.',
							url: 'https://kamaiwilliams.github.io/cow-tracker/'
						},
						{
							title: 'tap.in',
							from: 'an auditor',
							about: 'A social site for finding events in NYC.',
							url: 'https://tapppp.in/'
						},
						{
							title: 'Camera Flip-Dot Display',
							from: 'a friend',
							about: 'Turns your camera into a flip-dot display, with a drone synth that follows the image.',
							url: 'https://revanspr.github.io/FlipDisc/'
						}
					],
					// The DTSS (registrar) roster for FA-326-1, Fall 2025.
					students: [
						{ name: 'Akis B.', school: 'Engineering' },
						'Alyssa M.',
						'Campbell C.',
						{ name: 'Elaine L.', school: 'Architecture' },
						'Fred W.',
						'Julia S.',
						'Kamai W.',
						'Max D.',
						'Samantha K.',
						'Saskia (Kia) L.'
					],
					// Every public link students sent: email, the class Teams channel and
					// their own documentation lists, each checked live on 2026-11-18. Work
					// sent as attachments, OneDrive or Drive shares isn't listed. A-Z, with
					// no names; authors are in the private PEOPLE.md.
					projects: [
						{ label: 'a great day? (text adventure)', url: 'https://playfic.com/games/samanthakye/a-great-day' },
						{ label: 'A Manual for a Manual', url: 'https://saucekia.github.io/Week2WebsiteAboutAWebsite/' },
						{ label: 'A text adventure', url: 'https://playfic.com/games/saucekia_l/kia' },
						{ label: 'AI homework', url: 'https://madmaxdod.github.io/HWAI2/' },
						{ label: 'Audio Glitch Visualizer', url: 'https://samanthakye.github.io/finalproject2/' },
						{ label: 'Audio to Cellular Automata', url: 'https://campbe1l.github.io/camsgenaudioart/' },
						{ label: 'Binary Music Player', url: 'https://hollywoodcelebrity.github.io/CelebrityKeys/' },
						{ label: 'Bio-Love Simulator', url: 'https://hollywoodcelebrity.github.io/LoveSim/' },
						{ label: 'Blink dark patterns', url: 'https://juliasolines.github.io/Blink-dark-patterns/' },
						{ label: 'Body-following Particles (midterm)', url: 'https://juliasolines.github.io/Trabajo/Midterm%20ai%20play/' },
						{ label: 'Border (final)', url: 'https://border-gilt-three.vercel.app' },
						{ label: 'Camera Flip-Dot Display', url: 'https://revanspr.github.io/FlipDisc/', from: 'a friend' },
						{ label: 'Colegio Simón Bolívar (final, later in a senior show)', url: 'https://juliasolines.github.io/Trabajo/' },
						{ label: 'Concepts and Play', url: 'https://phredmorris.github.io/Concepts-and-Play/' },
						{ label: 'Dark Patterns', url: 'https://hollywoodcelebrity.github.io/DarkMatter/' },
						{ label: 'Dark Patterns Awareness', url: 'https://akis-b.github.io/FA326-HW4/' },
						{ label: 'Dark Patterns in Figma', url: 'https://saucekia.github.io/DarkPatterns/' },
						{ label: 'Dark Patterns in Figma and ClassPass', url: 'https://campbe1l.github.io/camsdarkpattern/' },
						{ label: 'Degrading Editions, anonymous media hosting', url: 'https://madmaxdod.github.io/site/' },
						{ label: 'Doily generator', url: 'https://github.com/phredmorris/TattingGenerator' },
						{ label: 'dotted.', url: 'https://samanthakye.github.io/dotted/' },
						{ label: 'Euro Olympics (text adventure)', url: 'https://playfic.com/games/akisb/euroolympics' },
						{ label: 'Evil Fridge (final)', url: 'https://github.com/Akis-B/EvilFridgeApp' },
						{ label: 'Examples of Dark Patterns', url: 'https://kamaiwilliams.github.io/nine-eighteen/index.html' },
						{ label: 'Explaining a Site', url: 'https://juliasolines.github.io/Trabajo/starmap/' },
						{ label: 'Generative sketch', url: 'https://editor.p5js.org/hollywoodcelebrity/full/B852S3ujI' },
						{ label: 'Generative Worms', url: 'https://juliasolines.github.io/Generative-Worms/' },
						{ label: 'Glass Stacker', url: 'https://glass-stacker.vercel.app' },
						{ label: 'Homework 3', url: 'https://akis-b.github.io/FA326HW3/' },
						{ label: 'House Taken Over (text adventure)', url: 'https://playfic.com/games/jsolasol/house-taken-over' },
						{ label: 'IMPRESS, software for making a good impression (midterm)', url: 'https://saucekia.github.io/IMPRESS/' },
						{ label: 'Inspecting Theta.NYC Exhibitions', url: 'https://kamaiwilliams.github.io/nine-eleven/' },
						{ label: 'Interactive Dot Grid', url: 'https://samanthakye.github.io/finalproject/' },
						{ label: 'Keyboard Pixel Visualizer', url: 'https://kamaiwilliams.github.io/generative-art/' },
						{ label: 'Letters, a poem made from what you say', url: 'https://juliasolines.github.io/Trabajo/letters/' },
						{ label: 'Loop Pad', url: 'https://kamaiwilliams.github.io/chopandscrew/loop-pad.html' },
						{ label: 'Make a Sandwich for Lunch (text adventure)', url: 'https://kamaiwilliams.github.io/sandwhich-text-adventure/' },
						{ label: 'Midterm', url: 'https://github.com/phredmorris/Midterm' },
						{ label: 'Misinformation and Dark Patterns', url: 'https://samanthakye.github.io/sk-darkpatterns/' },
						{ label: 'Mold Takeover', url: 'https://juliasolines.github.io/App-pp/' },
						{ label: 'Mondrian', url: 'https://campbe1l.github.io/cams-Mondrian/' },
						{ label: 'Osci Draw (WaveDraw)', url: 'https://saucekia.github.io/WaveDraw/' },
						{ label: 'p5.js sketch', url: 'https://editor.p5js.org/juliasolines/full/1RYe5chIj' },
						{ label: 'Particle Cloud', url: 'https://campbe1l.github.io/camandchatsparticlecloud/' },
						{ label: 'Pickle Passion Press', url: 'https://secretominouspickle.vercel.app' },
						{ label: 'Pinterest Notes', url: 'https://samanthakye.github.io/samanthakye/' },
						{ label: 'Plane Viewer', url: 'https://plane-viewer.vercel.app' },
						{ label: 'Portfolio', url: 'https://samanthakye.github.io/samkyeportfolio/' },
						{ label: 'Reach 4 Stars, a hand-tracking carpal tunnel exercise (final)', url: 'https://kamaiwilliams.github.io/hand-game/' },
						{ label: 'Simple Planner', url: 'https://akis-b.github.io/Planner/' },
						{ label: 'Strega Nona (text adventure)', url: 'https://playfic.com/games/phredmorris/strega-nona' },
						{ label: 'STRNG Journal (final)', url: 'https://elainelufy000elfy.github.io/STRG-journal/' },
						{ label: 'Talk to Me', url: 'https://talktome-nine.vercel.app' },
						{ label: 'tap.in, a social site for finding events in NYC', url: 'https://tapppp.in/', from: 'an auditor' },
						{ label: 'Termite Playground', url: 'https://juliasolines.github.io/Trabajo/termites/' },
						{ label: 'The Library (text adventure)', url: 'https://playfic.com/games/MADMAXDOD/the-library' },
						{ label: 'Tulip Roof', url: 'https://editor.p5js.org/Saucekia/full/zQF66zzRf' },
						{
							label: 'Urban Fossil, a generative type tool made from street trash',
							url: 'https://suyeonkimdesign.github.io/urban-fossil/',
							from: 'an auditor'
						},
						{ label: 'Volatility Explained', url: 'https://volatility-explained-soq2.vercel.app' },
						{ label: 'Volatility Playbook Simulator', url: 'https://akis-b.github.io/UbuntuAIApp/' },
						{ label: 'Web Dev Homework Report', url: 'https://madmaxdod.github.io/IntDesHomework1-/' },
						{ label: 'Where the Cows Move', url: 'https://kamaiwilliams.github.io/cow-tracker/' },
						{ label: 'Young You Journal (midterm)', url: 'https://elainelufy000elfy.github.io/young-me/' }
					],
					// Their work is in the lists above, marked "from an auditor".
					auditors: ['Oliver C.', 'Suyeon K.'],
					// Diego's slides are members-only: $lib/server/archive-members.js.
					guestLecturers: [{ name: 'Yeji Kim' }, { name: 'Diego Herrera', note: 'Glitch Feminism' }],
					guestCritics: [
						'Diego Herrera',
						'Erin Sparling',
						'Fabio Suarez',
						{ name: 'Li Huang', url: 'https://lihuang.space' },
						'River Friedman',
						'Yeji Kim'
					],
					guests: [],
					// Their work is in the lists above, marked "from a friend".
					friends: [{ name: 'Revans R.', note: 'Audited' }]
				}
			]
		}
	]
};

/** People groups, in display order. `key` is the course field. */
export const PEOPLE_GROUPS = [
	{ key: 'students', one: 'Student', many: 'Students' },
	{ key: 'auditors', one: 'Auditor', many: 'Auditors' },
	{ key: 'tas', one: 'Teaching assistant', many: 'Teaching assistants' },
	{ key: 'guestLecturers', one: 'Guest lecturer', many: 'Guest lecturers' },
	{ key: 'guestCritics', one: 'Guest critic', many: 'Guest critics' },
	{ key: 'guests', one: 'Guest', many: 'Guests' },
	{ key: 'friends', one: 'Friend', many: 'Friends' }
];

/** A person entry may be a bare name or { name, note?, url?, work? }. */
export function person(p) {
	return typeof p === 'string' ? { name: p } : p;
}
