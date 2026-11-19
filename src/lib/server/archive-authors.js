// Who made what in the public teaching archive ($lib/archive.js).
//
// The public page lists students by name and projects by title but never
// pairs them, so authorship is logged here instead. $lib/server modules can't
// be imported by client code, so none of this reaches the browser. Nothing
// imports it yet; it's a record. The GitHub repo itself is public, though, so
// this file can be read there.
//
// Keyed by course, then author. Each item is { label, url }, matching an entry
// in that course's `projects` or `highlights` by URL (or by title when there
// is no public link).

export const ARCHIVE_AUTHORS = {
	'Interactive Design Concepts, Fall 2025': {
		'Akis Bouzoulas': [
			{ label: 'Euro Olympics (text adventure)', url: 'https://playfic.com/games/akisb/euroolympics' },
			{ label: 'Homework 3', url: 'https://akis-b.github.io/FA326HW3/' },
			{ label: 'Dark Patterns Awareness', url: 'https://akis-b.github.io/FA326-HW4/' },
			{ label: 'Simple Planner', url: 'https://akis-b.github.io/Planner/' },
			{ label: 'Volatility Playbook Simulator', url: 'https://akis-b.github.io/UbuntuAIApp/' },
			{ label: 'Volatility Explained', url: 'https://volatility-explained-soq2.vercel.app' },
			{ label: 'Pickle Passion Press', url: 'https://secretominouspickle.vercel.app' },
			{ label: 'Glass Stacker', url: 'https://glass-stacker.vercel.app' },
			{ label: 'Evil Fridge (final)', url: 'https://github.com/Akis-B/EvilFridgeApp' }
		],
		'Alyssa Mendo': [
			{ label: 'Binary Music Player', url: 'https://hollywoodcelebrity.github.io/CelebrityKeys/' },
			{ label: 'Dark Patterns', url: 'https://hollywoodcelebrity.github.io/DarkMatter/' },
			{ label: 'Talk to Me', url: 'https://talktome-nine.vercel.app' },
			{ label: 'Bio-Love Simulator', url: 'https://hollywoodcelebrity.github.io/LoveSim/' },
			{ label: 'Generative sketch', url: 'https://editor.p5js.org/hollywoodcelebrity/full/B852S3ujI' }
		],
		'Campbell Cronk': [
			{ label: 'Mondrian', url: 'https://campbe1l.github.io/cams-Mondrian/' },
			{ label: 'Dark Patterns in Figma and ClassPass', url: 'https://campbe1l.github.io/camsdarkpattern/' },
			{ label: 'Particle Cloud', url: 'https://campbe1l.github.io/camandchatsparticlecloud/' },
			{ label: 'Audio to Cellular Automata', url: 'https://campbe1l.github.io/camsgenaudioart/' },
			{ label: 'Border (final), with Max Dodziuk', url: 'https://border-gilt-three.vercel.app' }
		],
		'Elaine Lu': [
			{ label: 'Young You Journal (midterm)', url: 'https://elainelufy000elfy.github.io/young-me/' },
			{ label: 'STRNG Journal (final)', url: 'https://elainelufy000elfy.github.io/STRG-journal/' }
		],
		'Fred Whitley': [
			{ label: 'Strega Nona (text adventure)', url: 'https://playfic.com/games/phredmorris/strega-nona' },
			{ label: 'Concepts and Play', url: 'https://phredmorris.github.io/Concepts-and-Play/' },
			{ label: 'Midterm', url: 'https://github.com/phredmorris/Midterm' },
			{ label: 'Doily generator (he then made the doilies by hand)', url: 'https://github.com/phredmorris/TattingGenerator' }
		],
		'Julia Solines': [
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
		],
		'Kamai Williams': [
			{ label: 'Make a Sandwich for Lunch (text adventure)', url: 'https://kamaiwilliams.github.io/sandwhich-text-adventure/' },
			{ label: 'Inspecting Theta.NYC Exhibitions', url: 'https://kamaiwilliams.github.io/nine-eleven/' },
			{ label: 'Examples of Dark Patterns', url: 'https://kamaiwilliams.github.io/nine-eighteen/index.html' },
			{ label: 'Loop Pad', url: 'https://kamaiwilliams.github.io/chopandscrew/loop-pad.html' },
			{ label: 'Where the Cows Move', url: 'https://kamaiwilliams.github.io/cow-tracker/' },
			{ label: 'Keyboard Pixel Visualizer', url: 'https://kamaiwilliams.github.io/generative-art/' },
			{ label: 'Reach 4 Stars, a hand-tracking carpal tunnel exercise (final)', url: 'https://kamaiwilliams.github.io/hand-game/' }
		],
		'Max Dodziuk': [
			{ label: 'The Library (text adventure)', url: 'https://playfic.com/games/MADMAXDOD/the-library' },
			{ label: 'Web Dev Homework Report', url: 'https://madmaxdod.github.io/IntDesHomework1-/' },
			{ label: 'AI homework', url: 'https://madmaxdod.github.io/HWAI2/' },
			{ label: 'Plane Viewer', url: 'https://plane-viewer.vercel.app' },
			{ label: 'Degrading Editions, anonymous media hosting', url: 'https://madmaxdod.github.io/site/' },
			{ label: 'Border (final), with Campbell Cronk', url: 'https://border-gilt-three.vercel.app' }
		],
		'Samantha Kye': [
			{ label: 'a great day? (text adventure)', url: 'https://playfic.com/games/samanthakye/a-great-day' },
			{ label: 'Pinterest Notes', url: 'https://samanthakye.github.io/samanthakye/' },
			{ label: 'Misinformation and Dark Patterns', url: 'https://samanthakye.github.io/sk-darkpatterns/' },
			{ label: 'Portfolio', url: 'https://samanthakye.github.io/samkyeportfolio/' },
			{ label: 'dotted.', url: 'https://samanthakye.github.io/dotted/' },
			{ label: 'Interactive Dot Grid', url: 'https://samanthakye.github.io/finalproject/' },
			{ label: 'Audio Glitch Visualizer', url: 'https://samanthakye.github.io/finalproject2/' }
		],
		'Saskia (Kia) Lampe': [
			{ label: 'kia (text adventure; listed publicly as "A text adventure")', url: 'https://playfic.com/games/saucekia_l/kia' },
			{ label: 'A Manual for a Manual', url: 'https://saucekia.github.io/Week2WebsiteAboutAWebsite/' },
			{ label: 'Dark Patterns in Figma', url: 'https://saucekia.github.io/DarkPatterns/' },
			{ label: 'IMPRESS, software for making a good impression (midterm)', url: 'https://saucekia.github.io/IMPRESS/' },
			{ label: 'Tulip Roof', url: 'https://editor.p5js.org/Saucekia/full/zQF66zzRf' },
			{ label: 'Osci Draw (WaveDraw)', url: 'https://saucekia.github.io/WaveDraw/' },
			{ label: 'Gestural 3D model viewer', url: null }
		],
		// Not students. Their work is also shown under their own names on the
		// public page, as the user asked.
		'Oliver Coria (auditor)': [{ label: 'tap.in', url: 'https://tapppp.in/' }],
		'Suyeon Kim (auditor)': [{ label: 'Urban Fossil', url: 'https://suyeonkimdesign.github.io/urban-fossil/' }],
		'Revans Ragbir (friend, audited)': [
			{ label: 'Camera Flip-Dot Display (FlipDisc)', url: 'https://revanspr.github.io/FlipDisc/' }
		]
	}
};
