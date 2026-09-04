// The published page — rows, titles, tiers, pills and pickers.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  fold,
  stamp,
} from "../../../original/thread-ledger/core.mjs";
import {
  CSS,
  linkify,
  renderBody,
  renderMarkdown,
} from "../../../original/thread-ledger/views.mjs";
import {
  renderPage,
  resolveSession,
} from "../../../original/thread-ledger/ledger.mjs";
import {
  opened,
  tempStore,
} from "./helpers.mjs";

// ------------------------------------------------------------ rendering

describe("Rendering", () => {
  it("the page embeds every event", () => {
    // Rendering may summarize; the data may not. Graphs added later must
    // not need a second source.
    const events = [opened("a"), { ev: "progress", thread: "a", pct: 40 }];
    const page = renderPage(events, "t", null, {}, null);
    assert.match(page, /id="ledger-data"/);
    assert.match(page, /"pct":40/);
  });

  it("the page carries no rendered rows", () => {
    // State is folded in the browser from the events, so the file
    // carries each fact once.
    const events = [opened("a", { title: "unique-title-here" })];
    const page = renderPage(events, "t", null, {}, null);
    const body = page.slice(page.indexOf('<div id="view">'), page.indexOf("<script"));
    assert.doesNotMatch(body, /unique-title-here/);
  });

  it("ticket references linkify", () => {
    assert.match(linkify("see o/r#1"), /https:\/\/github\.com\/o\/r\/issues\/1/);
  });

  it("titles are escaped", () => {
    const events = [opened("a", { title: "<script>alert(1)</script>" })];
    assert.doesNotMatch(renderBody(fold(events), "t"), /<script>alert\(1\)<\/script>/);
  });

  it("the embedded payload cannot close its own script block", () => {
    const events = [opened("a", { title: "</script><b>x" })];
    const page = renderPage(events, "t", null, {}, null);
    const block = page.slice(page.indexOf('id="ledger-data"'));
    assert.doesNotMatch(block.slice(0, block.indexOf("</script>")), /<\/script>/);
  });
});

describe("TitlesWithoutScript", () => {
  it("the title text is in the row", () => {
    const events = [opened("a", { title: "ship the exporter" })];
    assert.match(renderBody(fold(events), "t"), /">ship the exporter<\/span>/);
  });

  it("the script only refits the text it finds", () => {
    const events = [opened("a", { title: "ship the exporter" })];
    assert.match(renderBody(fold(events), "t"), /data-full="ship the exporter"/);
  });
});

// ---------------------------------------------------------- tier colours

describe("TierColours", () => {
  it("a row carries its tier as a class, and quiet threads carry none", () => {
    const events = [
      opened("loud", { urgency: "high" }),
      opened("quiet"),
      opened("stuck", { importance: "high" }),
      { ev: "blocked", thread: "stuck", on: "internal", what: "w" },
    ];
    const body = renderBody(fold(events), "t");
    assert.match(body, /class="thread[^"]*t-urgent/);
    assert.match(body, /class="thread[^"]*t-blocking-important/);
    assert.doesNotMatch(body, /class="thread[^"]*t-(?:urgent|important)[^"]*"[^>]*>[\s\S]{0,40}quiet/);
  });

  // Violet is the page's own signal for the one state where the reader
  // is the bottleneck; a tier colour on top would bury it.
  it("blocked-on-principal keeps violet and takes no tier class", () => {
    const events = [
      opened("you", { urgency: "high" }),
      { ev: "blocked", thread: "you", on: "principal", what: "review" },
    ];
    const body = renderBody(fold(events), "t");
    assert.match(body, /s-blocked-principal/);
    assert.doesNotMatch(body, /t-blocking-urgent/);
  });

  it("the palette is in the stylesheet, both tiers of red", () => {
    assert.match(CSS, /t-blocking-urgent/);
    assert.match(CSS, /t-blocking-important/);
    assert.match(CSS, /t-urgent/);
    assert.match(CSS, /t-important/);
  });
});

// --------------------------------------------------------- session filter

describe("SessionFilter", () => {
  const withAnchors = [
    { ...opened("a", { title: "one" }), anchor: { session: "s1", msg: 1, url: "https://claude.test/s1" } },
    { ...opened("b", { title: "two" }), anchor: { session: "s2", msg: 4, url: "https://claude.test/s2" } },
    { ev: "progress", thread: "a", pct: 5, anchor: { session: "s2", msg: 5, url: "https://claude.test/s2" } },
  ];

  // The session chips filter on data the events already carry: every
  // anchor names its session, so the row only has to say which sessions
  // its events came from and the chips only have to hide the rest.
  it("rows carry the sessions whose events built them", () => {
    const body = renderBody(fold(withAnchors), "t");
    assert.match(body, /data-sessions="[^"]*s1[^"]*s2|data-sessions="[^"]*s2[^"]*s1/);
    assert.match(body, /data-sessions="s2"/);
  });
});

