-- Native iOS push (APNs) device tokens. The web app's web-push works only in
-- Safari/PWA; inside the Capacitor WKWebView we register with APNs instead and
-- store the device token here, keyed to the user. notifyUsers() sends to both.
CREATE TABLE IF NOT EXISTS apns_tokens (
	token       TEXT PRIMARY KEY,
	user_id     TEXT NOT NULL,
	platform    TEXT NOT NULL DEFAULT 'ios',
	created_at  TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apns_tokens_user ON apns_tokens (user_id);
