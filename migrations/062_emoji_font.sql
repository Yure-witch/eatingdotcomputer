-- Per-user default emoji face.
--
-- The live choice still lives in localStorage['emoji-font'] ('noto' | 'system')
-- and the picker's settings panel still owns it. This column only supplies the
-- DEFAULT for a user who has never picked one — localStorage is per-browser, so
-- a fresh profile (an App Store screenshot capture, a new device, the native
-- shell's first launch) would otherwise fall back to Noto.
--
-- NULL = no server-side default, client keeps its own ('noto').
-- 'system' = the platform face, i.e. Apple/iOS emoji on iPhone and macOS.
ALTER TABLE users ADD COLUMN emoji_font TEXT;

-- The App Store review accounts must show iOS emoji in the listing
-- screenshots and to the reviewer on-device.
UPDATE users SET emoji_font = 'system' WHERE email LIKE '%@review.eating.computer';
