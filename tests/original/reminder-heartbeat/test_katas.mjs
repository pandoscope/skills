// The kata runner — the dojo's first incarnation.
//
// A kata freezes one turn's state exactly as the Stop hook receives it:
// a transcript slice in the shape `transcript_path` delivers, repo
// clones in the state the turn left them, a frozen ledger log, and the
// local files the model was supposed to write. The runner stages that
// state in a throwaway directory, pipes the hook's stdin JSON in, and
// asserts on what a session would actually see — exit code and stderr.
//
// Every kata is a real incident. The corpus is this org's own failure
// catalogue, because a reminder that fires on invented cases proves
// nothing about the cases that happened.
//
// Reason WORDING is asserted, not merely the check that fired. A block
// reason phrased as instructions makes a model start new work in a loop
// — a documented failure class for Stop hooks — so the exact text is
// part of the contract, not presentation.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { validateDiligence } from "../../../original/thread-ledger/core.mjs";
import { digestOf, stretchOf } from "../../../original/thread-ledger/diligence.mjs";
import { FIXTURE_PATH } from "../../../original/thread-ledger/heartbeat.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, "../../../original/thread-ledger");
const HEARTBEAT = path.join(SKILL, "heartbeat.mjs");
const LEDGER = path.join(SKILL, "ledger.mjs");
const KATAS = path.join(HERE, "katas");

