# kinetic-type — what variations.json is and isn't

`variations.json` is a dump of the GIF Studio's `liveOpts()` per mode, kept
because several modes have no `selectMode` branch and their canonical look
exists nowhere else as explicit numbers. For colours, scheme, seeds and the
mode-specific knobs, it's the authority.

**It is not a record of render timings.** `duration` on `coin` and `sphere`
says 3 and 6; the animations that shipped are 1.5s and 3.0s. The files are
right and the dump is generic.

`duration` is the loop PERIOD — `phase = (t / duration) % 1`, and the flip
scenes take `seg = floor(phase * n)`, so it's the period divided by the segment
count that sets the cadence. The shipped cadence is **1.5s per word-flip**
(`duration = words × 1.5s`), which is what Richard approved: `THESE` is one
word at 1.5s, `MAKING SOMETHING` is two at 3.0s.

The tempting reading — that the files are seamless half-period trims of a
3s/6s loop, which would make the cadence 3s a word — is wrong. Rendering each
scene at both candidate durations and diffing the frame at the file's length
against frame 0:

| | max channel delta | pixels differing |
|---|---|---|
| coin `THESE`, duration 1.5 → frame @1.5s | 0 | 0% |
| coin `THESE`, duration 3 → frame @1.5s | 255 | 4.8% |
| sphere 2 words, duration 3 → frame @3.0s | 0 | 0% |
| sphere 2 words, duration 6 → frame @3.0s | 255 | 4.9% |
| *control: two unrelated frames* | *255* | *4.8%* |

At 3/6 the mismatch is the size of two unrelated frames — not a loop point.
Coin can't be trimmed that way in principle either: `pitch = 0.38 *
sin(TAU * phase + 0.5)` (gen-art.js:4861) swings over the full period, so at
half period the coin sits at the opposite end of its nose-up/nose-down sweep
however symmetric the flip itself is.

Two other things that read as settings but are looks:

- **Garble renders at 4fps.** The chunky shuffle is the effect; at display rate
  it turns to fizz.
- **Type Orbit's unit is the pipe GROUP, not the word** (gen-art.js:5493): a
  `|` anywhere makes the pipe-separated groups the segments and `/` a line
  break inside one. The shipped render put the same phrase in both slots, so
  its 8s is 4s a hand-off, not 2s a word.

`src/lib/marquee-set.js` consumes these opts live and carries the same notes at
the point of use.
