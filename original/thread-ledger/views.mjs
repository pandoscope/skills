// Thread ledger — every view of the folded state.
//
// Pure and browser-safe, like `core.mjs`: these functions build strings
// and take no filesystem. The page calls them after folding the events
// it was given; the CLI calls the Markdown one. Neither view computes
// state of its own.
//
// This module is the import surface; the implementation is one file per
// concern under `views/`. `bundle()` in `store/pages.mjs` inlines those
// files directly, in dependency order — it strips module syntax, so a
// re-export here carries no code into the published page.

export * from "./views/css.mjs";
export * from "./views/html.mjs";
export * from "./views/prompts.mjs";
export * from "./views/summary.mjs";
export * from "./views/markdown.mjs";
export * from "./views/stretches.mjs";
export * from "./views/rows.mjs";
