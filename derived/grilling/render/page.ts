/**
 * Client-side renderer of the grilling artifact page. Runs inside the
 * pre-built template: reads the injected decision-context JSON from the
 * data script tag and builds the DOM from the view model.
 *
 * Compiled and inlined into template.html by build.ts — the template is
 * static; data arrives only as JSON, never as concatenated HTML.
 */

import { buildViewModel } from "./view-model.ts";
import type { DecisionContext } from "./decision-context.ts";

/**
 * Create an element with a class and optional text.
 *
 * @param tag - Element tag name.
 * @param className - CSS class to set.
 * @param text - Text content (set via textContent; data is never markup).
 * @returns The created element.
 */
function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Render the decision context into the page.
 *
 * @param ctx - The injected decision context.
 * @param root - Container element to render into.
 */
function renderPage(ctx: DecisionContext, root: HTMLElement): void {
  const vm = buildViewModel(ctx);

  const header = el("header", "question-header");
  header.append(el("span", "question-seq", vm.heading));
  header.append(el("h1", "question-text", vm.question));
  root.append(header);

  if (vm.context) {
    const context = el("section", "context");
    context.append(el("h2", "section-heading", "Context"));
    context.append(el("p", "context-text", vm.context));
    root.append(context);
  }

  const list = el("ol", "options");
  for (const option of vm.options) {
    const item = el("li", "option");
    const head = el("div", "option-head");
    head.append(el("span", "option-number", String(option.number)));
    head.append(el("span", "option-label", option.label));
    if (option.badge) head.append(el("span", "option-badge", option.badge));
    item.append(head);
    if (option.ifClause) item.append(el("p", "option-if", `if ${option.ifClause}`));
    item.append(el("p", "option-entails", option.entails));
    if (option.whyNotRecommended) {
      item.append(el("p", "option-why-not", `why not recommended: ${option.whyNotRecommended}`));
    }
    list.append(item);
  }
  root.append(list);
}

const dataTag = document.getElementById("decision-context");
const root = document.getElementById("app");
if (!dataTag || !root) {
  throw new Error(`template is missing required nodes: decision-context=${!!dataTag}, app=${!!root}`);
}
renderPage(JSON.parse(dataTag.textContent ?? "") as DecisionContext, root);
