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

/** The store root a staged kata's heartbeat writes to. */
function storeOf(dir) {
  return path.join(dir, "store");
}

/**
 * Expand the placeholders a checked-in expectation cannot hold.
 *
 * Reason text names absolute paths, which differ per machine, so the
 * fixture writes `{{ledger}}` and the runner resolves it. Asserting the
 * expanded text keeps the wording exact without pinning it to a checkout
 * location.
 */
function expand(text, dir) {
  return text
    .replaceAll("{{ledger}}", LEDGER)
    .replaceAll("{{home}}", path.join(dir, "home"))
    .replaceAll("{{store}}", storeOf(dir))
    .replaceAll("{{repos}}", path.join(dir, "repos"));
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
      SESSION_MEMORY_ROOT: storeOf(dir),
      HEARTBEAT_REPO_ROOT: path.join(dir, "repos"),
    },
  });
  assert.equal(result.error, undefined, `the hook did not run: ${result.error}`);
  return result;
}

/** Events in the kata's ledger log after the hook ran. */
function ledgerEvents(dir) {
  const logs = path.join(storeOf(dir), "ledger");
  return fs
    .readdirSync(logs)
    .filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) =>
      fs
        .readFileSync(path.join(logs, name), "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line)),
    );
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
    spec.reason.length ? `${expand(spec.reason.join("\n"), dir)}\n` : "",
    `${name}: the reason text is part of the contract`,
  );

  const sealed = ledgerEvents(dir).filter((event) => event.ev === "sealed");
  // A kata's own fixture may already carry an earlier turn's seal, so
  // the question is whether THIS run added one, not whether any exists.
  const added = sealed.length - spec.sealed_before;
  assert.equal(added, spec.sealed ? 1 : 0, `${name}: seals added by this run`);

  // Every check's verdict is logged whatever happens — that log is the
  // input for measuring whether reminders change behaviour at all, and
  // logging only failures would measure only the failures.
  const [record, ...extra] = complianceLog(dir);
  assert.ok(record, `${name}: nothing reached the compliance log`);
  assert.deepEqual(extra, [], `${name}: one turn, one compliance record`);
  assert.deepEqual(
    record.verdicts.map((verdict) => verdict.check),
    ["turn-summary", "pushed", "ledger-event"],
    `${name}: every check reports, pass or fail`,
  );
  assert.equal(record.fired, spec.check, `${name}: the check the log says fired`);
  assert.equal(record.guarded, spec.stop_hook_active ?? false);
}

// ---------------------------------------------------------------- katas

describe("Katas", () => {
  for (const name of kataNames()) {
    const dir = stage(name);
    const spec = readSpec(dir);
    spec.sealed_before = ledgerEvents(dir).filter((event) => event.ev === "sealed").length;

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

describe("KataRunnerRedGates", () => {
  const drift = "01-four-turns-of-drift";

  /** Run the founding kata against `body` and return the failure, if any. */
  function gate(body) {
    const dir = stage(drift);
    const spec = readSpec(dir);
    spec.sealed_before = ledgerEvents(dir).filter((event) => event.ev === "sealed").length;
    const script = brokenHeartbeat(dir, body);
    try {
      assertKata(drift, dir, spec, fire(dir, spec, script));
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
        'import fs from "node:fs";\n' +
          'const log = process.env.SESSION_MEMORY_ROOT + "/ledger/session_kata_drift.jsonl";\n' +
          'fs.appendFileSync(log, JSON.stringify({ ev: "sealed" }) + "\\n");\n' +
          "process.exit(2);\n",
      ),
      "a heartbeat that sealed a blocked turn passed the kata",
    );
  });

  it("catches a heartbeat that logs nothing", () => {
    assert.ok(
      gate('process.stderr.write("x\\n");\nprocess.exit(2);\n'),
      "a heartbeat with no compliance log passed the kata",
    );
  });
});
