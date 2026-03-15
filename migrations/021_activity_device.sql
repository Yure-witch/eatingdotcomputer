ALTER TABLE user_activity ADD COLUMN device_type TEXT; -- 'mobile' or 'desktop'
ALTER TABLE user_activity ADD COLUMN is_pwa      INTEGER; -- 1 = PWA, 0 = browser