/** Kata directories, in order. `_lib.sh` is shared shell, not a kata. */
function kataNames() {
  return fs
    .readdirSync(KATAS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// ------------------------------------------------------------- staging

/**
 * Copy a kata into a throwaway directory and build its repo state.
 *
 * Staged rather than run in place because the heartbeat WRITES — it
 * seals the ledger and appends to the compliance log — and a kata that
 * mutates its own checked-in fixture passes once and then tests a
 * different state on every later run.
 */
function stage(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kata-${name}-`));
  fs.cpSync(path.join(KATAS, name), dir, { recursive: true });
  fs.cpSync(path.join(KATAS, "_lib.sh"), path.join(dir, "_lib.sh"));
  fs.mkdirSync(path.join(dir, "repos"), { recursive: true });

  const setup = path.join(dir, "setup.sh");
  if (fs.existsSync(setup)) {
    const built = spawnSync("bash", [setup], { cwd: dir, encoding: "utf8" });
    assert.equal(
      built.status,
      0,
      `${name}: setup.sh failed — the kata never reached its own state:\n${built.stderr}`,
    );
  }

  // The turn summary is evidence that the model wrote it DURING this
  // turn, so its mtime has to sit after the turn began. Copying resets
  // mtimes to now, which would be true by accident; stamping it makes
  // the kata state deliberate and lets a kata express staleness.
  const summary = path.join(dir, "home", ".claude", "turn-summary.txt");
  const stamp = readSpec(dir).summary_written_at;
  if (stamp && fs.existsSync(summary)) {
    fs.utimesSync(summary, new Date(stamp), new Date(stamp));
  }
  return dir;
}

function readSpec(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
}

/**
 * The store root a staged kata's heartbeat writes to.
 *
 * `store_in` lets a kata put the store somewhere else — under the repo
 * root, say, which is where the hook can end up reporting on a clone
 * only it writes to.
 */
function storeOf(dir, spec) {
  return path.join(dir, spec?.store_in ?? "store");
}

/**
 * The decision store URL a kata names, or null when it names none.
 *
 * The URL, not a path: `DECISION_MEMORY_URL` is what an environment
 * actually sets, and the hook has to find the checkout itself. A kata
 * naming a store it never cloned is therefore expressible, which is the
 * ordinary case for a store whose convention is to clone fresh per
 * recording session.
 */
function decisionUrl(dir, spec) {
  return spec?.decision_url ? path.join(dir, ".origins", `${spec.decision_url}.git`) : null;
}

/** Where that store's checkout sits, for reason text that names it. */
function decisionCheckout(dir, spec) {
  return spec?.decision_url ? path.join(dir, "repos", spec.decision_url) : null;
}

/**
 * The evidence store URL a kata names, or null when it names none.
 *
 * Same contract as `decision_url`: review persistence counts EITHER
 * store, so a kata has to be able to stand up each one on its own.
 */
function evidenceUrl(dir, spec) {
  return spec?.evidence_url ? path.join(dir, ".origins", `${spec.evidence_url}.git`) : null;
}

/**
 * Expand the placeholders a checked-in expectation cannot hold.
 *
 * Reason text names absolute paths, which differ per machine, so the
 * fixture writes `{{ledger}}` and the runner resolves it. Asserting the
 * expanded text keeps the wording exact without pinning it to a checkout
 * location.
 */
function expand(text, dir, spec) {
  return text
    .replaceAll("{{ledger}}", LEDGER)
    .replaceAll("{{home}}", path.join(dir, "home"))
    .replaceAll("{{store}}", storeOf(dir, spec))
    .replaceAll("{{repos}}", path.join(dir, "repos"))
    .replaceAll("{{workspace}}", path.join(dir, "workspace"))
    .replaceAll("{{decisions}}", decisionCheckout(dir, spec) ?? "")
    .replaceAll("{{render}}", spec?.render_path ? path.join(dir, spec.render_path) : "")
    .replaceAll("{{transcript}}", path.join(dir, "transcript.jsonl"));
}

// -------------------------------------------------------------- running

/**
 * Run the hook against a staged kata exactly as the platform would.
 *
 * `script` names the executable under test so the red-gates below can
 * substitute a deliberately broken heartbeat and prove the runner
 * notices. Everything else is the shipped path.
 */
function fire(dir, spec, script = HEARTBEAT) {
  const transcript = path.join(dir, "transcript.jsonl");
  const stdin = JSON.stringify({
    hook_event_name: "Stop",
    session_id: spec.session_id ?? "kata",
    transcript_path: transcript,
    // The platform's own Stop hook silently no-ops in multi-repo
    // sessions because it looks at cwd, which is above every clone. The
    // katas run from a directory that is not a repo, so a heartbeat that
    // repeats that mistake cannot pass.
    cwd: dir,
    stop_hook_active: spec.stop_hook_active ?? false,
  });
  const result = spawnSync(process.execPath, [script], {
    input: stdin,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: path.join(dir, "home"),
      SESSION_MEMORY_ROOT: storeOf(dir, spec),
      // Always kata-local, never the host's real /workspace: store
      // discovery scans this directory (#72), and a hermetic kata
      // cannot depend on what the machine running it has lying around.
      WORKSPACE_ROOT: path.join(dir, "workspace"),
      // `repo_root` lets a kata point the hook at a path of its own —
      // a wrong one, say, which is what a config edit produces and what
      // an unset variable cannot express.
      HEARTBEAT_REPO_ROOT: path.join(dir, spec.repo_root ?? "repos"),
      // Only set when the kata names it, so every other kata keeps
      // exercising the path a session without it takes.
      ...(spec.session_url ? { LEDGER_SESSION_URL: spec.session_url } : {}),
      ...(decisionUrl(dir, spec) ? { DECISION_MEMORY_URL: decisionUrl(dir, spec) } : {}),
      ...(evidenceUrl(dir, spec) ? { EVIDENCE_MEMORY_URL: evidenceUrl(dir, spec) } : {}),
      // The baseline arm: verdicts logged, turn never blocked. Only set
      // when the kata names it, so every other kata keeps proving the
      // blocking path.
      ...(spec.observe ? { HEARTBEAT_OBSERVE: "1" } : {}),
      ...(spec.render_path ? { LEDGER_RENDER_PATH: path.join(dir, spec.render_path) } : {}),
      // Only set when the kata names it, so every other kata keeps
      // exercising the built-in-only scan an ordinary session runs.
      ...(spec.push_blocklist ? { PUSH_BLOCKLIST: spec.push_blocklist } : {}),
      // Only set when the kata names it, so every other kata keeps
      // exercising the footer-only reading an account-less session has.
      ...(spec.agent_accounts ? { AGENT_ACCOUNTS: spec.agent_accounts } : {}),
    },
  });
  assert.equal(result.error, undefined, `the hook did not run: ${result.error}`);
  return result;
}

/** The log files in the kata's store, by name. */
function logFilesIn(dir, spec) {
  const logs = path.join(storeOf(dir, spec), "ledger");
  return fs.readdirSync(logs).filter((name) => name.endsWith(".jsonl")).sort();
}

/**
 * Events in one of the store's logs.
 *
 * Unparsable lines are skipped rather than thrown on: a kata may put a
 * torn line in the store deliberately, and the runner observing that
 * store must not fall over on the very state it is staging.
 */
function ledgerEventsIn(dir, spec, name) {
  return fs
    .readFileSync(path.join(storeOf(dir, spec), "ledger", `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/**
 * The session a kata's seal must land in.
 *
 * Named outright by a kata whose store holds several conversations —
 * which is where getting it wrong stops being theoretical. Otherwise
 * the single log in the store is the answer, and the runner asserts
 * that it really is single rather than assuming so.
 */
function logNameFor(dir, spec) {
  if (spec?.session) return spec.session;
  const logs = path.join(storeOf(dir, spec), "ledger");
  const found = fs.readdirSync(logs).filter((name) => name.endsWith(".jsonl"));
  assert.equal(found.length, 1, "a kata records exactly one session");
  return path.basename(found[0], ".jsonl");
}

/** Freeze what the store looked like before the hook ran. */
function baseline(dir, spec) {
  spec.logs_before = logFilesIn(dir, spec);
  spec.sealed_before = ledgerEventsIn(dir, spec, logNameFor(dir, spec)).filter(
    (event) => event.ev === "sealed",
  ).length;
}

/** Compliance records the hook wrote, oldest first. */
function complianceLog(dir) {
  const file = path.join(dir, "home", ".claude", "reminder-compliance.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

// ------------------------------------------------------------ assertion

/**
 * Assert one kata's whole contract: exit code, wording, seal, log.
 *
 * Returns nothing; throws with the kata's name on any mismatch.
 */
function assertKata(name, dir, spec, result) {
  assert.equal(
    result.status,
    spec.exit,
    `${name}: expected exit ${spec.exit}, got ${result.status}. stderr:\n${result.stderr}`,
  );
  assert.equal(
    result.stderr,
    spec.reason.length ? `${expand(spec.reason.join("\n"), dir, spec)}\n` : "",
    `${name}: the reason text is part of the contract`,
  );

  // A seal has to land in the log of the conversation it belongs to.
  // Counting seals across the whole store cannot see a seal written to
  // the WRONG log — it would find one either way — so the store's set
  // of logs is pinned first, and the count is taken inside the one log
  // this turn should have touched.
  const log = logNameFor(dir, spec);
  assert.deepEqual(
    logFilesIn(dir, spec),
    spec.logs_before,
    `${name}: the run wrote a log for a conversation that is not this one`,
  );
  const sealed = ledgerEventsIn(dir, spec, log).filter((event) => event.ev === "sealed");
  const added = sealed.length - spec.sealed_before;
  assert.equal(added, spec.sealed ? 1 : 0, `${name}: seals added to ${log}`);

  // A seal names no thread, so its anchor is the ONLY thing that says
  // which conversation and which point in it the mark belongs to. The
  // seal sequence is meant to read as a per-turn table of contents over
  // the transcript, and every part of that rests on this field — an
  // anchorless seal would still count, still satisfy the tail
  // predicate, and resolve to nothing.
  if (spec.sealed) {
    const mark = sealed[sealed.length - 1];
    assert.equal(mark.anchor?.session, log, `${name}: the seal names its session`);
    assert.ok(
      Number.isInteger(mark.anchor?.msg),
      `${name}: the seal carries a transcript position, got ${mark.anchor?.msg}`,
    );
    assert.match(mark.anchor?.url ?? "", /^https?:\/\//, `${name}: the seal links its conversation`);
  }

  // Every check's verdict is logged whatever happens — that log is the
  // input for measuring whether reminders change behaviour at all, and
  // logging only failures would measure only the failures.
  // The hook's record is the LAST one: a kata may stage the records an
  // earlier cycle of the same turn already wrote, which is the only way
  // to express a turn that took more than one round-trip.
  const written = complianceLog(dir);
  const before = spec.records_before ?? 0;
  assert.equal(
    written.length,
    before + 1,
    `${name}: one Stop, one compliance record`,
  );
  const record = written[written.length - 1];
  assert.ok(record, `${name}: nothing reached the compliance log`);

  // Stamped on every record, because a report cannot recover them: the
  // transcript they come from is local, discarded with the container,
  // and rewritten by compaction.
  assert.equal(record.cycle, spec.cycle ?? 1, `${name}: which Stop of this turn`);
  if (spec.model !== undefined) {
    assert.equal(record.model, spec.model, `${name}: the model that took the turn`);
  }
  if (spec.tokens) {
    assert.deepEqual(record.tokens, spec.tokens, `${name}: cumulative usage at this Stop`);
  }
  // A kata may expect no verdicts at all — a heartbeat that crashed
  // before it could evaluate anything still has to leave a record, and
  // an empty verdict list is the honest shape of "nothing was checked".
  assert.deepEqual(
    record.verdicts.map((verdict) => verdict.check),
    spec.verdicts ?? ["turn-summary", "push-blocklist", "clone-config", "commit-signed", "linear-history", "pushed", "ledger-event", "tickets-updated", "decision-record", "rulings-recorded", "review-persistence", "grilling-recorded", "kata-reminder", "blocked-captured", "response-hygiene", "artifact-fresh"],
    `${name}: every check reports, pass or fail`,
  );
  assert.equal(record.fired, spec.check, `${name}: the check the log says fired`);
  if (spec.outcome) {
    assert.equal(record.outcome, spec.outcome, `${name}: the outcome the log records`);
  }
  // The seal's digest and its raw records, asserted against the SAME
  // functions the hook uses — one implementation of what a stretch is,
  // so the runner and the hook cannot disagree about the window.
  if (spec.sealed) {
    const sealedEvents = ledgerEventsIn(dir, spec, log).filter((event) => event.ev === "sealed");
    const mark = sealedEvents[sealedEvents.length - 1];
    validateDiligence(mark.diligence);
    const { window, baseline: sealBaseline } = stretchOf(written, record.session);
    assert.deepEqual(
      mark.diligence,
      digestOf(window, sealBaseline),
      `${name}: the seal's digest is the projection of its stretch, nothing else`,
    );
    if (spec.digest) {
      for (const [key, value] of Object.entries(spec.digest)) {
        assert.deepEqual(mark.diligence[key], value, `${name}: digest ${key}`);
      }
    }
    // Raw flushes, digest summarises: the per-Stop records the digest
    // projects are appended to the store, so the detail outlives the
    // container the compliance log dies with.
    const flushedFile = path.join(storeOf(dir, spec), "diligence", `${log}.jsonl`);
    assert.ok(fs.existsSync(flushedFile), `${name}: the stretch's raw records reach the store`);
    const flushed = fs
      .readFileSync(flushedFile, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    assert.deepEqual(flushed, window, `${name}: the flush is the stretch, complete and raw`);
  }

  if (spec.check2_verdict) {
    assert.equal(
      record.verdicts.find((verdict) => verdict.check === "pushed")?.verdict,
      spec.check2_verdict,
      `${name}: what the log says check 2 established`,
    );
  }
  // Asserted separately from the fired check, because the case worth
  // pinning is one where nothing fires at all: a check that looked at
  // nothing and a check that looked and found nothing both end the turn
  // green, and only this field tells them apart afterwards.
  if (spec.check4_verdict) {
    assert.equal(
      record.verdicts.find((verdict) => verdict.check === "decision-record")?.verdict,
      spec.check4_verdict,
      `${name}: what the log says check 4 established`,
    );
  }
  assert.equal(record.guarded, spec.stop_hook_active ?? false);

  // Seal phase 3: the checks gated the seal, the seal gates the push.
  // Proven on the store's own git state — a clean tree with nothing
  // ahead of upstream is "committed and pushed" with no API in sight.
  if (spec.store_pushed) {
    const store = storeOf(dir, spec);
    const dirty = spawnSync("git", ["-C", store, "status", "--porcelain"], {
      encoding: "utf8",
    }).stdout;
    assert.equal(dirty, "", `${name}: the seal push leaves the store clean`);
    const ahead = spawnSync(
      "git",
      ["-C", store, "rev-list", "--count", "@{upstream}..HEAD"],
      { encoding: "utf8" },
    ).stdout.trim();
    assert.equal(ahead, "0", `${name}: the store holds no unpushed commits after the seal`);
  }
}

// ---------------------------------------------------------------- katas

describe("Katas", () => {
  for (const name of kataNames()) {
    const dir = stage(name);
    const spec = readSpec(dir);
    baseline(dir, spec);

    if (spec.status === "backlog") {
      // A backlog kata pins a check that is NOT built yet: the incident
      // is frozen now, while the evidence is fresh, and the assertion
      // is deliberately the inverse — this heartbeat does not catch it.
      // The day the check lands, this test fails and the kata flips to
      // active. That is the promotion backlog, executable.
      it(`${name} — BACKLOG, ${spec.check} is not built`, () => {
        const result = fire(dir, spec);
        const record = complianceLog(dir)[0];
        assert.notEqual(
          record?.fired,
          spec.check,
          `${name}: ${spec.check} now fires — flip this kata's status to "active"`,
        );
      });
      continue;
    }

    it(name, () => {
      assertKata(name, dir, spec, fire(dir, spec));
    });
  }

  it("names every backlog kata rather than passing quietly", () => {
    // A suite that defers work silently reads as one that covered
    // everything. The deferred set is printed on every run.
    const deferred = kataNames().filter(
      (name) => JSON.parse(
        fs.readFileSync(path.join(KATAS, name, "expected.json"), "utf8"),
      ).status === "backlog",
    );
    for (const name of deferred) {
      console.log(`kata deferred (check not built): ${name}`);
    }
    assert.ok(deferred.length < kataNames().length, "every kata is deferred");
  });
});

// ------------------------------------------------------------ red-gates

// Permanent gates, the pattern from the page smoke check: a runner that
// cannot fail is worth nothing, so each way it could silently pass is
// deliberately reintroduced here and must turn it red. Each gate
// replaces the heartbeat with a broken one and asserts the founding
// kata stops passing.

/** A stand-in heartbeat with the given body, for the gates below. */
function brokenHeartbeat(dir, body) {
  const file = path.join(dir, "broken-heartbeat.mjs");
  fs.writeFileSync(file, body, "utf8");
  return file;
}

/**
 * A heartbeat that runs the real one, then breaks one property.
 *
 * Gates written as hand-rolled stubs are their own trap. A stub that
 * writes no stderr trips the reason assertion long before the seal or
 * the compliance log is ever reached — so the gate turns red for a
 * reason unrelated to its name, and the protection it claims to prove
 * stays untested while looking proven. Measured: two gates here did
 * exactly that. Breaking a single field of a genuine run is the only
 * way a gate names the assertion it actually exercises.
 *
 * `tail` runs after the real hook, with `dir` (the store's ledger
 * directory) and `home` (the hook's local state) in scope.
 */
function realThenBreak(tail) {
  return (
    'import fs from "node:fs";\n' +
    `import { run } from ${JSON.stringify(HEARTBEAT)};\n` +
    'const code = run(JSON.parse(fs.readFileSync(0, "utf8")));\n' +
    'const dir = process.env.SESSION_MEMORY_ROOT + "/ledger";\n' +
    'const home = process.env.HOME + "/.claude";\n' +
    'const logs = fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"));\n' +
    tail +
    "process.exit(code);\n"
  );
}

describe("KataRunnerRedGates", () => {
  const drift = "01-four-turns-of-drift";

  /** Run `kata` against `body` and return the failure, if any. */
  function gate(body, kata = drift) {
    const dir = stage(kata);
    const spec = readSpec(dir);
    baseline(dir, spec);
    const script = brokenHeartbeat(dir, body);
    try {
      assertKata(kata, dir, spec, fire(dir, spec, script));
    } catch (err) {
      return err;
    }
    return null;
  }

  it("catches a heartbeat that never blocks", () => {
    // The whole failure class: absence and success look identical.
    assert.ok(gate("process.exit(0);\n"), "a silent heartbeat passed the kata");
  });

  it("catches a heartbeat that blocks with the wrong wording", () => {
    assert.ok(
      gate('process.stderr.write("Update the ledger.\\n");\nprocess.exit(2);\n'),
      "a reason phrased as an instruction passed the kata",
    );
  });

  it("catches a heartbeat that seals a turn it just blocked", () => {
    // Sealing a failed turn is the check system defeating itself: the
    // mark would say the bookkeeping is complete when it is not.
    assert.ok(
      gate(
        realThenBreak(
          'fs.appendFileSync(dir + "/" + logs[0], JSON.stringify({ ev: "sealed" }) + "\\n");\n',
        ),
      ),
      "a heartbeat that sealed a blocked turn passed the kata",
    );
  });

  it("catches a heartbeat that logs nothing", () => {
    assert.ok(
      gate(realThenBreak('fs.rmSync(home + "/reminder-compliance.jsonl");\n')),
      "a heartbeat with no compliance log passed the kata",
    );
  });

  it("catches a seal whose digest was dropped", () => {
    // A digest-less new seal still counts, still anchors, and quietly
    // reopens the hole skills#69 closes: compliance data dying with the
    // container.
    assert.ok(
      gate(
        realThenBreak(
          "for (const name of logs) {\n" +
            '  const file = dir + "/" + name;\n' +
            '  const kept = fs.readFileSync(file, "utf8").split("\\n").map((line) => {\n' +
            "    if (!line.trim()) return line;\n" +
            "    const event = JSON.parse(line);\n" +
            '    if (event.ev === "sealed") delete event.diligence;\n' +
            "    return JSON.stringify(event);\n" +
            "  });\n" +
            '  fs.writeFileSync(file, kept.join("\\n"));\n' +
            "}\n",
        ),
        "02-question-only-turn",
      ),
      "a digest-less new seal passed the kata",
    );
  });

  it("catches a seal that resolves to no conversation", () => {
    // A seal names no thread, so stripping its anchor leaves a mark
    // that still counts, still satisfies the tail predicate, and points
    // nowhere.
    assert.ok(
      gate(
        realThenBreak(
          "for (const name of logs) {\n" +
            '  const file = dir + "/" + name;\n' +
            '  const kept = fs.readFileSync(file, "utf8").split("\\n").map((line) => {\n' +
            "    if (!line.trim()) return line;\n" +
            "    const event = JSON.parse(line);\n" +
            '    if (event.ev === "sealed") delete event.anchor;\n' +
            "    return JSON.stringify(event);\n" +
            "  });\n" +
            '  fs.writeFileSync(file, kept.join("\\n"));\n' +
            "}\n",
        ),
        "02-question-only-turn",
      ),
      "an anchorless seal passed the kata",
    );
  });
});

// The boundary of the fixture skip (#86): everything under a kata tree
// is staged data, and nothing else is. Test code outside `katas/`
// makes real decisions, so its markers stay this turn's debt.
describe("FixtureBoundary", () => {
  it("kata trees are fixture paths, wherever they nest", () => {
    assert.ok(FIXTURE_PATH.test("tests/katas/_lib.sh"));
    assert.ok(FIXTURE_PATH.test("tests/original/reminder-heartbeat/katas/_lib.sh"));
    assert.ok(FIXTURE_PATH.test("tests/original/reminder-heartbeat/katas/24-marked/setup.sh"));
  });

  it("everything else keeps its markers billable", () => {
    assert.ok(!FIXTURE_PATH.test("tests/original/reminder-heartbeat/test_katas.mjs"));
    assert.ok(!FIXTURE_PATH.test("tests/original/thread-ledger/test_ledger.mjs"));
    assert.ok(!FIXTURE_PATH.test("original/thread-ledger/core.mjs"));
    assert.ok(!FIXTURE_PATH.test("tests/mykatas/file.sh"), "a directory merely named like katas is not one");
    assert.ok(!FIXTURE_PATH.test("contests/katas-notes.md"));
  });
});
