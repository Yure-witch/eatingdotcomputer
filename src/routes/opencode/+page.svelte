<!--
	opencode + Gemma — public setup page for a machine that already has opencode
	(e.g. from /installer). The script lives in static/opencode/setup.sh: it asks
	for the student's OWN chatterbox key and writes ~/.config/opencode. The
	class-wide GEMMA_KEY is never published here.
-->
<script>
	const command = 'curl -fsSL https://www.eating.computer/opencode/setup.sh | bash';
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
	<title>opencode + Gemma — eating.computer</title>
	<meta name="description" content="Connect opencode to Cooper's Gemma model in one command." />
</svelte:head>

<main>
	<h1>opencode + Gemma</h1>
	<p class="updated">macOS · Linux · safe to re-run</p>

	<p class="lede">
		Already installed opencode? One command connects it to Gemma, the model Cooper
		hosts on chatterbox. You only need your own API key.
	</p>

	<h2>1. Get your API key</h2>
	<ol>
		<li>Log in at <a href="https://chatterbox.ee.cooper.edu/" target="_blank" rel="noopener">chatterbox.ee.cooper.edu</a> (through Kahan).</li>
		<li>Click your name in the <strong>bottom-left corner</strong> → <strong>Settings</strong>.</li>
		<li>Open <strong>Account</strong> → <strong>API keys</strong> → <strong>Show</strong>, then copy the key.</li>
	</ol>

	<h2>2. Run the setup</h2>
	<p>Open <strong>Terminal</strong>, paste this, and press Return:</p>
	<div class="cmd">
		<code>{command}</code>
		<button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
	</div>
	<p class="small">
		It asks for your key (nothing shows as you paste — that's normal), checks it with
		chatterbox, and writes opencode's config. If you already had an
		<code>opencode.json</code>, it's backed up first. You can
		<a href="/opencode/setup.sh">read the script</a> first.
	</p>

	<h2>3. Use it</h2>
	<ol>
		<li>Open a <strong>new</strong> Terminal window.</li>
		<li><code>cd</code> into a project folder.</li>
		<li>Run <code>opencode</code>. Gemma is already picked as the model.</li>
	</ol>
	<p class="small">
		Want a one-off answer without the full interface? Run
		<code>opencode run "your question"</code>.
	</p>

	<h2>If something's off</h2>
	<ul>
		<li><strong>“Model not found”</strong> — Cooper changed the model. Re-run the setup; it picks up the new one.</li>
		<li><strong>401 / unauthorized</strong> — your key changed. Copy it again from chatterbox and re-run the setup.</li>
		<li><strong>Replies are slow</strong> — it's one shared machine for the whole class, so busy times are slower.</li>
		<li><strong>No opencode yet?</strong> Run the <a href="/installer">Dev Starter Kit</a> first.</li>
	</ul>

	<details>
		<summary>Setting it up by hand</summary>
		<p class="small">
			Save your key in <code>~/.config/opencode/cooper-key</code>, then put this in
			<code>~/.config/opencode/opencode.json</code>:
		</p>
		<pre><code>{`{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "cooper": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cooper Chatterbox",
      "options": {
        "baseURL": "https://chatterbox.ee.cooper.edu/api/v1",
        "apiKey": "{file:~/.config/opencode/cooper-key}"
      },
      "models": {
        "nvidia/Gemma-4-26B-A4B-NVFP4": {
          "name": "Gemma",
          "options": {
            "extraBody": {
              "chat_template_kwargs": { "enable_thinking": false }
            }
          }
        }
      }
    }
  },
  "model": "cooper/nvidia/Gemma-4-26B-A4B-NVFP4"
}`}</code></pre>
		<p class="small">
			Keep <code>enable_thinking: false</code>. Without it, Gemma can think in
			circles until it runs out of room and replies with nothing.
		</p>
	</details>
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

	details { margin: 2.5rem 0 0; }
	summary { cursor: pointer; font-weight: 600; margin: 0 0 0.75rem; }

	pre {
		margin: 0 0 1rem;
		padding: 1rem;
		overflow-x: auto;
		background: #1a1414;
		color: #fff8f7;
		border-radius: 10px;
		font-size: 0.85rem;
		line-height: 1.5;
	}
</style>
