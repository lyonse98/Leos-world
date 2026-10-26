// The build identifier attached to every analytics event (Oct 26,
// 2026): when Erik reports "the welcome didn't play," the events his
// build emitted can be separated from every other build's — the
// Oct 26 opener tests were briefly run against a stale bundle, and
// only manual bundle fingerprinting proved which build was live.
// __BUILD_ID__ is defined in vite.config.ts; the fallback keeps this
// module safe if the define is ever absent (tests, REPL builds).
export const BUILD_ID: string =
  typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
