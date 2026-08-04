# A render older than the seal is still fresh

The trap in check 5's design. The hook seals AFTER the model renders —
sealing is the last write of a green turn — so the seal is always
newer than the page. A freshness test that counted seals would find
every healthy turn stale on its next Stop, fire, be satisfied, and
fire again the turn after: a reminder that is always right and never
useful, which is the fastest way to get a reminder deleted.

Seals are the hook's own writes. Check 2 already refuses to observe
the hook's seal through the store clone; this is the same doctrine
applied to time instead of space.

## What the fixture freezes

A log whose tail is `event, seal` in that order, and a page rendered
between the two.

## Expected

Exit 0, one new seal. The page is current with everything a reader
can see on it.
