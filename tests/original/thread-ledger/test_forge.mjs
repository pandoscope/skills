// Reading forge traffic and outgoing content out of a transcript.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ATTRIBUTION_FOOTER,
  grillingInvokedAt,
  knownPrs,
  lastAssistantText,
  refViolations,
  reviewSignals,
  stripCode,
  ticketWrites,
} from "../../../original/thread-ledger/core.mjs";
import {
  blocklistTerms,
  scanText,
  shellRef,
} from "../../../original/thread-ledger/scan.mjs";

describe("ResponseHygiene", () => {
  const MAP = { skills: "pandoscope/skills", AET: "pandoscope/agentic-engineering-template" };

  it("a linked shortcode ref with the right URL is clean", () => {
    const prose = "Merged [skills#97](https://github.com/pandoscope/skills/issues/97) today.";
    assert.deepEqual(refViolations(prose, MAP), []);
  });

  it("an unlinked shortcode ref names its canonical form", () => {
    const [v] = refViolations("see skills#97 for details", MAP);
    assert.equal(v.token, "skills#97");
    assert.equal(v.canonical, "[skills#97](https://github.com/pandoscope/skills/issues/97)");
  });

  it("a full owner/repo ref in prose asks for the shortcode", () => {
    const [v] = refViolations("pandoscope/skills#97 landed", MAP);
    assert.equal(v.canonical, "[skills#97](https://github.com/pandoscope/skills/issues/97)");
  });

  it("a number the ledger knows as a PR corrects the sigil to !", () => {
    const prs = new Set(["pandoscope/skills#97"]);
    const [v] = refViolations(
      "see [skills#97](https://github.com/pandoscope/skills/issues/97)",
      MAP,
      prs,
    );
    assert.equal(v.canonical, "[skills!97](https://github.com/pandoscope/skills/pull/97)");
  });

  it("a PR sigil links to /pull/ or is named", () => {
    const clean = "see [skills!98](https://github.com/pandoscope/skills/pull/98)";
    assert.deepEqual(refViolations(clean, MAP), []);
    const [v] = refViolations("see [skills!98](https://github.com/pandoscope/skills/issues/98)", MAP);
    assert.equal(v.canonical, "[skills!98](https://github.com/pandoscope/skills/pull/98)");
  });

  it("an unknown shortcode is a violation with no canonical form", () => {
    const [v] = refViolations("see xyz#4", { ...MAP }, new Set());
    assert.equal(v, undefined);
    const [linked] = refViolations("see [xyz#4](https://github.com/x/y/issues/4)", MAP);
    assert.equal(linked.canonical, null);
  });

  it("a bare repo-less number is a violation", () => {
    const [v] = refViolations("fixed in #137", MAP);
    assert.equal(v.token, "#137");
    assert.equal(v.canonical, null);
  });

  it("code spans are quoted material, not prose", () => {
    const text = "run `git log pandoscope/skills#97` and\n```\nskills#97 in a fence\n```\ndone";
    assert.deepEqual(refViolations(stripCode(text), MAP), []);
  });

  it("the last assistant text supersedes earlier messages", () => {
    const lines = [
      { type: "assistant", message: { content: [{ type: "text", text: "bad skills#97" }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "x" }] } },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "good [skills#97](https://github.com/pandoscope/skills/issues/97)" },
          ],
        },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n");
    assert.match(lastAssistantText(lines), /^good/);
  });

  it("knownPrs reads pr fields off events", () => {
    const events = [{ ev: "opened", thread: "t", pr: "pandoscope/skills#98" }, { ev: "progress", thread: "t" }];
    assert.deepEqual([...knownPrs(events)], ["pandoscope/skills#98"]);
  });
});

describe("ForgeIndependence", () => {
  const MAP = { skills: "pandoscope/skills" };

  it("a structured config carries the forge, so nothing here names one", () => {
    const cfg = {
      forge: "https://git.example.org",
      patterns: {
        ticket: "{base}/{repo}/-/issues/{n}",
        pr: "{base}/{repo}/-/merge_requests/{n}",
      },
      repos: MAP,
    };
    const [v] = refViolations("see skills#97", cfg);
    assert.equal(v.canonical, "[skills#97](https://git.example.org/pandoscope/skills/-/issues/97)");
    const clean = "see [skills!98](https://git.example.org/pandoscope/skills/-/merge_requests/98)";
    assert.deepEqual(refViolations(clean, cfg), []);
    const [wrong] = refViolations(
      "see [skills#97](https://github.com/pandoscope/skills/issues/97)",
      cfg,
    );
    assert.equal(wrong.canonical, "[skills#97](https://git.example.org/pandoscope/skills/-/issues/97)");
  });

  it("a flat map keeps the GitHub defaults", () => {
    assert.deepEqual(
      refViolations("see [skills#97](https://github.com/pandoscope/skills/issues/97)", MAP),
      [],
    );
  });
});

