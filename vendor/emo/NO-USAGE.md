# Emo 3.1.0: usage-key generation and storage code removed

Current artifact:

https://pub-62e59b4ebf1d45d2ad5f669369e907fe.r2.dev/vendor/emo/sdk-3.1.0-no-usage-v2/EmoWeb.wasm

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| npm/public R2 original | 4,873,339 | `bdc86f5d30c0b61311820e3e710096aeb5d93abce2e15924ad2d6fbd3c9721cb` |
| patched v2 / R2 | 4,866,733 | `405985f9591c72183f1aeeae522b27a27222d6cd29895686a42753e2785bd0a4` |

## What v2 removes

The previous v1 bypassed `TrackedSession` but retained its unused storage code.
V2 physically replaces these original function bodies with minimal stubs:

| Function | Original code removed | Replacement behavior |
| ---: | --- | --- |
| 406 | Tracked-session construction | Retain/copy the underlying inference session via helper 232 |
| 2639 | Persistent device-key initialization | Empty string |
| 2640 | `ai.desertant.usage.<app>.<device>.state` construction | Empty string |
| 2641 | Persistent device-ID lookup, UUID generation, and write | Empty string |
| 2642 | Browser/injected usage-storage selection | Empty storage implementation with the original protocol metadata |
| 2646 | Host localStorage/usage-store lookup | No host |
| 2647 | Usage-storage `getItem` call | No value |
| 2648 | Usage-storage `setItem` call | No-op |
| 2672 | Default ingest-endpoint initialization | Empty string |
| 2673 | Reporting closure: serialization, beacon/send dispatch | No-op |
| 2681 | Usage-state key construction and load | Zero state |
| 2682 | Usage-state key construction and save | No-op |

The literal bytes for `ai.desertant.usage.`, `ai.desertant.usage.deviceId`,
`__dalUsageStore`, `__dalIngestEndpoint` (two occurrences), and the external
ingest URL are zeroed. None of these strings occurs anywhere in the output.
Zeroing preserves all memory addresses used by the rest of the module.

Function signatures and indices are preserved because Swift's protocol tables
refer to them. The replaced bodies contain no original key-generation, UUID,
storage, or send implementation. Other unused telemetry helpers/type metadata
remain; this is a targeted binary patch, not a source rebuild or full linker
prune. Generic JavaScript/Swift utilities are preserved for normal inference.

Imports, exports, model data, tables, and every other function body are unchanged.
The original npm file and previous immutable R2 objects are untouched. The patch
contains only bytes derived from the public vendor wasm and fixed replacement
instructions; it includes no private application code or environment data.

## Identification and ABI checks

The original wasm has no function-name section. Disassembly identified the
usage-key builders and persistence callbacks. A trace on the original store's
`setItem` confirmed:

- Device ID: function 2641 → function 2648 → JavaScript `setItem`.
- Usage state: function 2682 → function 2648 → JavaScript `setItem`.
- The session factories call function 406 (self-hosted path 2827, downloaded
  model path 386). Its retained copy uses helper 232; raw copying would break
  ownership when the caller releases its temporary session.

Source used to interpret the disassembly:
[desert-ant-core commit 2aed9c6](https://github.com/Desert-Ant-Labs/desert-ant-core/tree/2aed9c6d6459fc1843ab59553965035954e40199),
`Sources/Usage/Storage.swift`, `Transport.swift`, and
`Sources/Inference/UsageTracking.swift`. The source is a reference, not a claim
that this commit produced the npm binary. Exact whole-file and individual-body
hashes anchor every patch.

## Reproduce and verify

Run from the repository root:

```sh
node vendor/emo/tools/patch-usage.mjs
node vendor/emo/tools/verify-removed-usage.mjs
node vendor/emo/tools/verify-no-usage.mjs
node scripts/upload-emo-assets.mjs --wasm-only
node vendor/emo/tools/verify-no-usage.mjs --remote
node vendor/emo/tools/verify-chat-prewarm.mjs
```

`verify-removed-usage.mjs` checks every changed body and every unchanged section.
It adds test-only exports in memory and directly invokes all eleven removed
storage/reporting functions, verifying empty results, no storage accesses, and
no requests even without relying on the session-factory bypass. These test
exports are never written to the shipped artifact.

The browser tests need Vite on localhost:5175 (override with `EMO_TEST_ORIGIN`)
and Puppeteer. They compare real LiteRT predictions for nine phrases, grouped
calls, explicit device IDs, skin tone, repeated reloads, disposal, forced
flushes, pagehide and waits beyond the reporting debounce. Baseline reporting
attempts are answered by the test so nothing is sent to the vendor. All
localStorage get/set calls are recorded, including during SDK import/init.

Browser evidence: `no-usage-verification.json` and
`chat-prewarm-verification.json`. Safari/iOS has not been exercised.

Verified 2026-09-15 against the published v2 bytes: 0 storage accesses and 0
reporting attempts (original baseline: 103 and 6), exact prediction matches,
preload starting at 502ms, and no new localStorage entries. All 11 direct
internal calls passed. The production build passes on Node 20.19.0 and emits
the v2 URL; the public download matches the SHA above.

## Chat integration

Channel and DM chats start loading 500ms after mount and cancel the timer if
the conversation unmounts first. Model and emoji-name index initialization are
reused. An earlier typed phrase starts initialization immediately and waits for
its result. The 500ms delay is the loading start, not a download-completion
promise.

The application still removes old `ai.desertant.usage.*` entries saved by
previous builds. That cleanup is solely a migration: the v2 WASM cannot create
those entries, as verified independently of application code. No migration
marker is written. The existing `emoji-tone` preference is only read.

`vite.config.js` points to the v2 immutable URL. Emo remains pinned to 3.1.0 and
LiteRT to 2.5.3. The patcher refuses a different upstream SHA; a new SDK requires
fresh ABI analysis and a new versioned URL. The uploader refuses to overwrite
an existing object with different bytes. The patcher and verification sources
are tracked with the integration; downloaded models, generated WASM files,
and local browser-result logs remain excluded from Git. Runtime artifacts
are served from the versioned R2 URLs above.
