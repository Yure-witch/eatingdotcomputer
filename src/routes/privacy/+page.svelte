<!--
	Privacy policy. PUBLIC and unauthenticated on purpose — App Store Connect
	requires a Privacy Policy URL it can reach without signing in, and so does
	Google's OAuth consent screen.

	Keep this in sync with two things whenever data handling changes:
	  - ios/App/App/PrivacyInfo.xcprivacy (the shipped privacy manifest)
	  - the App Privacy questionnaire in App Store Connect
	Apple compares them, and a mismatch is a rejection.
-->
<svelte:head>
	<title>Privacy — eating.computer</title>
	<meta name="description" content="What eating.computer collects, why, and who it is shared with." />
</svelte:head>

<main>
	<h1>Privacy</h1>
	<p class="updated">Last updated: 21 August 2026</p>

	<p class="lede">
		eating.computer is a course platform for a college class. It collects what it
		needs to run the class and nothing else. It does not track you across other
		apps or websites, it shows no advertising, and it does not sell or share your
		information for advertising.
	</p>

	<h2>What is collected</h2>
	<dl>
		<dt>Account information</dt>
		<dd>
			Your name and email address, from whichever method you sign in with — Google,
			Apple, or an email and password. If you sign in with Apple and choose to hide
			your email, we only ever see Apple's relay address.
		</dd>

		<dt>Things you write and upload</dt>
		<dd>
			Messages, replies, reactions, assignment submissions, files and images you
			upload, and anything you put on your profile.
		</dd>

		<dt>Course activity</dt>
		<dd>
			Which assignments you have submitted, your read positions in conversations,
			and when you were last active — used to show unread markers, presence dots,
			and to pace reminders.
		</dd>

		<dt>Device tokens for notifications</dt>
		<dd>
			If you turn on notifications, an identifier for that device so notifications
			can reach it. Turning notifications off in your device settings stops this.
		</dd>
	</dl>

	<h2>What is not collected</h2>
	<ul>
		<li>No advertising identifiers, and no tracking across other companies' apps or sites.</li>
		<li>No location data.</li>
		<li>No contacts, calendars, or health data.</li>
		<li>No analytics or advertising SDKs.</li>
	</ul>

	<h2>Who can see it</h2>
	<p>
		People in your class can see your name, profile, and anything you post to a
		channel. Direct messages are visible to the people in that conversation. The
		instructor can see class content and can manage enrollment.
	</p>
	<p>
		Nobody outside your class sees class content, with one exception: a profile page
		you deliberately publish is public if you share its link.
	</p>

	<h2>Services used to run it</h2>
	<p>
		These providers process data on our behalf so the app can work. They are not
		permitted to use it for their own purposes.
	</p>
	<ul>
		<li><strong>Vercel</strong> — hosting</li>
		<li><strong>Turso</strong> — the database that stores accounts, coursework, and message history</li>
		<li><strong>Google Firebase</strong> — real-time delivery of chat while it is live</li>
		<li><strong>Cloudflare R2</strong> — storage for uploaded files and images</li>
		<li><strong>Apple Push Notification service</strong> and web push — notification delivery</li>
		<li><strong>Resend</strong> — email such as reminders</li>
		<li><strong>Google</strong> and <strong>Apple</strong> — only if you use them to sign in</li>
		<li><strong>Giphy</strong> — GIF search, when you search for a GIF</li>
	</ul>
	<p>
		The optional daily digest sends recent class-chat text to a language model to
		summarise it. It is off unless you turn it on, and you can turn it off at any
		time in your profile settings.
	</p>

	<h2>How long it is kept</h2>
	<p>
		Course content and messages are kept for as long as the class account exists, so
		the class has its own history. Uploaded files that are never attached to anything
		are deleted automatically within minutes. Ask the instructor to delete your
		account and we will remove your profile, your uploads, and your messages.
	</p>

	<h2>Children</h2>
	<p>
		The app is for enrolled college students and is not directed at children under 13.
	</p>

	<h2>Your choices</h2>
	<ul>
		<li>Notifications can be turned off in your device settings at any time.</li>
		<li>The daily digest is off by default and can be turned off again in your profile.</li>
		<li>You can ask for a copy of your data, or ask for your account to be deleted.</li>
	</ul>

	<h2>Changes</h2>
	<p>
		If this policy changes, the date at the top changes with it. Material changes will
		be announced in the class.
	</p>

	<h2>Contact</h2>
	<p>
		Questions, data requests, or deletion requests:
		<a href="mailto:richardyurewitch@gmail.com">richardyurewitch@gmail.com</a>
	</p>

	<p class="back"><a href="/">← eating.computer</a></p>
</main>

<style>
	main {
		max-width: 44rem;
		margin: 0 auto;
		padding: 4rem 1.5rem 6rem;
		font-family: 'Space Grotesk', -apple-system, system-ui, sans-serif;
		font-size: 1rem;
		line-height: 1.65;
		color: #1a1414;
		background: #fff8f7;
	}

	/* The page is standalone — it must be readable before any app CSS or theme
	   variables load, since a reviewer may open it cold from a link. */
	:global(body:has(> div > main)) { background: #fff8f7; }

	h1 {
		font-size: 2.5rem;
		line-height: 1.1;
		margin: 0 0 0.25rem;
		letter-spacing: -0.02em;
	}

	.updated {
		margin: 0 0 2rem;
		font-size: 0.875rem;
		color: #7a6b6b;
	}

	.lede {
		font-size: 1.125rem;
		margin: 0 0 2.5rem;
	}

	h2 {
		font-size: 1.25rem;
		margin: 2.5rem 0 0.75rem;
		letter-spacing: -0.01em;
	}

	p { margin: 0 0 1rem; }

	ul {
		margin: 0 0 1rem;
		padding-left: 1.25rem;
	}

	li { margin-bottom: 0.4rem; }

	dl { margin: 0 0 1rem; }

	dt {
		font-weight: 600;
		margin-top: 1.25rem;
	}

	dd {
		margin: 0.25rem 0 0;
		padding-left: 0;
	}

	a { color: #b3123f; }

	.back {
		margin-top: 3.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid #e8d7d7;
		font-size: 0.9375rem;
	}

	@media (prefers-color-scheme: dark) {
		main { color: #f2eaea; background: #141010; }
		:global(body:has(> div > main)) { background: #141010; }
		.updated { color: #a09090; }
		a { color: #ff7fa3; }
		.back { border-top-color: #2e2222; }
	}
</style>
