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
  const ctx = requireRecord(value, "decision context");
  if (ctx.version !== 1) {
    throw new Error(`version must be 1, got: ${JSON.stringify(ctx.version)}`);
  }
  if (typeof ctx.seq !== "number" || !Number.isInteger(ctx.seq) || ctx.seq < 1) {
    throw new Error(`seq must be a positive integer, got: ${JSON.stringify(ctx.seq)}`);
  }
  requireNonEmptyString(ctx.question, "question");
  if (ctx.context !== undefined) requireNonEmptyString(ctx.context, "context");

  if (!Array.isArray(ctx.options) || ctx.options.length < 1 || ctx.options.length > 3) {
    throw new Error(`options must list 1-3 slots (free text is appended automatically), got: ${JSON.stringify(ctx.options)}`);
  }
  const options = ctx.options.map((option, i) => validateOption(option, `options[${i}]`));

  const lineage = requireRecord(ctx.lineage, "lineage");
  if (typeof lineage.cold !== "boolean") {
    throw new Error(`lineage.cold must be a boolean, got: ${JSON.stringify(lineage.cold)}`);
  }
  if (!Array.isArray(lineage.rulesConsidered)) {
    throw new Error(`lineage.rulesConsidered must be an array, got: ${JSON.stringify(lineage.rulesConsidered)}`);
  }
  lineage.rulesConsidered.forEach((rule, i) => {
    const record = requireRecord(rule, `lineage.rulesConsidered[${i}]`);
    requireNonEmptyString(record.name, `lineage.rulesConsidered[${i}].name`);
    requireNonEmptyString(record.disposition, `lineage.rulesConsidered[${i}].disposition`);
  });

  const usualSlots = options.filter((o) => o.kind === "usual" || o.kind === "usual-and-pick");
  if (lineage.cold && usualSlots.length > 0) {
    throw new Error(`lineage.cold is true but slot "${usualSlots[0].label}" claims a usual kind — a cold recommendation has no applying rule`);
  }

  if (ctx.nearTie !== undefined) {
    const nearTie = requireRecord(ctx.nearTie, "nearTie");
    if (
      !Array.isArray(nearTie.slots) ||
      nearTie.slots.length < 2 ||
      nearTie.slots.some((s) => typeof s !== "number" || s < 1 || s > options.length)
    ) {
      throw new Error(`nearTie.slots must name at least two listed slots (1-${options.length}), got: ${JSON.stringify(nearTie.slots)}`);
    }
    requireNonEmptyString(nearTie.differsOn, "nearTie.differsOn");
  }

  return value as DecisionContext;
}

/**
 * Validate one listed option.
 *
 * @param value - Untyped option entry.
 * @param path - Field path for error messages, e.g. "options[0]".
 * @returns The option, typed.
 * @throws Error naming the offending field and value.
 */
function validateOption(value: unknown, path: string): DecisionOption {
  const option = requireRecord(value, path);
  requireNonEmptyString(option.label, `${path}.label`);
  requireNonEmptyString(option.entails, `${path}.entails`);
  const kinds = ["usual", "pick", "usual-and-pick", "wildcard"];
  if (typeof option.kind !== "string" || !kinds.includes(option.kind)) {
    throw new Error(`${path}.kind must be one of ${kinds.join("|")}, got: ${JSON.stringify(option.kind)}`);
  }
  if (option.kind === "usual" || option.kind === "usual-and-pick") {
    if (!Array.isArray(option.citesRules) || option.citesRules.length === 0) {
      throw new Error(`${path}.citesRules must name at least one preference rule for a "${option.kind}" slot, got: ${JSON.stringify(option.citesRules)}`);
    }
  }
  if (option.ifClause !== undefined) requireNonEmptyString(option.ifClause, `${path}.ifClause`);
  if (option.whyNotRecommended !== undefined) requireNonEmptyString(option.whyNotRecommended, `${path}.whyNotRecommended`);
  return value as DecisionOption;
}

/**
 * Require a value to be a plain object.
 *
 * @param value - The value to check.
 * @param path - Field path for error messages.
 * @returns The value as a string-keyed record.
 * @throws Error naming the field and value otherwise.
 */
function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object, got: ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

/**
 * Require a value to be a non-empty string.
 *
 * @param value - The value to check.
 * @param path - Field path for error messages.
 * @throws Error naming the field and value otherwise.
 */
function requireNonEmptyString(value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string, got: ${JSON.stringify(value)}`);
  }
}
