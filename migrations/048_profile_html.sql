-- Custom profile pages ("MySpace mode"): users can author a full HTML
-- document (their own CSS + JS included) that replaces the standard
-- profile card. Rendered inside a sandboxed iframe (opaque origin, no
-- cookies / app API access), so arbitrary scripts are safe to store.
ALTER TABLE users ADD COLUMN profile_html TEXT;
