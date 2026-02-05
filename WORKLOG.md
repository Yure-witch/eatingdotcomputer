# Work Log

## 2026-02-04
- Added local environment file with Auth.js, Turso, and R2 variables (values provided by user).
- Verified git remote configuration.
- Updated R2 client to accept `R2_ENDPOINT` override.
- Expanded `.env.example` and `README.md` to include Auth.js + public Turso/R2 env vars.
- Replaced `.env` contents with placeholders.
- Rebuilt landing page to display `eating.computer` in four type styles with hover font swapping.
- Simplified landing page so only `eating.computer` appears.
- Added product roadmap for Turso/R2, auth, weekly highlights, and chat system.
- Added Cambridge font assets and updated landing to single-line, even-spacing hover font swap.
- Forced single-line typography to prevent wrapping.
- Centered the line and stabilized letter widths across font swaps.
- Simplified styling: removed gradients and hover transforms, tightened spacing.
- Added per-font scaling so Cambridge renders larger than other fonts.
- Raised the non-Cambridge font scales to reduce visible shrink while keeping Cambridge largest.
- Reduced jitter by centering letter glyphs and refining width measurement precision.
- Increased Cambridge scale slightly.
- Reverted Cambridge scale increase to keep layout stable.
