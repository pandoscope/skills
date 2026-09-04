// Thread ledger — the event schema, the state machine and the fold.
//
// Pure and browser-safe: no imports beyond `core/`, no filesystem, no
// process. The recorder, the Markdown view and the page all compute
// state by calling in here, so there is exactly one implementation of
// what a thread's state is.
//
// This module is the import surface; the implementation is one file per
// concern under `core/`. `bundle()` in `ledger.mjs` inlines those files
// directly, in dependency order — it strips module syntax, so a
// re-export here carries no code into the published page.

export * from "./core/schema.mjs";
export * from "./core/transcript.mjs";
export * from "./core/forge.mjs";
export * from "./core/state.mjs";
export * from "./core/validate.mjs";
export * from "./core/measures.mjs";
