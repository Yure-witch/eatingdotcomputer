<!--
	Terms of Use / EULA. PUBLIC and unauthenticated on purpose — it is linked
	from the sign-up form, the login page, and the in-app acceptance gate
	(/terms/accept), and App Review must be able to read it cold from a link.

	App Store Guideline 1.2 requires that a UGC app's terms make explicitly
	clear there is NO TOLERANCE for objectionable content or abusive users,
	and that reports are acted on within 24 hours. Those two commitments live
	in "Content and conduct" below — do not soften them.
-->
<svelte:head>
	<title>Terms of Use — eating.computer</title>
	<meta name="description" content="The terms you agree to when you use eating.computer." />
</svelte:head>

<main>
	<h1>Terms of Use</h1>
	<p class="updated">Last updated: 25 August 2026</p>

	<p class="lede">
		eating.computer is the platform for a college studio class. Using it means
		agreeing to these terms. They are short, and most of them come down to one
		idea: this is a classroom, and everyone in it is expected to treat it like one.
	</p>

	<h2>Who can use it</h2>
	<p>
		The app is for students enrolled in the class, their instructor, and people
		reviewing the app. You need an account, and your account is yours — don't
		share it, and don't use someone else's. You must be at least 13 years old.
	</p>

	<h2>Content and conduct</h2>
	<p>
		Everything posted in the app — messages, submissions, files, profiles — is
		written by its members, and every member is responsible for what they post.
	</p>
	<p>
		<strong>There is no tolerance for objectionable content or abusive users.</strong>
		That includes harassment, threats, hate speech, sexually explicit material,
		spam, impersonation, and anything illegal. This is not a place where any of
		that is negotiated or warned about first: objectionable content is removed,
		and accounts that post it are ejected from the class and the app.
	</p>
	<p>How that is enforced:</p>
	<ul>
		<li>
			<strong>Flagging</strong> — every message can be reported from its own menu
			(<em>Report</em>). Reports go straight to the instructor's moderation queue
			with a snapshot of the content.
		</li>
		<li>
			<strong>Blocking</strong> — every member can block any other member
			(<em>Block</em> in the message menu). Blocking hides that person's messages
			from you instantly, stops their notifications to you, and notifies the
			moderator so the blocked user's behavior is reviewed. You can unblock from
			Edit profile.
		</li>
		<li>
			<strong>Moderation</strong> — reports are reviewed and acted on
			<strong>within 24 hours</strong>. Offending content is removed, and users
			who post it are removed from the platform.
		</li>
	</ul>

	<h2>Your content</h2>
	<p>
		What you make stays yours. By posting it you give the class the practical
		permissions needed to run the platform: storing it, showing it to the other
		members of your class, and backing it up. Nothing you post is sold or used
		for advertising.
	</p>

	<h2>Your account</h2>
	<p>
		You can delete your account at any time inside the app (Edit profile → Delete
		account) — deletion is immediate and permanent. We can suspend or remove
		accounts that break these terms, and, as above, will do so for anyone who
		posts objectionable content.
	</p>

	<h2>The service</h2>
	<p>
		The app is provided as-is, as a companion to a college course. It may change,
		gain or lose features, or be unavailable at times. Don't attempt to break,
		probe, or overload it, and don't use it to distribute malware or scrape other
		members' data.
	</p>

	<h2>Privacy</h2>
	<p>
		What is collected and why is described in the <a href="/privacy">privacy
		policy</a>, which is part of these terms.
	</p>

	<h2>Changes</h2>
	<p>
		If these terms change materially, the date above changes and the class will
		be told. Continuing to use the app after a change means accepting it.
	</p>

	<h2>Contact</h2>
	<p>
		Questions or reports:
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

	/* Standalone page — must be readable before any app CSS or theme
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