// ------------------------------------------------- outgoing-content scan

// Check 7's shared scanner (skills#46): built-in terms are the store
// URL values, user terms come |-separated from PUSH_BLOCKLIST, and
// nothing here ever returns a value — labels only.
describe("OutgoingScan", () => {
  it("builds terms from the store variables and PUSH_BLOCKLIST", () => {
    const env = {
      SESSION_MEMORY_URL: "https://x@example.test/sm.git",
      PUSH_BLOCKLIST: "hunter2|the-codename",
    };
    assert.deepEqual(
      blocklistTerms(env).map((term) => term.label),
      ["SESSION_MEMORY_URL", "PUSH_BLOCKLIST term 1", "PUSH_BLOCKLIST term 2"],
    );
  });

  it("an unset blocklist means built-in scan only, and empty terms drop", () => {
    assert.deepEqual(blocklistTerms({}), []);
    assert.deepEqual(
      blocklistTerms({ PUSH_BLOCKLIST: "|a||" }).map((term) => term.label),
      ["PUSH_BLOCKLIST term 2"],
    );
  });

  it("reports labels, never values", () => {
    const terms = blocklistTerms({ PUSH_BLOCKLIST: "hunter2" });
    const hits = scanText("the diff says hunter2 somewhere", terms);
    assert.deepEqual(hits, ["PUSH_BLOCKLIST term 1"]);
    assert.ok(!JSON.stringify(hits).includes("hunter2"));
    assert.deepEqual(scanText("a clean diff", terms), []);
  });

  it("shell references expand without printing", () => {
    assert.equal(shellRef("SESSION_MEMORY_URL"), '"$SESSION_MEMORY_URL"');
    assert.equal(
      shellRef("PUSH_BLOCKLIST term 2"),
      "\"$(printf %s \"$PUSH_BLOCKLIST\" | cut -d'|' -f2)\"",
    );
  });
});

describe("ReviewSignals", () => {
  const fetchPayload = (payload, at = "2026-08-03T15:12:00.000Z") =>
    [
      {
        type: "assistant",
        timestamp: at,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "mcp__github__pull_request_read",
              input: { method: "get_review_comments" },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: at,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [{ type: "text", text: JSON.stringify(payload) }],
            },
          ],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n");

  const fetchLines = (body, at = "2026-08-03T15:12:00.000Z") =>
    fetchPayload({ comments: [{ body }] }, at);

  const authored = (body, login) => fetchPayload({ comments: [{ body, user: { login } }] });

  it("a fetched body without the footer is a human comment", () => {
    const signals = reviewSignals(fetchLines("Rename the flag — double negative."));
    assert.deepEqual(signals, { fetched: true, human: true, anomalies: [] });
  });

  it("a body carrying the footer is Claude's own post coming back", () => {
    const signals = reviewSignals(fetchLines(`Applied.\n\n---\n${ATTRIBUTION_FOOTER}`));
    assert.deepEqual(signals, { fetched: true, human: false, anomalies: [] });
  });

  it("no comment fetch means no signal at all", () => {
    const plain = JSON.stringify({
      type: "user",
      timestamp: "2026-08-03T15:10:00.000Z",
      message: { role: "user", content: "Finish the slice." },
    });
    assert.deepEqual(reviewSignals(plain), { fetched: false, human: false, anomalies: [] });
  });

  it("activity before the boundary is another turn's business", () => {
    const early = fetchLines("Rename it.", "2026-08-03T14:00:00.000Z");
    assert.deepEqual(reviewSignals(early, "2026-08-03T15:10:00.000Z"), {
      fetched: false,
      human: false,
      anomalies: [],
    });
  });

  it("webhook activity blocks carry bodies too", () => {
    const hook = JSON.stringify({
      type: "user",
      timestamp: "2026-08-03T15:12:00.000Z",
      message: {
        role: "user",
        content:
          '<github-webhook-activity>{"comment":{"body":"Why does this loop twice?"}}</github-webhook-activity>',
      },
    });
    assert.deepEqual(reviewSignals(hook), { fetched: true, human: true, anomalies: [] });
  });

  it("a result for a tool this check never asked about is ignored", () => {
    const other = fetchLines("Rename it.").replace("pull_request_read", "list_pull_requests");
    assert.deepEqual(reviewSignals(other), { fetched: false, human: false, anomalies: [] });
  });

  it("with accounts configured, authorship beats the footer", () => {
    const bare = authored("Rename the flag.", "the-principal");
    const read = reviewSignals(bare, null, ["pando-ramet"]);
    assert.equal(read.human, true);
    assert.deepEqual(read.anomalies, []);
    const own = authored(`Applied.\n\n---\n${ATTRIBUTION_FOOTER}`, "pando-ramet");
    assert.deepEqual(reviewSignals(own, null, ["pando-ramet"]), {
      fetched: true,
      human: false,
      anomalies: [],
    });
  });

  it("a footer on a foreign account is an anomaly, loudly", () => {
    const forged = authored(`LGTM.\n\n---\n${ATTRIBUTION_FOOTER}`, "the-principal");
    const read = reviewSignals(forged, null, ["pando-ramet"]);
    assert.deepEqual(read.anomalies, [{ kind: "foreign-footer", author: "the-principal" }]);
  });

  it("an agent account posting bare is footer drift", () => {
    const bare = authored("Applied, no footer.", "pando-ramet");
    const read = reviewSignals(bare, null, ["pando-ramet"]);
    assert.deepEqual(read.anomalies, [{ kind: "footer-drift", author: "pando-ramet" }]);
    assert.equal(read.human, false);
  });

  it("without accounts, the same texts raise no anomaly", () => {
    const forged = authored(`LGTM.\n\n---\n${ATTRIBUTION_FOOTER}`, "the-principal");
    assert.deepEqual(reviewSignals(forged), { fetched: true, human: false, anomalies: [] });
  });
});

