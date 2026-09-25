{% include "_task.md" %}
Read every changed file in full at the head commit before judging it.
Read a large file in successive ranges until you reach its end.

The specification is the ticket text plus the scope the pull request body states.
Review the change against it on the following axes:
behaviour the specification requires that is missing,
behaviour the specification does not ask for,
and behaviour that looks implemented but is wrong.
Report only what the specification decides.
Judge by reading the code.
The findings file below is your only output.

Every finding names a concrete input on which the change departs from the specification.
It quotes, verbatim, the sentence of the ticket or the pull request body that the change violates.
It states the departure, not a fix.

# Output contract

Write one JSON object to `reviews/spec-fidelity-{{ model_tier }}/findings.json` in the clone.
The Write tool creates the directory.
Give the object these fields:

{{ findings_contract }}

`pr` is `{{ repo }}#{{ n }}`, `head` is `{{ head }}`, `pass` is `spec-fidelity` and `model_tier` is `{{ model_tier }}`.
In each finding, `rule` quotes the ticket or pull request body sentence the change violates.

Then stop. The driver commits and pushes the findings.

When done, reply with at most three lines.
