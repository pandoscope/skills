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

/**
 * Rank-order-centroid weights for an ordered list of n items: the item at
 * 1-based rank i gets w_i = (1/n) * sum_{k=i..n} 1/k. The standard way to
 * turn a pure priority ordering into weights when the items carry no
 * scores of their own — earlier entries weigh more, later entries still
 * count, weights sum to 1.
 *
 * @param n - Number of ranked items.
 * @returns Weights indexed by rank-1.
 */
export function rankOrderCentroid(n: number): number[] {
  const weights: number[] = [];
  for (let i = 1; i <= n; i++) {
    let sum = 0;
    for (let k = i; k <= n; k++) sum += 1 / k;
    weights.push(sum / n);
  }
  return weights;
}

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
   * Slot annotations, possibly several: "prediction — matches N of your
   * preferences", "recommendation — my pick", "recommendation — my pick
   * (cold)", "wildcard". A merged usual-and-pick slot carries both the
   * prediction and the recommendation badge. Empty for plain
   * alternatives and the free-text slot.
   */
  badges: string[];
  /** Condition under which this option beats the recommendation. */
  ifClause?: string;
  /** What choosing this option entails (may carry `inline code` spans). */
  entails: string;
  /** Footnote markers for matched preferences, shown after the entails. */
  footnotes: { marker: number; anchorId: string }[];
  /**
   * Normalized option score as percent of the question total (rounded),
   * with the per-contribution breakdown; absent when nothing scores.
   */
  score?: { pct: number; breakdown: { label: string; pct: number }[] };
  /** Agent-formulated candidate preferences, listed with the option. */
  proposedPreferences: string[];
  /** Why not recommended, when it differs from the negated if-clause. */
  whyNotRecommended?: string;
  /** True for the renderer-appended free-text slot (gets a text box). */
  freeText?: boolean;
}

/** Display-ready lineage of the recommendation. */
export interface LineageView {
  /** Cold note when no active preference rule applies. */
  coldNote?: string;
  /**
   * Footnote entries for every preference matched by any option of the
   * question: marker number, anchor id, name, 1-based rank in the
   * session's preference order, ROC weight as percent, and the lineage
   * disposition when the rule was explicitly considered.
   */
  footnotes: { marker: number; anchorId: string; name: string; rank: number; weightPct: number; disposition?: string }[];
  /** Rules considered but not matched by any option (e.g. set aside). */
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
    questions: session.questions.map((q) => buildQuestion(q, session.session, session.preferences ?? [])),
    answerHint:
      'Reply in chat with the answer id ("S1Q2A1" or just "1"), or "N, but actually because …" ("N, BAB …") to accept an option while overriding its stated reason. In the artifact page: click your answers, then use "Copy answers as JSON" and paste the result into chat.',
  };
}

/**
 * Build the display form of one question.
 *
 * @param q - The question.
 * @param session - The session number (for the S«s»Q«q» id).
 * @param preferences - The session's ordered preference names.
 * @returns The question view model.
 */
function buildQuestion(q: DecisionQuestion, session: number, preferences: string[]): QuestionViewModel {
  const id = `S${session}Q${q.seq}`;
  const weights = rankOrderCentroid(preferences.length);
  const topWeight = weights[0] ?? 1;

  // Footnotes: one entry per preference matched by any option, ordered by
  // preference rank, anchored so entails prose can reference them.
  const matchedNames = [...new Set(q.options.flatMap((o) => o.matches ?? []))].sort(
    (a, b) => preferences.indexOf(a) - preferences.indexOf(b),
  );
  const footnotes = matchedNames.map((name, i) => {
    const rank = preferences.indexOf(name) + 1;
    return {
      marker: i + 1,
      anchorId: `${id}-pref-${i + 1}`,
      name,
      rank,
      weightPct: Math.round(weights[rank - 1] * 100),
      disposition: q.lineage.rulesConsidered.find((r) => r.name === name)?.disposition,
    };
  });

  // Raw score per listed option: matched preference weights plus the
  // agent's own term, capped by the top preference weight so agent
  // judgment can never outvote the user's highest-ranked preference.
  const raw = q.options.map(
    (o) =>
      (o.matches ?? []).reduce((sum, name) => sum + weights[preferences.indexOf(name)], 0) +
      (o.agentScore ?? 0) * topWeight,
  );
  const total = raw.reduce((a, b) => a + b, 0);

  const options: OptionView[] = q.options.map((option, i) => ({
    number: i + 1,
    id: `A${i + 1}`,
    label: option.label,
    badges: badgesFor(option.kind, q.lineage.cold, option.matches?.length ?? 0),
    ifClause: option.ifClause,
    entails: option.entails,
    footnotes: (option.matches ?? []).map((name) => {
      const note = footnotes.find((f) => f.name === name)!;
      return { marker: note.marker, anchorId: note.anchorId };
    }),
    score:
      total > 0 && raw[i] > 0
        ? {
            pct: Math.round((raw[i] / total) * 100),
            breakdown: [
              ...(option.matches ?? []).map((name) => ({
                label: name,
                pct: Math.round((weights[preferences.indexOf(name)] / total) * 100),
              })),
              ...(option.agentScore
                ? [{ label: "my judgment", pct: Math.round(((option.agentScore * topWeight) / total) * 100) }]
                : []),
            ],
          }
        : undefined,
    proposedPreferences: option.proposedPreferences ?? [],
    whyNotRecommended: option.whyNotRecommended,
  }));
  options.push({
    number: options.length + 1,
    id: `A${options.length + 1}`,
    label: "Free text",
    badges: [],
    entails: "custom choice or custom rejection reasoning",
    footnotes: [],
    proposedPreferences: [],
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
      footnotes,
      rules: q.lineage.rulesConsidered
        .filter((rule) => !matchedNames.includes(rule.name))
        .map((rule) => ({ name: rule.name, disposition: rule.disposition })),
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
 * Annotation texts for a slot kind — a merged usual-and-pick slot carries
 * both the prediction and the recommendation badge.
 *
 * @param kind - The slot kind from the decision question.
 * @param cold - Whether the question's recommendation is cold.
 * @param matchCount - Number of preferences the slot matches.
 * @returns The badge texts shown next to the option label.
 */
function badgesFor(kind: DecisionQuestion["options"][number]["kind"], cold: boolean, matchCount: number): string[] {
  const prediction = `prediction — matches ${matchCount} of your preferences`;
  if (kind === "usual") return [prediction];
  if (kind === "usual-and-pick") return [prediction, "recommendation — my pick"];
  if (kind === "pick") return [cold ? "recommendation — my pick (cold)" : "recommendation — my pick"];
  if (kind === "wildcard") return ["wildcard"];
  return [];
}
