---
name: handing-off
description: >
  Prepare a session for compaction: write the handoff, mark it fresh,
  propose /compact focus lines. Use before a manual /compact, when a
  reminder or hook warns that compaction is near, or when asked to wrap
  up or hand off session context.
---

# Handing Off

Compaction keeps a summary the model writes under pressure. The handoff
is the part chosen deliberately: what is open, why, and what continues.

## Steps

1. **Collect open state** from the session itself, never by
   re-derivation: unmerged changes and what gates them, open tickets
   touched, rulings and standing rules the principal stated, gotchas
   that cost time. Completion: every item carries a next action.
2. **Write the handoff** to a file: what happened since the previous
   handoff; an open-state table (item | state | next); standing rules;
   gotchas. Link the previous handoff. Completion: a reader with none
   of this session's context can pick any table row and continue it.
3. **Publish** the file wherever the installing project keeps session
   artifacts, and update the tickets and progress records the session
   touched. Completion: the handoff has a URL.
4. **Mark freshness**: run `./mark.sh <handoff-file> [url]`. It records
   the live transcript's current size into `$HANDOFF_STATE` (default
   `~/.claude/handoff-state.json`) so hooks can tell a fresh handoff
   from a stale one. Completion: mark.sh prints the marker path.
5. **Propose focus**: from what continues next, print one to three
   candidate `/compact <focus line>` commands, first one recommended.
   Running `/compact` stays the user's step — end the run on the
   proposals.
6. Run `./check.sh` — machine-verifies the marker and handoff file,
   prints the residue to verify by hand.

The post-compaction verification and the compaction gate belong to the
installing project's hooks, where present; this skill only writes what
they read. `HANDOFF_STATE` and `HANDOFF_TRANSCRIPT` (transcript path
override; unset = newest transcript under `~/.claude/projects`) are the
whole contract between them.
