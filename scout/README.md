# Scout — kahan research worker

Polls eating.computer for search jobs (student interests), looks them up on
**are.na** and **Wikipedia**, and posts link results back. Gemma's digest
uses the results for real, clickable inspiration links.

Kahan's inbound ports are firewalled, so this runs as a **puller**: it only
makes outbound HTTPS requests. No ports to open, no tunnel, no npm install
(plain Node 18+).

## Deploy to kahan

From the repo root on your Mac:

```sh
scp -r scout cooper-kahan:~/scout
ssh cooper-kahan
```

On kahan:

```sh
cd ~/scout
node --version          # needs >= 18; if missing/old, try: module load node  (or ask EE IT)
cp scout.env.example scout.env
nano scout.env          # paste the SCOUT_TOKEN from the app's .env
./run.sh                # foreground test — you should see "scout up — polling …"
```

Then keep it alive in the background (pick one):

```sh
# simplest — survives logout:
nohup ./run.sh >> scout.log 2>&1 &

# or, if kahan allows user systemd (survives reboots):
mkdir -p ~/.config/systemd/user
cp scout.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now scout
loginctl enable-linger $USER   # keep it running after logout
```

## Wiring on the app side

- `SCOUT_TOKEN` must be set in the app's env (already in local `.env`;
  add the same value to Vercel → Project → Environment Variables).
- The app enqueues jobs in Turso (`scout_jobs`); this worker claims them via
  `GET /api/scout/jobs` and reports via `POST /api/scout/jobs`.
- Manage → Gemma shows whether Scout is online (heartbeat = last poll).

## Test end-to-end

With the worker running, from your Mac:

```sh
curl -X POST https://eating.computer/api/gemma/digest \
  -H 'Content-Type: application/json' -b '<your session cookie>' \
  -d '{"userId":"<a student with interests set>"}'
```

…or just use Manage → Gemma → "Send test digest". The digest's inspiration
line should include a real are.na / Wikipedia link.

## Adding sources later

`scout.js` → `runSearch()` fans out per source. Each source is a small
`async (query) => [{title,url,snippet,source,image}]`. Keep the politeness
rules: go through `politeFetch` (identified UA, 1 req/s per host, 12s
timeout) and prefer official APIs over HTML scraping.
