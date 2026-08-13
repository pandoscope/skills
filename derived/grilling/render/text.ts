/**
 * Markdown projection of the grilling session view model — the pure-text
 * fallback used when publishing an artifact is not possible.
 */

import type { SessionViewModel, QuestionViewModel, OptionView } from "./view-model.ts";

/**
 * Render a session view model as markdown.
 *
 * @param vm - The view model of one grilling session.
 * @returns Markdown text ending in a newline.
 */
export function renderMarkdown(vm: SessionViewModel): string {
  const lines: string[] = [`# ${vm.title}`, ""];
  for (const question of vm.questions) lines.push(...questionLines(question));
  lines.push(`*${vm.answerHint}*`, "");
  return lines.join("\n");
}

/**
 * Format one question as markdown lines.
 *
 * @param q - The question view model.
 * @returns Lines for the question section, trailing blank line included.
 */
function questionLines(q: QuestionViewModel): string[] {
  const lines: string[] = [`## ${q.id} — ${q.question}`, ""];
  if (q.context) lines.push(q.context, "");
  for (const option of q.options) lines.push(optionLine(option));
  if (q.nearTieNote) lines.push("", q.nearTieNote);
  lines.push("", "### Lineage", "");
  if (q.lineage.coldNote) lines.push(q.lineage.coldNote);
  for (const note of q.lineage.footnotes) {
    const disposition = note.disposition ? ` — ${note.disposition}` : "";
    lines.push(`- [${note.marker}] ${note.name} (rank ${note.rank}, weight ${note.weightPct}%)${disposition}`);
  }
  for (const rule of q.lineage.rules) lines.push(`- ${rule.name} — ${rule.disposition}`);
  if (q.answered) {
    lines.push("", `> ${q.answered.line}`);
    for (const rejected of q.answered.rejected) lines.push(`> ${rejected}`);
  }
  lines.push("");
  return lines;
}

/**
 * Format one slot as an A-numbered markdown list line.
 *
 * @param option - The slot to format.
 * @returns One line, e.g. "A2. **SQLite** (wildcard, if ...) — zero ops [1] — score 23% (my judgment 23%)".
 */
function optionLine(option: OptionView): string {
  const annotations = [...option.badges, option.ifClause ? `if ${option.ifClause}` : undefined].filter(Boolean);
  const paren = annotations.length ? ` (${annotations.join(", ")})` : "";
  const refs = option.footnotes.length ? ` [${option.footnotes.map((f) => f.marker).join("][")}]` : "";
  const score = option.score
    ? ` — score ${option.score.pct}% (${option.score.breakdown.map((b) => `${b.label} ${b.pct}%`).join(", ")})`
    : "";
  const proposed = option.proposedPreferences.map((p) => ` — proposed preference: ${p}`).join("");
  const whyNot = option.whyNotRecommended ? ` — why not recommended: ${option.whyNotRecommended}` : "";
  return `${option.id}. **${option.label}**${paren} — ${option.entails}${refs}${score}${proposed}${whyNot}`;
}
