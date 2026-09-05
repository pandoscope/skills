// Accepted forms — what each workflow classifier must let through.
//
// The driver lab (skills#192, F7) refused correct work three times in
// one trial because a check matched one spelling of a rule the rule
// text allowed in several. So every classifier ships with the forms
// its rule accepts, as a table the check must pass BEFORE it may
// refuse anything, and the forms it must flag beside them. A row here
// is the contract; a check that fails a row is the defect, not the
// work.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bodyViolations,
  branchTickets,
  branchViolation,
  headerViolation,
} from "../../../original/thread-ledger/core/workflow.mjs";

// The org's own keyword file, as every stamped repo carries it.
const KEYWORDS = {
  allowed: { CLOSES: "closing", FIXES: "closing", ADVANCES: "non-closing" },
  github_native: ["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved"],
  branch_pattern: "claude/((?:[a-z][a-z0-9]*?)?\\d+(?:-(?:[a-z][a-z0-9]*?)?\\d+)*)-",
};

describe("branch-pattern: the forms the branch rule allows", () => {
  const accepted = [
    "claude/42-fix-auth",
    "claude/sk162-session-probe",
    "claude/sk130-aet221-arc",
    "claude/191-192-two-tickets",
    "claude/aet253-gate-rerun-contents",
  ];
  for (const branch of accepted) {
    it(`accepts ${branch}`, () => {
      assert.equal(branchViolation(branch, KEYWORDS.branch_pattern), null);
    });
  }

  const flagged = [
    ["main", "the default branch"],
    ["claude/kata", "no ticket token"],
    ["claude/fix-auth", "a description with no ticket"],
    ["feature/42-thing", "a foreign prefix"],
    ["claude/42", "a ticket with no description"],
    ["HEAD", "a detached head"],
  ];
  for (const [branch, why] of flagged) {
    it(`flags ${branch} (${why})`, () => {
      assert.ok(branchViolation(branch, KEYWORDS.branch_pattern));
    });
  }

  it("reads the ticket numbers off the tokens, shortcode or not", () => {
    assert.deepEqual(branchTickets("claude/sk130-aet221-arc", KEYWORDS.branch_pattern), ["130", "221"]);
    assert.deepEqual(branchTickets("claude/42-fix-auth", KEYWORDS.branch_pattern), ["42"]);
    assert.deepEqual(branchTickets("main", KEYWORDS.branch_pattern), []);
  });
});

describe("commit-headers: the forms commitlint accepts on a working branch", () => {
  const accepted = [
    "feat: add the thing",
    "fix(parser): accept owner/repo!n",
    "feat!: drop the v1 summary path",
    "refactor(core)!: split the fold",
    "docs(glossary): rename pando cell to pando worker",
    "test: stage a marker fixture for the check",
    "chore: seed",
    "ci: restore the exec bits copier dropped",
    "build: pin node 22",
    "perf: cache the fold",
    "style: reflow",
    "revert: the parser change",
    "fixup! feat: add the thing",
    "squash! feat: add the thing",
    'Revert "feat: add the thing"',
  ];
  for (const header of accepted) {
    it(`accepts ${JSON.stringify(header)}`, () => {
      assert.equal(headerViolation(header), null);
    });
  }

  const flagged = [
    ["Merge branch 'main' into claude/42-fix-auth", "a merge on a working branch"],
    ["Merge pull request #189 from pandoscope/claude/188-core-split", "a merge on a working branch"],
    ["added the thing", "no type"],
    ["feat add the thing", "no colon"],
    ["feat:no space", "no space after the colon"],
    ["Feat: capitalised type", "a type outside the enum"],
    ["wip: later", "a type outside the enum"],
    ["update", "a bare word"],
  ];
  for (const [header, why] of flagged) {
    it(`flags ${JSON.stringify(header)} (${why})`, () => {
      assert.ok(headerViolation(header));
    });
  }
});

describe("tracker-bodies: the forms a tracker body may take", () => {
  const clean = [
    "CLOSES #142\n\nOne paragraph per line, however long it runs, is what the renderer wraps.",
    "ADVANCES #130\n\n- a list item\n- another list item\n- a third, hard-wrapped by\n  the author",
    "FIXES #7\n\n```\nwrapped\ncode\nlines\n```",
    "CLOSES #1\n\n<details>\n<summary>Long output</summary>\n\ntext\n\n</details>",
    "CLOSES #1\n\nUse `decisions/«id».json` as the path.",
    "CLOSES #1\n\n| a | b |\n| - | - |\n| 1 | 2 |",
    "CLOSES #1\n\n> a quote\n> over two lines",
    "CLOSES #1\n\n# Heading\n## Another heading",
    "The fix closes the gap between the two readers.",
    "CLOSES pandoscope/skills#7\n\nA cross-repo close.",
    "Fixed the wording in the README.",
    "1. first step\n2. second step",
    "<!-- replay-report -->\n<img src=\"x.png\">",
  ];
  for (const body of clean) {
    it(`accepts ${JSON.stringify(body.slice(0, 40))}`, () => {
      assert.deepEqual(bodyViolations(body, KEYWORDS), []);
    });
  }

  it("flags a native closing keyword in another casing", () => {
    const found = bodyViolations("Closes #142", KEYWORDS);
    assert.deepEqual(found.map((v) => v.kind), ["native-keyword"]);
    assert.match(found[0].evidence, /Closes #142/);
  });

  it("flags every native spelling, not just the first", () => {
    const found = bodyViolations("fixes #1 and Resolves #2", KEYWORDS);
    assert.deepEqual(found.map((v) => v.evidence), ["fixes #1", "Resolves #2"]);
  });

  it("flags an angle-bracket placeholder", () => {
    const found = bodyViolations("CLOSES #1\n\nWrite it to decisions/<id>.json", KEYWORDS);
    assert.deepEqual(found.map((v) => v.kind), ["angle-placeholder"]);
    assert.equal(found[0].evidence, "<id>");
  });

  it("flags a hard-wrapped paragraph and names its first line", () => {
    const found = bodyViolations(
      "CLOSES #1\n\nThis paragraph was wrapped at a fixed\ncolumn by its author, so the\nrenderer breaks it at random.",
      KEYWORDS,
    );
    assert.deepEqual(found.map((v) => v.kind), ["hard-wrap"]);
    assert.match(found[0].evidence, /^This paragraph was wrapped/);
  });

  it("does not read a wrapped paragraph inside a fence", () => {
    assert.deepEqual(bodyViolations("```text\nline one\nline two\n```", KEYWORDS), []);
  });

  it("flags a PR body that omits one of its branch's tickets", () => {
    const found = bodyViolations("CLOSES #130\n\nHalf the arc.", KEYWORDS, ["130", "221"]);
    assert.deepEqual(found.map((v) => v.kind), ["missing-ticket"]);
    assert.equal(found[0].evidence, "#221");
  });

  it("accepts a PR body that names every branch ticket, any canonical keyword", () => {
    assert.deepEqual(
      bodyViolations("CLOSES #130\nADVANCES pandoscope/agentic-engineering-template#221", KEYWORDS, ["130", "221"]),
      [],
    );
  });
});
