-- Profile customization ("MySpace-style" profiles, phase 1).
-- JSON blob: { bg, font, fx, sig } — gradient preset id, display font id,
-- mouse-effect id, and a signature expression token (emoji / [tg:..] /
-- [tgc:..] / [ce:..] / emoji-kitchen token) shown big next to the name.
ALTER TABLE users ADD COLUMN profile_style TEXT;
