-- Avatar storage on users. The default flow generates a per-user
-- gradient + initial via Avatar.svelte (no DB rows needed — the
-- gradient hashes off the uid). When the user overrides the default
-- we persist what they chose here.
--
-- avatar_kind  — 'gen' | 'photo' | 'expr'
--   gen   — generative default. avatar_value MUST be NULL; the
--           component renders from the uid + name alone.
--   photo — uploaded photo. avatar_value is the R2 URL.
--   expr  — emoji / EK kitchen / custom emote / TG emote chosen via
--           the inline ExpressionPicker. avatar_value is the
--           canonical token (a bare emoji char, `[ek:…]`, `[ce:…]`,
--           `[tg:…]`, or `[tgc:…]`) so contentHtml + the existing
--           mountStaticEmotes pipeline render it everywhere.
--           Reaction images are deliberately excluded.
--
-- NULL default = 'gen' implicitly so every existing user keeps the
-- gradient avatar they already had without a migration backfill.
ALTER TABLE users ADD COLUMN avatar_kind  TEXT;
ALTER TABLE users ADD COLUMN avatar_value TEXT;
