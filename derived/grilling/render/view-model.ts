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
  /** Near-tie note shown after the options, when the slots are near-tied. */
  nearTieNote?: string;
  /** Lineage display: which preference rules were considered. */
  lineage: LineageView;
  /** How to answer, including the correction affordance. */
  answerHint: string;
}

/** Display-ready lineage of the recommendation. */
export interface LineageView {
  /** Cold note when no active preference rule applies. */
  coldNote?: string;
  /** Rules considered, matched or set aside. */
  rules: { name: string; disposition: string }[];
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
    nearTieNote: ctx.nearTie
      ? `Near tie: options ${ctx.nearTie.slots.join("/")} roughly equivalent — differ on ${ctx.nearTie.differsOn}.`
      : undefined,
    lineage: {
      coldNote: ctx.lineage.cold ? "Cold: no active preference rule applies." : undefined,
      rules: ctx.lineage.rulesConsidered.map((rule) => ({ name: rule.name, disposition: rule.disposition })),
    },
    answerHint:
      'Reply in chat with a slot number, or "N, but actually because ..." to accept an option while overriding its stated reason.',
  };
}

/**
 * Annotation text for a slot kind.
 *
 * @param kind - The slot kind from the decision context.
 * @param citesRules - Preference rules the slot cites, when any.
 * @returns The badge text shown next to the option label.
 */
function badgeFor(kind: DecisionContext["options"][number]["kind"], citesRules?: string[]): string | undefined {
  const rules = citesRules?.length ? ` — per ${citesRules.join(", ")}` : "";
  if (kind === "usual") return `your usual${rules}`;
  if (kind === "usual-and-pick") return `recommended — matches your usual${rules ? ` (${citesRules!.join(", ")})` : ""}`;
  if (kind === "wildcard") return "wildcard";
  if (kind === "pick") return "my pick";
  return undefined;
}
