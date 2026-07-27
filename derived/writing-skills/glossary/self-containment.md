## Self-Containment

A skill carries everything it needs inside its own folder.
It is installed individually, into a project that may use none of the tooling
the authoring project assumes — so a reference reaching outside the folder either dangles
or drags in something the project has nothing to do with.
Bounds what a skill may name: no project-specific document paths, no tool or CLI names
the installing project need not have.

_Avoid_: portability, standalone, isolation