describe("TicketWrites", () => {
  const write = (name, input, at = "2026-08-03T15:14:00.000Z") =>
    JSON.stringify({
      type: "assistant",
      timestamp: at,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_w", name, input }],
      },
    });

  it("an issue-writing call names its ticket", () => {
    const text = write("mcp__github__add_issue_comment", {
      owner: "o",
      repo: "r",
      issue_number: 61,
      body: "done",
    });
    assert.deepEqual([...ticketWrites(text)], ["o/r#61"]);
  });

  it("reading a ticket is not updating it", () => {
    const text = write("mcp__github__issue_read", { owner: "o", repo: "r", issue_number: 61 });
    assert.deepEqual([...ticketWrites(text)], []);
  });

  it("a write before the boundary is another turn's", () => {
    const text = write(
      "mcp__github__issue_write",
      { owner: "o", repo: "r", issue_number: 61 },
      "2026-08-03T14:00:00.000Z",
    );
    assert.deepEqual([...ticketWrites(text, "2026-08-03T15:10:00.000Z")], []);
  });

  it("owner and repo casing folds to one ticket", () => {
    const text = write("mcp__github__issue_write", { owner: "O", repo: "R", issue_number: 61 });
    assert.deepEqual([...ticketWrites(text)], ["o/r#61"]);
  });

  const result = (toolUseId, content, at = "2026-08-03T15:14:01.000Z") =>
    JSON.stringify({
      type: "user",
      timestamp: at,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
      },
    });

  it("a ticket created this turn counts as written (skills#181)", () => {
    // Creation is a write. The number exists only in the tool result,
    // so the create call pairs with its result by tool_use id.
    const text = [
      write("mcp__github__issue_write", { method: "create", owner: "o", repo: "r", title: "t" }),
      result("toolu_w", '{"id":"1","url":"https://github.com/o/r/issues/180"}'),
    ].join("\n");
    assert.deepEqual([...ticketWrites(text)], ["o/r#180"]);
  });

  it("a PR body with a canonical keyword writes the ticket it names (skills#181)", () => {
    // The forge posts the reference on the ticket's timeline, so the
    // ticket heard about the turn without a comment of its own.
    const text = write("mcp__github__create_pull_request", {
      owner: "o",
      repo: "r",
      title: "t",
      head: "h",
      base: "main",
      body: "CLOSES #228.\n\nADVANCES x/y#5 too.",
    });
    assert.deepEqual([...ticketWrites(text)].sort(), ["o/r#228", "x/y#5"]);
  });
});

describe("GrillingInvoked", () => {
  const user = (text, at) =>
    JSON.stringify({ type: "user", timestamp: at, message: { role: "user", content: text } });
  const skill = (name, at) =>
    JSON.stringify({
      type: "assistant",
      timestamp: at,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: name } }],
      },
    });

  it("the typed slash command counts", () => {
    const text = user(
      "<command-name>/grill-me</command-name>\n<command-args>the plan</command-args>",
      "2026-08-03T15:10:00.000Z",
    );
    assert.equal(grillingInvokedAt(text), "2026-08-03T15:10:00.000Z");
  });

  it("the Skill call counts, and the LAST invocation wins", () => {
    const text = [
      skill("grilling", "2026-08-03T15:00:00.000Z"),
      skill("grilling", "2026-08-03T16:00:00.000Z"),
    ].join("\n");
    assert.equal(grillingInvokedAt(text), "2026-08-03T16:00:00.000Z");
  });

  it("prose about grilling is not an invocation", () => {
    const text = [user("let us grill the plan later", "2026-08-03T15:10:00.000Z"), skill("tdd", "2026-08-03T15:11:00.000Z")].join("\n");
    assert.equal(grillingInvokedAt(text), null);
  });
});
