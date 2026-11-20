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
The result file below is your only output.

Every finding names a concrete input on which the change departs from the specification.
It quotes, verbatim, the sentence of the ticket or the pull request body that the change violates.
It states the departure, not a fix.

# Output contract

{#- DECISION:SCOPE: the composer renders no order id (pandoscope's src/pandoscope/reinset/review.py),
    so the reviewer reads it from the waybill's history,
    and the driver's denials and Stop reasons name the full path. #}
Write one JSON object, the result, to `results/<order id>.json` in the clone of the waybill.
That clone is `waybill/` under your working directory.
The order id is the name, without `.yml`, of the order file that the newest commit to its `orders/` added:
`git -C <waybill clone> log -1 --name-only --format= -- orders/` prints that file.
The Write tool creates the directory.
Give the object these fields:

{{ findings_contract }}

`order_id` is the order id.
`pr` is `{{ repo }}#{{ n }}`, `head` is `{{ head }}`, `pass` is `spec-fidelity` and `model_tier` is `{{ model_tier }}`.
In each finding, `rule` quotes the ticket or pull request body sentence the change violates.

Then stop.
The driver commits and pushes the result file on the order's branch.

When done, reply with at most three lines.
