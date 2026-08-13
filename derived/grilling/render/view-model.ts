/**
 * View model — the single presentation authority for a grilling question.
 * Both projections (page.ts → DOM in the artifact, text.ts → markdown
 * fallback) render from this structure, so their content cannot diverge.
 *
 * DECISION:ARCH — presentation content is computed once here rather than
 * separately in the DOM and markdown renderers; the projections only lay
 * out ViewModel fields, they never derive wording from the raw context.
 */

import type { DecisionContext } from "./decision-context.ts";

/** Display-ready form of one grilling question. */
export interface ViewModel {
  /** Section heading, e.g. "Q3". */
  heading: string;
  /** The question put to the user. */
  question: string;
  /** Session-local facts informing the recommendation, when given. */
  context?: string;
  /** All slots in order, free-text slot included. */
  options: OptionView[];
}

/** Display-ready form of one slot. */
export interface OptionView {
  /** 1-based slot number. */
  number: number;
  /** Short name of the option. */
  label: string;
  /** Slot annotation ("my pick", "your usual — per <rules>", ...), when any. */
  badge?: string;
  /** Condition under which this option beats the recommendation. */
  ifClause?: string;
  /** What choosing this option entails. */
  entails: string;
  /** Why not recommended, when it differs from the negated if-clause. */
  whyNotRecommended?: string;
}

/**
 * Build the display form of a decision context.
 *
 * @param ctx - A validated version-1 decision context.
 * @returns The view model, with the free-text slot appended after the
 *   listed options so no renderer (or model) can forget it.
 */
export function buildViewModel(ctx: DecisionContext): ViewModel {
  const options: OptionView[] = ctx.options.map((option, i) => ({
    number: i + 1,
    label: option.label,
    badge: badgeFor(option.kind, option.citesRules),
    ifClause: option.ifClause,
    entails: option.entails,
    whyNotRecommended: option.whyNotRecommended,
  }));
  options.push({
    number: options.length + 1,
    label: "Free text",
    entails: "custom choice or custom rejection reasoning",
  });
  return {
    heading: `Q${ctx.seq}`,
    question: ctx.question,
    context: ctx.context,
    options,
  };
}

/**
 * Annotation text for a slot kind.
 *
 * @param kind - The slot kind from the decision context.
 * @param citesRules - Preference rules the slot cites, when any.
 * @returns The badge text shown next to the option label.
 */
function badgeFor(kind: "usual" | "pick" | "usual-and-pick" | "wildcard", citesRules?: string[]): string {
  const rules = citesRules?.length ? ` — per ${citesRules.join(", ")}` : "";
  if (kind === "usual") return `your usual${rules}`;
  if (kind === "usual-and-pick") return `recommended — matches your usual${rules ? ` (${citesRules!.join(", ")})` : ""}`;
  if (kind === "wildcard") return "wildcard";
  return "my pick";
}
