/**
 * Client-side renderer of the grilling artifact page. Runs inside the
 * pre-built template: reads the injected grilling-session JSON from the
 * data script tag and builds the interactive DOM from the view model —
 * next/previous navigation across questions, clickable answers whose
 * state persists while navigating, rejection-reason checkboxes, a
 * free-text box, a skip control, and a copy-answers-as-JSON export the
 * user pastes back into chat (and into decision memory).
 *
 * Compiled and inlined into template.html by build.ts — the template is
 * static; data arrives only as JSON, never as concatenated HTML.
 */

import { buildViewModel } from "./view-model.ts";
import type { QuestionViewModel } from "./view-model.ts";
import type { GrillingSession, AnswerState } from "./decision-context.ts";

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
 * Append text that may carry `backtick` spans, rendering them as <code>.
 *
 * @param parent - Element to append into.
 * @param text - The text, with backticks delimiting verbatim rules.
 */
function appendWithInlineCode(parent: HTMLElement, text: string): void {
  text.split("`").forEach((part, i) => {
    if (i % 2 === 0) {
      parent.append(document.createTextNode(part));
    } else {
      const code = document.createElement("code");
      code.textContent = part;
      parent.append(code);
    }
  });
}

/** The whole interactive page: state, navigation, and rendering. */
class GrillingPage {
  private readonly session: GrillingSession;
  private readonly vm: ReturnType<typeof buildViewModel>;
  /** Answer state per question seq — the single mutable state store. */
  private readonly answers: Map<number, AnswerState>;
  private current = 0;
  private readonly root: HTMLElement;

  /**
   * @param session - The injected grilling session.
   * @param root - Container element to render into.
   */
  constructor(session: GrillingSession, root: HTMLElement) {
    this.session = session;
    this.vm = buildViewModel(session);
    this.root = root;
    this.answers = new Map(session.questions.flatMap((q) => (q.answer ? [[q.seq, { ...q.answer }]] : [])));
    const firstOpen = session.questions.findIndex((q) => !q.answer);
    this.current = firstOpen === -1 ? session.questions.length - 1 : firstOpen;
    this.render();
  }

  /** Answer state of the question at the current index, created lazily. */
  private answerAt(index: number): AnswerState {
    const seq = this.session.questions[index].seq;
    let state = this.answers.get(seq);
    if (!state) {
      state = {};
      this.answers.set(seq, state);
    }
    return state;
  }

  /** Re-render the whole page from state. */
  private render(): void {
    this.root.replaceChildren();
    this.renderHeader();
    this.renderQuestion(this.vm.questions[this.current], this.answerAt(this.current));
    this.renderFooter();
  }

  /** Session title plus previous/next navigation. */
  private renderHeader(): void {
    const header = el("header", "session-header");
    header.append(el("span", "session-title", this.vm.title));

    const nav = el("nav", "question-nav");
    const prev = el("button", "nav-button", "‹ Previous");
    prev.onclick = () => this.goto(this.current - 1);
    if (this.current === 0) prev.setAttribute("disabled", "");
    const next = el("button", "nav-button", "Next ›");
    next.onclick = () => this.goto(this.current + 1);
    if (this.current === this.vm.questions.length - 1) next.setAttribute("disabled", "");
    nav.append(prev, el("span", "nav-position", `${this.current + 1} / ${this.vm.questions.length}`), next);
    header.append(nav);
    this.root.append(header);
  }

  /**
   * Move to another question. State needs no saving here — every control
   * writes into the answers map as it is used.
   */
  private goto(index: number): void {
    this.current = Math.min(Math.max(index, 0), this.vm.questions.length - 1);
    this.render();
  }

  /** One question: options, why-block, skip, near-tie, lineage. */
  private renderQuestion(q: QuestionViewModel, state: AnswerState): void {
    const header = el("div", "question-header");
    header.append(el("span", "question-seq", q.id + (state.skipped ? " — skipped" : "")));
    header.append(el("h1", "question-text", q.question));
    this.root.append(header);

    if (q.context) {
      const context = el("section", "context");
      context.append(el("h2", "section-heading", "Context"));
      context.append(el("p", "context-text", q.context));
      this.root.append(context);
    }

    const list = el("ol", "options");
    for (const option of q.options) {
      const item = el("li", "option" + (state.chosen === option.number ? " selected" : ""));
      item.onclick = () => {
        state.chosen = option.number;
        delete state.skipped;
        this.render();
      };
      const head = el("div", "option-head");
      head.append(el("span", "option-number", option.id));
      head.append(el("span", "option-label", option.label));
      if (option.badge) head.append(el("span", "option-badge", option.badge));
      item.append(head);
      if (option.ifClause) item.append(el("p", "option-if", `if ${option.ifClause}`));
      const entails = el("p", "option-entails");
      appendWithInlineCode(entails, option.entails);
      item.append(entails);
      if (option.whyNotRecommended) {
        item.append(el("p", "option-why-not", `why not recommended: ${option.whyNotRecommended}`));
      }
      if (option.freeText && state.chosen === option.number) {
        const input = document.createElement("textarea");
        input.className = "free-text-input";
        input.placeholder = "Your choice or reasoning …";
        input.value = state.freeText ?? "";
        input.onclick = (e) => e.stopPropagation();
        input.oninput = () => {
          state.freeText = input.value || undefined;
        };
        item.append(input);
      }
      list.append(item);
    }
    this.root.append(list);

    if (state.chosen !== undefined && state.chosen !== 1) this.renderWhyBlock(q, state);

    const controls = el("div", "question-controls");
    const skip = el("button", "skip-button", state.skipped ? "Skipped — undo" : "Skip this question");
    skip.onclick = () => {
      if (state.skipped) {
        delete state.skipped;
      } else {
        state.skipped = true;
        delete state.chosen;
      }
      this.render();
    };
    controls.append(skip);
    this.root.append(controls);

    if (q.nearTieNote) this.root.append(el("p", "near-tie", q.nearTieNote));

    const lineage = el("section", "lineage");
    lineage.append(el("h2", "section-heading", "Lineage"));
    if (q.lineage.coldNote) lineage.append(el("p", "lineage-cold", q.lineage.coldNote));
    const rules = el("ul", "lineage-rules");
    for (const rule of q.lineage.rules) {
      const item = el("li", "lineage-rule");
      item.append(el("span", "lineage-rule-name", rule.name));
      item.append(el("span", "lineage-rule-disposition", ` — ${rule.disposition}`));
      rules.append(item);
    }
    lineage.append(rules);
    this.root.append(lineage);
  }

