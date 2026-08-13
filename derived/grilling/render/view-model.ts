/**
 * View model — the single presentation authority for a grilling session.
 * Both projections (page.ts → interactive DOM in the artifact, text.ts →
 * markdown fallback) render from this structure, so their content cannot
 * diverge.
 *
 * DECISION:ARCH — presentation content is computed once here rather than
 * separately in the DOM and markdown renderers; the projections only lay
 * out ViewModel fields, they never derive wording from the raw session.
 */

import type { GrillingSession, DecisionQuestion, AnswerState } from "./decision-context.ts";

/** Display-ready form of one grilling session. */
export interface SessionViewModel {
  /** Session title, e.g. "Grilling S1". */
  title: string;
  /** Questions in order. */
  questions: QuestionViewModel[];
  /** How to answer, including the correction affordance and shorthand. */
  answerHint: string;
}

/** Display-ready form of one question. */
export interface QuestionViewModel {
  /** Question id, e.g. "S1Q2". */
  id: string;
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
  /**
   * Candidate rejection reasons for the checkbox UI: every listed slot's
   * if-clause, labeled by its slot id. Several may apply to one ruling.
   */
  candidateReasons: { slot: string; reason: string }[];
  /** Display of the recorded answer; absent while the question is open. */
  answered?: AnsweredView;
}

/** Display-ready form of one slot. */
export interface OptionView {
  /** 1-based slot number. */
  number: number;
  /** Slot id, e.g. "A1". */
  id: string;
  /** Short name of the option. */
  label: string;
  /**
   * Slot annotation: "prediction — matches your usual",
   * "recommendation — my pick", "recommendation — my pick (cold)",
   * "wildcard", or none for plain alternatives and the free-text slot.
   */
  badge?: string;
  /** Condition under which this option beats the recommendation. */
  ifClause?: string;
  /** What choosing this option entails (may carry `inline code` spans). */
  entails: string;
  /** Why not recommended, when it differs from the negated if-clause. */
  whyNotRecommended?: string;
  /** True for the renderer-appended free-text slot (gets a text box). */
  freeText?: boolean;
}

/** Display-ready lineage of the recommendation. */
export interface LineageView {
  /** Cold note when no active preference rule applies. */
  coldNote?: string;
  /** Rules considered, matched or set aside. */
  rules: { name: string; disposition: string }[];
}

/** Display of a recorded answer. */
export interface AnsweredView {
  /** Ruling line, e.g. "S1Q1A3: DuckDB, we already embed it elsewhere". */
  line: string;
  /** Confirmed rejection reasons, one line each, prefixed "Rejected:". */
  rejected: string[];
}

/**
 * Build the display form of a grilling session.
 *
 * @param session - A validated version-2 grilling session.
 * @returns The view model, with the free-text slot appended to every
 *   question so no renderer (or model) can forget it.
 */
export function buildViewModel(session: GrillingSession): SessionViewModel {
  return {
    title: `Grilling S${session.session}`,
    questions: session.questions.map((q) => buildQuestion(q, session.session)),
    answerHint:
      'Reply in chat with the answer id ("S1Q2A1" or just "1"), or "N, but actually because …" ("N, BAB …") to accept an option while overriding its stated reason. In the artifact page: click your answers, then use "Copy answers as JSON" and paste the result into chat.',
  };
}

/**
 * Build the display form of one question.
 *
 * @param q - The question.
 * @param session - The session number (for the S«s»Q«q» id).
 * @returns The question view model.
 */
function buildQuestion(q: DecisionQuestion, session: number): QuestionViewModel {
  const id = `S${session}Q${q.seq}`;
  const options: OptionView[] = q.options.map((option, i) => ({
    number: i + 1,
    id: `A${i + 1}`,
    label: option.label,
    badge: badgeFor(option.kind, q.lineage.cold),
    ifClause: option.ifClause,
    entails: option.entails,
    whyNotRecommended: option.whyNotRecommended,
  }));
  options.push({
    number: options.length + 1,
    id: `A${options.length + 1}`,
    label: "Free text",
    entails: "custom choice or custom rejection reasoning",
    freeText: true,
  });
  return {
    id,
    question: q.question,
    context: q.context,
    options,
    nearTieNote: q.nearTie
      ? `Near tie: options ${q.nearTie.slots.join("/")} roughly equivalent — differ on ${q.nearTie.differsOn}.`
      : undefined,
    lineage: {
      coldNote: q.lineage.cold ? "Cold: no active preference rule applies." : undefined,
      rules: q.lineage.rulesConsidered.map((rule) => ({ name: rule.name, disposition: rule.disposition })),
    },
    candidateReasons: q.options.flatMap((option, i) => (option.ifClause ? [{ slot: `A${i + 1}`, reason: option.ifClause }] : [])),
    answered: q.answer ? buildAnswered(q.answer, id, options) : undefined,
  };
}

/**
 * Build the display of a recorded answer.
 *
 * @param answer - The recorded answer state.
 * @param id - The question id, e.g. "S1Q1".
 * @param options - The question's option views, free-text slot included.
 * @returns The answered view.
 */
function buildAnswered(answer: AnswerState, id: string, options: OptionView[]): AnsweredView {
  if (answer.chosen === undefined) {
    return { line: `${id}: skipped`, rejected: [] };
  }
  const chosen = options[answer.chosen - 1];
  const ruling = chosen.freeText && answer.freeText ? answer.freeText : chosen.label;
  const correction = answer.correction ? ` — but actually because ${answer.correction}` : "";
  return {
    line: `${id}${chosen.id}: ${ruling}${correction}`,
    rejected: (answer.rejectionReasons ?? []).map((reason) => `Rejected: ${reason}`),
  };
}

/**
 * Annotation text for a slot kind.
 *
 * @param kind - The slot kind from the decision question.
 * @param cold - Whether the question's recommendation is cold.
 * @returns The badge text shown next to the option label, if any.
 */
function badgeFor(kind: DecisionQuestion["options"][number]["kind"], cold: boolean): string | undefined {
  if (kind === "usual" || kind === "usual-and-pick") return "prediction — matches your usual";
  if (kind === "pick") return cold ? "recommendation — my pick (cold)" : "recommendation — my pick";
  if (kind === "wildcard") return "wildcard";
  return undefined;
}
