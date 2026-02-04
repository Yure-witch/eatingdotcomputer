# Eating.Computer Studio

A SvelteKit site built for a class studio: bold design, Turso data, Cloudflare R2 media, and Vercel hosting.

## Stack
- SvelteKit + `@sveltejs/adapter-vercel`
- Turso (`@libsql/client`)
- Cloudflare R2 (`@aws-sdk/client-s3`)

## Getting Started
```sh
npm install
npm run dev
```

## Environment Variables
Set these in `.env` for local dev and in Vercel for production:

```ini
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

## Database Table
The homepage expects an `entries` table with an `updated_at` column.

```sql
create table if not exists entries (
  id integer primary key,
  title text not null,
  body text,
  updated_at text default (datetime('now'))
);
```

## Deploying to Vercel
1. Push the repo to GitHub.
2. Import the project in Vercel.
3. Add the environment variables above.
4. Deploy.

## Notes
- If Turso or R2 env vars are missing, the page displays placeholders instead of failing.
- R2 is configured via the S3-compatible endpoint using your account ID.