  /**
   * Rejection-reason checkboxes plus the correction field — shown once
   * the selection diverges from slot 1 (the prediction/recommendation),
   * because that is when rejection reasons carry signal. Several reasons
   * may apply; each checked one is recorded verbatim.
   */
  private renderWhyBlock(q: QuestionViewModel, state: AnswerState): void {
    const block = el("section", "why-block");
    block.append(el("h2", "section-heading", "Why not A1? (check all that apply)"));
    for (const candidate of q.candidateReasons) {
      const label = el("label", "why-reason");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = (state.rejectionReasons ?? []).includes(candidate.reason);
      box.onchange = () => {
        const reasons = new Set(state.rejectionReasons ?? []);
        if (box.checked) {
          reasons.add(candidate.reason);
        } else {
          reasons.delete(candidate.reason);
        }
        state.rejectionReasons = reasons.size ? [...reasons] : undefined;
      };
      label.append(box, el("span", "why-reason-text", `${candidate.slot}: ${candidate.reason}`));
      block.append(label);
    }
    const correction = document.createElement("input");
    correction.type = "text";
    correction.className = "correction-input";
    correction.placeholder = "but actually because … (overrides the stated reason)";
    correction.value = state.correction ?? "";
    correction.oninput = () => {
      state.correction = correction.value || undefined;
    };
    block.append(correction);
    this.root.append(block);
  }

  /** Copy-answers export plus the answer hint. */
  private renderFooter(): void {
    const footer = el("footer", "session-footer");
    const copy = el("button", "copy-button", "Copy answers as JSON");
    const exportBox = document.createElement("textarea");
    exportBox.className = "export-box";
    exportBox.readOnly = true;
    exportBox.hidden = true;
    const note = el("p", "copy-note", "");
    note.hidden = true;
    copy.onclick = () => {
      const json = this.exportJson();
      exportBox.value = json;
      exportBox.hidden = false;
      navigator.clipboard.writeText(json).then(
        () => {
          note.textContent = "Copied — paste into chat (and decision memory).";
          note.hidden = false;
        },
        () => {
          // Clipboard access can be blocked in the sandbox; the failure
          // must be observable, never a silent no-op.
          note.textContent = "Clipboard blocked here — copy from the box below.";
          note.hidden = false;
          exportBox.select();
        },
      );
    };
    footer.append(copy, note, exportBox);
    footer.append(el("p", "answer-hint", this.vm.answerHint));
    this.root.append(footer);
  }

  /**
   * Serialize the answer state for pasting into chat / decision memory.
   *
   * @returns Pretty-printed JSON keyed by question id, e.g.
   *   {"session": 1, "answers": {"S1Q1": {"answer": "A3", ...}}}.
   */
  private exportJson(): string {
    const answers: Record<string, unknown> = {};
    this.session.questions.forEach((q, i) => {
      const state = this.answers.get(q.seq);
      if (!state || (state.chosen === undefined && !state.skipped)) return;
      const id = this.vm.questions[i].id;
      answers[id] = {
        ...(state.chosen !== undefined && { answer: `A${state.chosen}` }),
        ...(state.freeText && { freeText: state.freeText }),
        ...(state.rejectionReasons?.length && { rejectionReasons: state.rejectionReasons }),
        ...(state.correction && { correction: state.correction }),
        ...(state.skipped && { skipped: true }),
      };
    });
    return JSON.stringify({ session: this.session.session, answers }, null, 2);
  }
}

const dataTag = document.getElementById("decision-context");
const rootNode = document.getElementById("app");
if (!dataTag || !rootNode) {
  throw new Error(`template is missing required nodes: decision-context=${!!dataTag}, app=${!!rootNode}`);
}
new GrillingPage(JSON.parse(dataTag.textContent ?? "") as GrillingSession, rootNode);
