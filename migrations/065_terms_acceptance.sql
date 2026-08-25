-- Terms of Use acceptance (App Store Guideline 1.2: a UGC app must REQUIRE
-- users to agree to terms that state zero tolerance for objectionable content
-- and abusive users). NULL = has not accepted; the /app and /onboarding
-- layouts redirect to /terms/accept until it is set. New credential sign-ups
-- accept via a required checkbox on the form and get the timestamp at
-- creation; OAuth users and every pre-existing account hit the gate once.
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
