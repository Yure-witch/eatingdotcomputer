// The public teaching archive: what logged-out visitors see at "/", and what
// signed-in members see under "Archive" in the app sidebar (/app/years).
//
// Everything here is PUBLIC and indexable, names included. Edit this file and
// deploy; there is no database behind it. Years are listed newest first.
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
//       { title: 'Project', by: ['Full Name'], about: 'One or two plain sentences.', url: 'https://…' }
//     ],                                  // url optional (installations, lost links)
//     students: ['Full Name', …],
//     work: [                             // student work, shown under Students
//       { name: 'Full Name', items: [{ label: 'Project', url: 'https://…' }] }
//     ],
//     // Any person below may be a bare name or { name, note?, url?, work? },
//     // where work is a list of { label, url } shown under their name.
//     auditors: ['Full Name', …],
//     tas: ['Full Name', …],
//     guestLecturers: [{ name: 'Full Name', note: 'Talk title or affiliation', url: 'https://…' }],
//     guestCritics: ['Full Name', { name: 'Full Name', url: 'https://…' }],
//     guests: ['Full Name', …],
//     friends: [{ name: 'Full Name', note: 'Audited', work: [{ label: 'Project', url: 'https://…' }] }]
//   }
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
						'Abigail Velazco',
						'Angela Gray',
						'bailey',
						'Casey Chung',
						'Daeun Chung',
						'Elle Charles',
						'Isabel Zulawski',
						'Isaiah',
						'Noah Oh',
						'Ryan Jang',
						'Yuval Harel'
					],
					auditors: [],
					tas: ['Ani V'],
					guestLecturers: [
						'Char Stiles',
						'Diego Herrera',
						'Mason Webb',
						'Clarence Kwan',
						{ name: 'Yeji Kim', note: 'Upcoming' },
						{ name: 'Perrin Anto', note: 'Upcoming' }
					],
					guestCritics: ['Fabio Suarez', { name: 'Perrin Anto', note: 'Upcoming' }],
					guests: []
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
					// The projects that went furthest out, as Ricky describes them.
					highlights: [
						{
							title: 'Evil Fridge',
							by: ['Akis Bouzoulas'],
							about: 'Show it a photo of a refrigerator and an AI model tells you which weapons you could make from it. The model hallucinated.',
							url: 'https://github.com/Akis-B/EvilFridgeApp'
						},
						{
							title: 'Doily generator',
							by: ['Fred Whitley'],
							about: 'Generates randomized needle-tatting doily patterns. Fred then made the doilies by hand.',
							url: 'https://github.com/phredmorris/TattingGenerator'
						},
						{
							title: 'Osci Draw',
							by: ['Saskia (Kia) Lampe'],
							about: 'Draw a line with a whiteboard marker and a camera reads it as a waveform, so the drawing plays as a synthesizer.',
							url: 'https://saucekia.github.io/WaveDraw/'
						},
						{
							title: 'Gestural 3D model viewer',
							by: ['Saskia (Kia) Lampe'],
							about: 'Pinch your fingers in the air to turn and move around a 3D world.'
						},
						{
							title: 'Colegio Simón Bolívar',
							by: ['Julia Solines'],
							about: 'A 3D world of rooms, sounds and memories from Ecuador. It went on to her senior show.',
							url: 'https://juliasolines.github.io/Trabajo/'
						},
						{
							title: 'Letters',
							by: ['Julia Solines'],
							about: 'Listens to everything you say and rebuilds it as a poem in experimental form.',
							url: 'https://juliasolines.github.io/Trabajo/letters/'
						},
						{
							title: 'Interactive Dot Grid',
							by: ['Samantha Kye'],
							about: 'Tracks your hands and grows or shrinks a field of circles around them, so your hands seem to give off an aura.',
							url: 'https://samanthakye.github.io/finalproject/'
						},
						{
							title: 'Plane Viewer',
							by: ['Max Dodziuk'],
							about: 'Something like a flight simulator, except what you do is look at planes in the sky.',
							url: 'https://plane-viewer.vercel.app'
						},
						{
							title: 'Border',
							by: ['Campbell Cronk', 'Max Dodziuk'],
							about: 'An installation of six iPads, every camera pointed at your shoes. The closer you walk, the smaller your feet get on screen.',
							url: 'https://border-gilt-three.vercel.app'
						},
						{
							title: 'Bio-Love Simulator',
							by: ['Alyssa Mendo'],
							about: 'A walk through the inside of a body, built in three.js. Freaky.',
							url: 'https://hollywoodcelebrity.github.io/LoveSim/'
						},
						{
							title: 'Reach 4 Stars',
							by: ['Kamai Williams'],
							about: 'A hand-tracking game of exercises for carpal tunnel.',
							url: 'https://kamaiwilliams.github.io/hand-game/'
						},
						{
							title: 'Loop Pad',
							by: ['Kamai Williams'],
							about: 'A pad for chopping and screwing loops.',
							url: 'https://kamaiwilliams.github.io/chopandscrew/loop-pad.html'
						},
						{
							title: 'Urban Fossil',
							by: ['Suyeon Kim'],
							about: 'A generative type tool made from trash found on the street.',
							url: 'https://suyeonkimdesign.github.io/urban-fossil/'
						},
						{
							title: 'tap.in',
							by: ['Oliver Coria'],
							about: 'A social site for finding events in NYC.',
							url: 'https://tapppp.in/'
						}
					],
					// The DTSS (registrar) roster for FA-326-1, Fall 2025. Julia is
					// "Julia Solines Reed" there; she publishes as Julia Solines.
					students: [
						'Akis Bouzoulas',
						'Alyssa Mendo',
						'Campbell Cronk',
						'Elaine Lu',
						'Fred Whitley',
						'Julia Solines',
						'Kamai Williams',
						'Max Dodziuk',
						'Samantha Kye',
						'Saskia (Kia) Lampe'
					],
					// Public links from email, the class Teams channel and students'
					// own lists, oldest first, each checked live on 2026-11-18. Work
					// sent as attachments, OneDrive or Drive shares isn't listed.
					work: [
						{
							name: 'Akis Bouzoulas',
							items: [
								{ label: 'Euro Olympics (text adventure)', url: 'https://playfic.com/games/akisb/euroolympics' },
								{ label: 'Homework 3', url: 'https://akis-b.github.io/FA326HW3/' },
								{ label: 'Dark Patterns Awareness', url: 'https://akis-b.github.io/FA326-HW4/' },
								{ label: 'Simple Planner', url: 'https://akis-b.github.io/Planner/' },
								{ label: 'Volatility Playbook Simulator', url: 'https://akis-b.github.io/UbuntuAIApp/' },
								{ label: 'Volatility Explained', url: 'https://volatility-explained-soq2.vercel.app' },
								{ label: 'Pickle Passion Press', url: 'https://secretominouspickle.vercel.app' },
								{ label: 'Glass Stacker', url: 'https://glass-stacker.vercel.app' },
								{ label: 'Evil Fridge App (final)', url: 'https://github.com/Akis-B/EvilFridgeApp' }
							]
						},
						{
							name: 'Alyssa Mendo',
							items: [
								{ label: 'Binary Music Player', url: 'https://hollywoodcelebrity.github.io/CelebrityKeys/' },
								{ label: 'Dark Patterns', url: 'https://hollywoodcelebrity.github.io/DarkMatter/' },
								{ label: 'Talk to Me', url: 'https://talktome-nine.vercel.app' },
								{ label: 'Bio-Love Simulator', url: 'https://hollywoodcelebrity.github.io/LoveSim/' },
								{ label: 'Generative sketch', url: 'https://editor.p5js.org/hollywoodcelebrity/full/B852S3ujI' }
							]
						},
						{
							name: 'Campbell Cronk',
							items: [
								{ label: 'Mondrian and Cam', url: 'https://campbe1l.github.io/cams-Mondrian/' },
								{ label: 'Dark Patterns in Figma and ClassPass', url: 'https://campbe1l.github.io/camsdarkpattern/' },
								{ label: 'Particle Cloud', url: 'https://campbe1l.github.io/camandchatsparticlecloud/' },
								{ label: 'Audio to Cellular Automata', url: 'https://campbe1l.github.io/camsgenaudioart/' },
								{ label: 'Border, with Max Dodziuk (final)', url: 'https://border-gilt-three.vercel.app' }
							]
						},
						{
							name: 'Elaine Lu',
							items: [
								{ label: 'Young You Journal (midterm)', url: 'https://elainelufy000elfy.github.io/young-me/' },
								{ label: 'STRNG Journal (final)', url: 'https://elainelufy000elfy.github.io/STRG-journal/' }
							]
						},
						{
							name: 'Fred Whitley',
							items: [
								{ label: 'Strega Nona (text adventure)', url: 'https://playfic.com/games/phredmorris/strega-nona' },
								{ label: 'Concepts and Play', url: 'https://phredmorris.github.io/Concepts-and-Play/' },
								{ label: 'Midterm', url: 'https://github.com/phredmorris/Midterm' },
								{ label: 'Doily generator', url: 'https://github.com/phredmorris/TattingGenerator' }
							]
						},
						{
							name: 'Julia Solines',
							items: [
								{ label: 'House Taken Over (text adventure)', url: 'https://playfic.com/games/jsolasol/house-taken-over' },
								{ label: 'Explaining a Site', url: 'https://juliasolines.github.io/Trabajo/starmap/' },
								{ label: 'Blink dark patterns', url: 'https://juliasolines.github.io/Blink-dark-patterns/' },
								{ label: 'Termite Playground', url: 'https://juliasolines.github.io/Trabajo/termites/' },
								{ label: 'Mold Takeover', url: 'https://juliasolines.github.io/App-pp/' },
								{ label: 'Body-following Particles (midterm)', url: 'https://juliasolines.github.io/Trabajo/Midterm%20ai%20play/' },
								{ label: 'Letters, a poem made from what you say', url: 'https://juliasolines.github.io/Trabajo/letters/' },
								{ label: 'p5.js sketch', url: 'https://editor.p5js.org/juliasolines/full/1RYe5chIj' },
								{ label: 'Generative Worms', url: 'https://juliasolines.github.io/Generative-Worms/' },
								{ label: 'Colegio Simón Bolívar (final, later in her senior show)', url: 'https://juliasolines.github.io/Trabajo/' }
							]
						},
						{
							name: 'Kamai Williams',
							items: [
								{ label: 'Make a Sandwich for Lunch (text adventure)', url: 'https://kamaiwilliams.github.io/sandwhich-text-adventure/' },
								{ label: 'Inspecting Theta.NYC Exhibitions', url: 'https://kamaiwilliams.github.io/nine-eleven/' },
								{ label: 'Examples of Dark Patterns', url: 'https://kamaiwilliams.github.io/nine-eighteen/index.html' },
								{ label: 'Loop Pad', url: 'https://kamaiwilliams.github.io/chopandscrew/loop-pad.html' },
								{ label: 'Where the Cows Move', url: 'https://kamaiwilliams.github.io/cow-tracker/' },
								{ label: 'Keyboard Pixel Visualizer', url: 'https://kamaiwilliams.github.io/generative-art/' },
								{ label: 'Reach 4 Stars, a hand-tracking carpal tunnel exercise (final)', url: 'https://kamaiwilliams.github.io/hand-game/' }
							]
						},
						{
							name: 'Max Dodziuk',
							items: [
								{ label: 'The Library (text adventure)', url: 'https://playfic.com/games/MADMAXDOD/the-library' },
								{ label: 'Web Dev Homework Report', url: 'https://madmaxdod.github.io/IntDesHomework1-/' },
								{ label: 'AI homework', url: 'https://madmaxdod.github.io/HWAI2/' },
								{ label: 'Plane Viewer', url: 'https://plane-viewer.vercel.app' },
								{ label: 'Degrading Editions, anonymous media hosting', url: 'https://madmaxdod.github.io/site/' },
								{ label: 'Border, with Campbell Cronk (final)', url: 'https://border-gilt-three.vercel.app' }
							]
						},
						{
							name: 'Samantha Kye',
							items: [
								{ label: 'a great day? (text adventure)', url: 'https://playfic.com/games/samanthakye/a-great-day' },
								{ label: 'Pinterest Notes', url: 'https://samanthakye.github.io/samanthakye/' },
								{ label: 'Misinformation and Dark Patterns', url: 'https://samanthakye.github.io/sk-darkpatterns/' },
								{ label: 'Portfolio', url: 'https://samanthakye.github.io/samkyeportfolio/' },
								{ label: 'dotted.', url: 'https://samanthakye.github.io/dotted/' },
								{ label: 'Interactive Dot Grid', url: 'https://samanthakye.github.io/finalproject/' },
								{ label: 'Audio Glitch Visualizer', url: 'https://samanthakye.github.io/finalproject2/' }
							]
						},
						{
							name: 'Saskia (Kia) Lampe',
							items: [
								{ label: 'kia (text adventure)', url: 'https://playfic.com/games/saucekia_l/kia' },
								{ label: 'A Manual for a Manual', url: 'https://saucekia.github.io/Week2WebsiteAboutAWebsite/' },
								{ label: 'Dark Patterns in Figma', url: 'https://saucekia.github.io/DarkPatterns/' },
								{ label: 'IMPRESS, software for making a good impression (midterm)', url: 'https://github.com/Saucekia/IMPRESS' },
								{ label: 'Tulip Roof', url: 'https://editor.p5js.org/Saucekia/full/zQF66zzRf' },
								{ label: 'Osci Draw (WaveDraw)', url: 'https://saucekia.github.io/WaveDraw/' }
							]
						}
					],
					auditors: [
						{
							name: 'Oliver Coria',
							work: [{ label: 'tap.in, a social site for finding events in NYC', url: 'https://tapppp.in/' }]
						},
						{
							name: 'Suyeon Kim',
							work: [
								{
									label: 'Urban Fossil, a generative type tool made from street trash',
									url: 'https://suyeonkimdesign.github.io/urban-fossil/'
								}
							]
						}
					],
					guestLecturers: [{ name: 'Yeji Kim' }, { name: 'Diego Herrera', note: 'Glitch Feminism' }],
					guestCritics: [
						'Diego Herrera',
						'Erin Sparling',
						'Fabio Suarez',
						{ name: 'lihuang', url: 'https://lihuang.space' },
						'River Friedman',
						'Yeji Kim'
					],
					guests: [],
					friends: [
						{
							name: 'Revans Ragbir',
							note: 'Audited',
							work: [{ label: 'FlipDisc', url: 'https://revanspr.github.io/FlipDisc/' }]
						}
					]
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
