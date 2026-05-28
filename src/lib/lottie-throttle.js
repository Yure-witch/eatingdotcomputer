// App-wide cap on concurrently-playing lottie engines. Shared between the picker
// (LottieSticker) and the chat bubble mounting path. Set high (200) so every
// on-screen animation can play even when scrolling fast — accepts main-thread
// lag in exchange for "everything moves all the time" until the rlottie-wasm
// migration lands.
export const PLAY_CAP = 200;
let _playing = 0;
export function tryPlay() { if (_playing < PLAY_CAP) { _playing++; return true; } return false; }
export function yieldPlay() { _playing = Math.max(0, _playing - 1); }
export function playingCount() { return _playing; }
