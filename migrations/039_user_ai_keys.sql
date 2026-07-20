-- Per-user credentials for a personal Gemma / OpenAI-compatible endpoint.
-- Each user brings their own API key (e.g. the Cooper EE "chatterbox"
-- service); keys are only ever returned to their owner, masked.
CREATE TABLE IF NOT EXISTS user_ai_keys (
	user_id TEXT NOT NULL PRIMARY KEY,
	base_url TEXT NOT NULL DEFAULT 'https://chatterbox.ee.cooper.edu/api/v1',
	api_key TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);
