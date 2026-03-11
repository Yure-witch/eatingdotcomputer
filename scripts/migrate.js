import { createClient } from '@libsql/client';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

config({ path: '.env' });

const __dir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dir, '../migrations');

const db = createClient({
	url: process.env.TURSO_DATABASE_URL,
	authToken: process.env.TURSO_AUTH_TOKEN
});

await db.execute(`
	CREATE TABLE IF NOT EXISTS _migrations (
		filename TEXT NOT NULL PRIMARY KEY,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

const applied = new Set(
	(await db.execute('SELECT filename FROM _migrations')).rows.map((r) => r.filename)
);

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
	if (applied.has(file)) {
		console.log(`skip  ${file}`);
		continue;
	}
	const sql = await readFile(join(migrationsDir, file), 'utf8');
	await db.executeMultiple(sql);
	await db.execute({ sql: 'INSERT INTO _migrations (filename) VALUES (?)', args: [file] });
	console.log(`apply ${file}`);
}

console.log('done');
