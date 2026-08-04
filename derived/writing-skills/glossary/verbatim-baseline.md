## Verbatim Baseline

The untouched upstream copy of a vendored skill, committed before any edit.
It makes the derivation readable as a diff against what upstream actually published,
so a reviewer sees the changes rather than the whole file,
and a later upstream release can be folded in against a known common ancestor.

_Avoid_: vendor copy, upstream snapshot, pristine copy
