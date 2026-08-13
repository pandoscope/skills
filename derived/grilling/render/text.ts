/**
 * Markdown projection of the grilling view model — the pure-text fallback
 * used when publishing an artifact is not possible.
 */

import type { ViewModel, OptionView } from "./view-model.ts";

/**
 * Render a view model as markdown.
 *
 * @param vm - The view model of one grilling question.
 * @returns Markdown text ending in a newline.
 */
export function renderMarkdown(vm: ViewModel): string {
  const lines: string[] = [`## ${vm.heading} — ${vm.question}`, ""];
  if (vm.context) lines.push(vm.context, "");
  for (const option of vm.options) lines.push(optionLine(option));
  if (vm.nearTieNote) lines.push("", vm.nearTieNote);
  lines.push("", "### Lineage", "");
  if (vm.lineage.coldNote) lines.push(vm.lineage.coldNote);
  for (const rule of vm.lineage.rules) lines.push(`- ${rule.name} — ${rule.disposition}`);
  lines.push("", `*${vm.answerHint}*`, "");
  return lines.join("\n");
}

/**
 * Format one slot as a numbered markdown list line.
 *
 * @param option - The slot to format.
 * @returns One line, e.g. "2. **SQLite** (wildcard, if ...) — zero ops".
 */
function optionLine(option: OptionView): string {
  const annotations = [option.badge, option.ifClause ? `if ${option.ifClause}` : undefined].filter(Boolean);
  const paren = annotations.length ? ` (${annotations.join(", ")})` : "";
  const whyNot = option.whyNotRecommended ? ` — why not recommended: ${option.whyNotRecommended}` : "";
  return `${option.number}. **${option.label}**${paren} — ${option.entails}${whyNot}`;
}
