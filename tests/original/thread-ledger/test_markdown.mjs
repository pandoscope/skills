// The Markdown view, and the maps the store carries beside the log.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fold,
  orderOpen,
  validate,
} from "../../../original/thread-ledger/core.mjs";
import {
  bar,
  linkify,
  renderBody,
  renderMarkdown,
  singlePrompt,
  stalePrompt,
} from "../../../original/thread-ledger/views.mjs";
import { push } from "../../../original/thread-ledger/ledger.mjs";
import {
  opened,
  throws,
} from "./helpers.mjs";

// -------------------------------------------------------- markdown view

describe("MarkdownView", () => {
  const md = (events, codes = {}) => renderMarkdown(fold(events), "t", null, codes);

  it("the bar shows its extent when empty", () => {
    assert.equal(bar(0).length, 10);
    assert.match(bar(0), /^░+$/);
  });

  it("the bar never overflows its width", () => {
    for (const pct of [0, 1, 33, 50, 99, 100, 150, -5]) {
      assert.equal([...bar(pct)].length, 10, `pct=${pct}`);
    }
  });

  it("it carries no css or script", () => {
    const page = md([opened("a")]);
    assert.doesNotMatch(page, /<style|<script|class=/);
  });

  it("notes hide behind a details disclosure", () => {
    const page = md([opened("a"), { ev: "progress", thread: "a", pct: 5, note: "the note" }]);
    assert.match(page, /<details><summary>note<\/summary>the note<\/details>/);
  });

  it("blockers and triggers are visible without a click", () => {
    const page = md([opened("a"), { ev: "blocked", thread: "a", on: "principal", what: "your call" }]);
    assert.match(page, /blocked · you/);
    assert.match(page, /your call/);
    assert.doesNotMatch(page, /<details><summary>note/);
  });

  it("ticket references in reasons become links", () => {
    const page = md([opened("a"), { ev: "blocked", thread: "a", on: "external", what: "waits on o/r#5" }]);
    assert.match(page, /\[o\/r#5\]\(https:\/\/github\.com\/o\/r\/issues\/5\)/);
  });

  it("both views read the same fold", () => {
    // A second view, never a second source.
    const events = [
      opened("a"),
      opened("b", { ticket: "o/r#2" }),
      { ev: "completed", thread: "b" },
    ];
    const threads = fold(events);
    const page = renderMarkdown(threads, "t");
    assert.equal(orderOpen(threads).length, 1);
    assert.match(page, /### Done/);
  });

  it("the generated banner warns against editing", () => {
    assert.match(md([opened("a")]), /overwritten on the next push/);
  });
});

// ------------------------------------------------------- stale tickets

describe("StaleTickets", () => {
  const OPEN = [opened("a")];

  it("a ticketless thread cannot go stale", () => {
    const history = [{ ev: "opened", thread: "a", title: "a", conversation_only: true }];
    throws(() => validate({ ev: "stale", thread: "a", what: "x" }, history), "no ticket");
  });

  it("stale needs what changed", () => {
    throws(() => validate({ ev: "stale", thread: "a" }, OPEN), "what");
  });

  it("a blocked thread can still go stale", () => {
    const history = [...OPEN, { ev: "blocked", thread: "a", on: "internal", what: "x" }];
    validate({ ev: "stale", thread: "a", what: "scope grew" }, history);
  });

  it("marking stale twice is rejected", () => {
    const history = [...OPEN, { ev: "stale", thread: "a", what: "x" }];
    throws(() => validate({ ev: "stale", thread: "a", what: "y" }, history), "already");
  });

  it("syncing an already current ticket is rejected", () => {
    throws(() => validate({ ev: "synced", thread: "a" }, OPEN), "not marked stale");
  });

  it("sync clears it and it can go stale again", () => {
    const history = [
      ...OPEN,
      { ev: "stale", thread: "a", what: "x" },
      { ev: "synced", thread: "a" },
    ];
    validate({ ev: "stale", thread: "a", what: "y" }, history);
    assert.equal(fold(history)[0].stale, null);
  });

  it("the marker and the button appear only when needed", () => {
    assert.doesNotMatch(renderBody(fold(OPEN), "t"), /tickets outdated/);
    const stale = [...OPEN, { ev: "stale", thread: "a", what: "scope grew" }];
    const body = renderBody(fold(stale), "t");
    assert.match(body, /tickets outdated/);
    assert.match(body, /class="info"/);
  });

  it("the marker carries what its prompt needs", () => {
    // The prompt is rendered, not assembled from data attributes: what
    // the button copies and what the reader can select must be one string.
    const stale = [...OPEN, { ev: "stale", thread: "a", what: "scope grew" }];
    const body = renderBody(fold(stale), "t");
    for (const fragment of ["o/r#1", "scope grew", "--ev synced --thread a"]) {
      assert.ok(body.includes(fragment), `missing ${fragment}`);
    }
  });

  it("the bulk prompt names every ticket", () => {
    // "Update the outdated tickets" would send the agent re-deriving
    // what the ledger already knows.
    const threads = [
      { thread: "a", ticket: "o/r#1", stale: "scope grew" },
      { thread: "b", ticket: "o/r#2", stale: "approach changed" },
    ];
    const prompt = stalePrompt(threads);
    for (const fragment of ["o/r#1", "scope grew", "o/r#2", "approach changed"]) {
      assert.ok(prompt.includes(fragment), `missing ${fragment}`);
    }
  });

  it("the single prompt closes its own loop", () => {
    const prompt = singlePrompt({ thread: "a", ticket: "o/r#1", stale: "scope grew" });
    assert.match(prompt, /--ev synced --thread a/);
  });

  it("staleness stays out of the markdown view", () => {
    // That view cannot copy a prompt, so a marker there would be a flag
    // nobody can act on.
    const stale = [...OPEN, { ev: "stale", thread: "a", what: "scope grew" }];
    assert.doesNotMatch(renderMarkdown(fold(stale), "t"), /outdated|scope grew/);
  });
});

// ---------------------------------------------------------- short codes

describe("ShortCodes", () => {
  const codes = { "pandoscope/skills": "SK" };

  it("a mapped repo renders its short code", () => {
    const events = [opened("a", { ticket: "pandoscope/skills#43" })];
    const body = renderBody(fold(events), "t", null, codes);
    assert.match(body, />SK#43</);
    assert.match(body, /https:\/\/github\.com\/pandoscope\/skills\/issues\/43/);
  });

  it("an unmapped repo falls back to its name", () => {
    const events = [opened("a", { ticket: "other/repo#7" })];
    assert.match(renderBody(fold(events), "t", null, codes), />other\/repo#7</);
  });

  it("a thread without a ticket has no prefix", () => {
    const events = [opened("a", { ticket: null, conversation_only: true })];
    assert.doesNotMatch(renderBody(fold(events), "t", null, codes), /class="ref"/);
  });
});

// ------------------------------------------------------- forge config

// The render path reads the same store config the response-hygiene
// check reads (skills#102): flat map = GitHub defaults, structured =
// the org's own base and patterns. Views take it as data.
describe("ForgeConfig", () => {
  const lab = {
    forge: "https://git.example.org",
    patterns: {
      ticket: "{base}/{repo}/-/issues/{n}",
      pr: "{base}/{repo}/-/merge_requests/{n}",
    },
    repos: { SK: "group/skills" },
  };
  const body = (events, forge) =>
    renderBody(fold(events), "t", null, {}, null, [], [], {}, forge);

  it("a structured config renders its own ticket pattern on the page", () => {
    const events = [opened("a", { ticket: "group/skills#5" })];
    assert.match(body(events, lab), /https:\/\/git\.example\.org\/group\/skills\/-\/issues\/5/);
    assert.doesNotMatch(body(events, lab), /github\.com/);
  });

  it("a structured config reaches notes and the markdown view", () => {
    const events = [
      opened("a", { ticket: "group/skills#5" }),
      { ev: "blocked", thread: "a", on: "internal", what: "see group/skills#9" },
    ];
    const md = renderMarkdown(fold(events), "t", null, {}, "", null, lab);
    assert.match(md, /git\.example\.org\/group\/skills\/-\/issues\/5/);
    assert.match(md, /git\.example\.org\/group\/skills\/-\/issues\/9/);
    assert.doesNotMatch(md, /github\.com/);
  });

  it("an absent config keeps the GitHub defaults byte-for-byte", () => {
    const events = [opened("a", { ticket: "o/r#1" })];
    assert.equal(body(events, {}), body(events, undefined));
    assert.match(body(events, {}), /https:\/\/github\.com\/o\/r\/issues\/1/);
  });

  it("linkify accepts the config too", () => {
    assert.match(
      linkify("see group/skills#3", lab),
      /git\.example\.org\/group\/skills\/-\/issues\/3/,
    );
  });
});
