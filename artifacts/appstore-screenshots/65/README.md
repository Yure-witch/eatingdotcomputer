# 6.5" iPhone screenshots — 1284 × 2778

Same screens as the parent folder, captured at a 428 × 926 viewport (@3x) for
App Store Connect's **iPhone 6.5" Display** slot. The parent set is 1290 × 2796
(6.9"), which that slot rejects.

Captured, not rescaled: resampling the 6.9" art would soften every glyph and
the aspect ratio differs slightly (0.4613 vs 0.4622), which fails the same
dimension check it was meant to satisfy.

Regenerate (dev server on :5175):

    CAPTURE_W=428 CAPTURE_H=926 CAPTURE_OUT=artifacts/appstore-screenshots/65 \
      node artifacts/appstore-screenshots/_capture-session.mjs

Upload order, strongest first: real-02-chat → real-06-picker → real-01-home →
real-04-orbit → real-05-weeks. Skip real-07-gemma (empty "Say hi" state).
