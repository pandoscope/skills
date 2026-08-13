/**
 * Decision context — the JSON contract between the grilling model and the
 * renderers. The model authors ONLY this data; every user-facing form
 * (artifact HTML, text fallback) is derived from it mechanically, so the
 * question format cannot drift.
 *
 * This module is the single authority for the schema: types define the
 * shape, `validateDecisionContext` enforces it. There is no separate
 * JSON-Schema file to keep in sync.
 */

/** One grilling question put to the user, with full provenance. */
export interface DecisionContext {
  /** Schema version; this module implements version 1. */
  version: 1;
  /** 1-based sequence number of the question within the session. */
  seq: number;
  /** The decision being put to the user, phrased as a question. */
  question: string;
  /**
   * Session-local facts informing the recommendation, written BEFORE the
   * ruling (input side of the replay-ready record).
   */
  context?: string;
  /**
   * Listed options, slot 1..N in order (1-3 entries). The free-text slot
   * is appended by the renderers automatically and must not be listed.
   */
  options: DecisionOption[];
  /** Near-tie between listed slots (1-based) and what they differ on. */
  nearTie?: NearTie;
  /** Which preference rules were considered — the lineage display. */
  lineage: Lineage;
}

/** A listed option (slot) of a grilling question. */
export interface DecisionOption {
  /** Short name of the option (the "X"). */
  label: string;
  /**
   * Slot semantics per the grilling skill:
   * "usual" = what the active preference set predicts,
   * "pick" = the agent's independent best,
   * "usual-and-pick" = the merged slot when prediction and recommendation
   * coincide, "wildcard" = exploratory branch.
   */
  kind: "usual" | "pick" | "usual-and-pick" | "wildcard";
  /** Condition under which this option beats the recommendation. */
  ifClause?: string;
  /** What choosing this option entails. */
  entails: string;
  /**
   * Names of active preference rules this slot cites. Required non-empty
   * for "usual" and "usual-and-pick" slots.
   */
  citesRules?: string[];
  /**
   * Why this option is not recommended — only when the reason differs
   * from the negated if-clause.
   */
  whyNotRecommended?: string;
}

/** Near-tie marker between listed slots. */
export interface NearTie {
  /** 1-based slot numbers that are roughly equivalent (at least two). */
  slots: number[];
  /** What the tied slots differ on. */
  differsOn: string;
}

/** Provenance of the recommendation: preference rules considered. */
export interface Lineage {
  /** True when no active preference rule applies (cold recommendation). */
  cold: boolean;
  /** Active preference rules considered, matching or set aside. */
  rulesConsidered: ConsideredRule[];
}

/** One preference rule weighed while forming the recommendation. */
export interface ConsideredRule {
  /** Rule name as it appears in the active preference set. */
  name: string;
  /** Why the rule matched or was set aside for this decision. */
  disposition: string;
}

/**
 * Validate an untyped value as a version-1 DecisionContext.
 *
 * @param value - Parsed JSON of unknown shape.
 * @returns The same value, typed, when it satisfies the schema.
 * @throws Error naming the offending field and its value on the first
 *   violation found.
 */
export function validateDecisionContext(value: unknown): DecisionContext {
  throw new Error(`NotImplementedError: validateDecisionContext(${JSON.stringify(value)?.slice(0, 80)})`);
}
