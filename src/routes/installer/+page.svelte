<!--
	Dev Starter Kit — a public, unauthenticated download page for the macOS
	dev-machine installer. The files themselves live in static/installer/
	(install.sh + the two package lists it reads + a zip of the kit), so the
	one-liner below works with plain curl, no session needed.
-->
<script>
	const command = 'curl -fsSL https://www.eating.computer/installer/install.sh | bash';
	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(command);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch { /* clipboard blocked — the command is selectable anyway */ }
	}
</script>

<svelte:head>
	<title>Dev Starter Kit — eating.computer</title>
	<meta name="description" content="One command to set up a Mac for software development." />
</svelte:head>

<main>
	<h1>Dev Starter Kit</h1>
	<p class="updated">macOS · safe to re-run</p>

	<p class="lede">
		One command sets up a Mac for software development. Anything you already have
		is skipped, and it prints a summary of what was installed at the end.
	</p>

	<h2>Install</h2>
	<p>Open <strong>Terminal</strong>, paste this, and press Return:</p>
	<div class="cmd">
		<code>{command}</code>
		<button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
	</div>
	<p class="small">
		No password, no Homebrew, no Xcode tools — about two minutes on a good
		connection. Prefer a download?
		<a href="/installer/dev-starter-kit.zip" download>dev-starter-kit.zip</a> —
		unzip it, then right-click <em>Install Dev Tools.command</em> → Open.
		You can also <a href="/installer/install.sh">read the script</a> first.
	</p>

	<h2>What you get</h2>
	<ul>
		<li><strong>Claude Code</strong> and <strong>opencode</strong></li>
		<li><strong>VS Code</strong> and <strong>Antigravity</strong></li>
		<li><strong>GitHub Desktop</strong> and <strong>Git</strong></li>
		<li><strong>Google Chrome</strong></li>
		<li><strong>Node.js</strong> (with npm)</li>
		<li><strong>Python 3.13</strong> and <strong>uv</strong></li>
		<li>
			Python tools: ruff, black, mypy, ipython, jupyterlab, pre-commit, httpie, poetry
		</li>
		<li>
			Python libraries in <code>~/.venvs/dev</code>: requests, httpx, pydantic, numpy,
			pandas, matplotlib, pillow, beautifulsoup4, sqlalchemy, fastapi, flask, pytest,
			and more
		</li>
	</ul>

	<h2>Afterwards</h2>
	<ol>
		<li>Open a new Terminal window.</li>
		<li>Run <code>claude</code> and sign in. Run <code>opencode</code> and pick a provider.</li>
		<li>Open GitHub Desktop and sign in to GitHub.</li>
		<li>Python: <code>source ~/.venvs/dev/bin/activate</code>, or pick “Python (dev)” as the kernel in VS Code or Jupyter.</li>
	</ol>
</main>

<style>
	main {
		/* A global `main` rule makes it a centering grid; undo all of it
		   (justify-items centers block children too in current browsers). */
		display: block;
		place-items: normal;
		min-height: 0;
		overflow: visible;
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		max-width: 44rem;
		margin: 0 auto;
		padding: 4rem 1.5rem 6rem;
		font-family: 'Space Grotesk', -apple-system, system-ui, sans-serif;
		font-size: 1rem;
		line-height: 1.65;
		color: #1a1414;
		background: #fff8f7;
	}

	/* Standalone page: readable before any app CSS or theme variables load. */
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

	.small { font-size: 0.9rem; color: #4a3e3e; }

	ul, ol { padding-left: 1.25rem; margin: 0 0 1rem; }
	li { margin: 0 0 0.35rem; }

	a { color: inherit; text-underline-offset: 2px; }

	code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.875em;
	}

	.cmd {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0 0 1rem;
		padding: 0.75rem 0.75rem 0.75rem 1rem;
		background: #1a1414;
		color: #fff8f7;
		border-radius: 10px;
	}

	.cmd code {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		white-space: nowrap;
		user-select: all;
	}

	.cmd button {
		flex: none;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.35rem 0.8rem;
		border: 0;
		border-radius: 6px;
		background: #fff8f7;
		color: #1a1414;
		cursor: pointer;
	}
</style>