// -------------------------------------------------------------- session

describe("SessionLink", () => {
  const row = (page) => page.match(/<li class="thread[\s\S]*?<\/li>/)[0];

  it("no url renders no link", () => {
    const events = [opened("a", { title: "x" })];
    assert.doesNotMatch(row(renderBody(fold(events), "t")), /tlink/);
  });

  it("the title links to the session when known", () => {
    const events = [opened("a", { title: "x" })];
    const body = renderBody(fold(events), "t", null, {}, "https://example.test/s/1");
    assert.match(body, /href="https:\/\/example\.test\/s\/1"/);
  });

  it("a url is escaped like any other text", () => {
    const events = [opened("a", { title: "x" })];
    const body = renderBody(fold(events), "t", null, {}, '"><script>bad()</script>');
    assert.doesNotMatch(body, /<script>bad\(\)<\/script>/);
  });

  it("the url is remembered across calls", () => {
    const root = tempStore();
    const first = resolveSession(root, "https://x.test/s/abc", null, null);
    const second = resolveSession(root, null, null, null);
    // Identity and URL persist; the third element deliberately does
    // not — remembered is not stated, and only a stated identity may
    // bypass the one-log guard (skills#62).
    assert.deepEqual(first.slice(0, 2), second.slice(0, 2));
    assert.equal(first[2], true);
    assert.equal(second[2], false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("PerThreadSessionLink", () => {
  it("the recorder stamps the url onto the event", () => {
    const stamped = stamp(opened("a"), "s", 1, "https://example.test/s/1");
    assert.equal(stamped.anchor.url, "https://example.test/s/1");
  });

  it("an unknown url leaves the anchor clean", () => {
    assert.ok(!("url" in stamp(opened("a"), "s", 1).anchor));
  });

  it("the fold carries the latest event's url", () => {
    const events = [
      { ...opened("a"), anchor: { session: "one", url: "https://one.test" } },
      { ev: "progress", thread: "a", pct: 50, anchor: { session: "two", url: "https://two.test" } },
    ];
    assert.equal(fold(events)[0].url, "https://two.test");
  });

  it("the markdown title is the link", () => {
    const events = [
      { ...opened("a", { title: "ship it" }), anchor: { session: "one", url: "https://one.test" } },
    ];
    const page = renderMarkdown(fold(events), "t");
    assert.match(page, /\[ship it\]\(https:\/\/one\.test\)/);
    assert.doesNotMatch(page, /Open the session/);
  });
});

// -------------------------------------------------------- state pills

describe("StateEncoding", () => {
  const build = (extra) => renderBody(fold([opened("a"), ...extra]), "t");

  it("a quiet thread carries no state pill", () => {
    assert.doesNotMatch(build([]), /class="pill"/);
  });

  it("the card carries the state as a class", () => {
    assert.match(
      build([{ ev: "blocked", thread: "a", on: "internal", what: "x" }]),
      /s-blocked-internal/,
    );
  });

  it("blocking kinds are distinguishable", () => {
    const kinds = ["internal", "external", "principal"].map((on) =>
      build([{ ev: "blocked", thread: "a", on, what: "x" }]).match(/s-blocked-\w+/)[0],
    );
    assert.equal(new Set(kinds).size, 3);
  });

  it("the reason rides in a native tooltip", () => {
    const body = build([{ ev: "blocked", thread: "a", on: "internal", what: "the reason" }]);
    const pill = body.match(/<span class="pill"[^>]*>/)[0];
    assert.match(pill, /title="the reason"/);
  });

  it("a parked trigger is reachable from its pill", () => {
    assert.match(build([{ ev: "parked", thread: "a", trigger: "when X" }]), /trigger: when X/);
  });

  it("an unblocked thread carries no state class", () => {
    const body = build([
      { ev: "blocked", thread: "a", on: "internal", what: "x" },
      { ev: "unblocked", thread: "a" },
    ]);
    assert.doesNotMatch(body, /s-blocked/);
  });
});

// ------------------------------------------------------- ticket picker

describe("TicketPicker", () => {
  const codes = { "o/one": "ONE", "o/two": "TWO" };

  it("a ticketless thread offers every repo", () => {
    const events = [opened("a", { ticket: null, conversation_only: true })];
    const body = renderBody(fold(events), "t", null, codes);
    assert.match(body, /NO TICKET/);
    assert.match(body, /value="o\/one"/);
    assert.match(body, /value="o\/two"/);
  });

  it("a ticketed thread offers no picker", () => {
    const events = [opened("a")];
    assert.doesNotMatch(renderBody(fold(events), "t", null, codes), /class="pick"/);
  });

  it("the picker carries what the prompt needs", () => {
    const events = [opened("a", { ticket: null, conversation_only: true, title: "the title" })];
    const body = renderBody(fold(events), "t", null, codes);
    assert.match(body, /data-thread="a"/);
    assert.match(body, /data-title="the title"/);
  });
});
