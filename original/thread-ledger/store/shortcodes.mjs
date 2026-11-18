// The org's one shortcode map, read from the session's waybill checkout
// (pandoscope/pandoscope#61). Header contract: `../ledger.mjs`.
//
// The waybill's `shortcodes.json` is the source: shortcode → repository,
// flat or `{forge, patterns, repos}`. The store carries no map of its own,
// and a store map beside the waybill's is a second source, which fails.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { LedgerError } from "../core.mjs";

/** The maps a store has carried. Either one beside the waybill's is a second source. */
export const STORE_MAPS = [path.join("config", "shortcodes.json"), "repo-codes.json"];

/**
 * The session's waybill checkout: `WAYBILL_ROOT`, else `waybill` beside the store.
 *
 * Session clones sit side by side in the session root,
 * so the store's parent holds the waybill's clone.
 */
export function waybillOf(root, env = process.env) {
  return env.WAYBILL_ROOT || path.join(path.dirname(path.resolve(root)), "waybill");
}

/**
 * Read the org's shortcode map.
 *
 * Returns `{config, file, note}`. `config` is the waybill's map with its
 * `_`-keys (such as `_comment`) left out, or null when the session has no
 * waybill checkout; `note` then says where the map was looked for.
 * Throws LedgerError when the store holds a map beside the waybill's,
 * and when the waybill's map is not a JSON object.
 */
export function readShortcodeMap(root, env = process.env) {
  const file = path.join(waybillOf(root, env), "shortcodes.json");
  if (!fs.existsSync(file)) {
    // DECISION:FALLBACK: no waybill checkout in the session.
    // Missing: the org's shortcode map.
    // In its place: every reader works as it did without a map
    // (the response check reports unconfigured, the views show plain repository names).
    // Told: `note`, which the response check returns as its detail.
    // Test: "is absent without a waybill checkout" in test_shortcodes.mjs.
    return {
      config: null,
      file,
      note: `no waybill shortcode map at ${file}: the session has no waybill checkout beside the store, so no shortcode map was read`,
    };
  }
  const second = STORE_MAPS.filter((rel) => fs.existsSync(path.join(root, rel)));
  if (second.length) {
    throw new LedgerError(
      `the store holds a second shortcode map beside ${file}: ${second.join(", ")}. ` +
        "The waybill's map is the one source (pandoscope/pandoscope#61); remove the store's.",
    );
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new LedgerError(`cannot read the shortcode map ${file}: ${error}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new LedgerError(`the shortcode map ${file} is not an object`);
  }
  const plain = (map) => Object.fromEntries(Object.entries(map).filter(([key]) => !key.startsWith("_")));
  const config = data.repos ? { ...plain(data), repos: plain(data.repos) } : plain(data);
  return { config, file, note: null };
}

/** Repository → shortcode, for the views' labels; empty without a map. */
export function codesOf(config) {
  if (!config) return {};
  const repos = config.repos ?? config;
  return Object.fromEntries(Object.entries(repos).map(([short, repo]) => [repo, short]));
}
