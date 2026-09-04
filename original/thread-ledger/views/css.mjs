// The page's stylesheet.
//
// Inlined into the published page, which can fetch nothing. Header
// contract: `../views.mjs`.

export const CSS = `
/* Neutrals carry a slight blue bias toward the accent so the ground
   reads as chosen rather than inherited. Semantic hues are separate
   from the accent: amber waits on work, violet waits on the
   principal, green is done. */
:root{
  --bg:#fbfcfd; --panel:#fff; --fg:#131820; --dim:#5d6b7d; --line:#e2e8f0;
  --accent:#2f6fed; --fill:#e8f0fe;
  --ok:#0f8a5f; --wait:#b26a00; --you:#6d4aff; --drop:#94a3b8;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0c1116; --panel:#111820; --fg:#e3eaf2; --dim:#8f9dae; --line:#1f2a36;
    --accent:#6a9bff; --fill:#132540;
    --ok:#3fb87d; --wait:#d9a441; --you:#9d84ff; --drop:#5c6b7c;
  }
}
:root[data-theme=dark]{
  --bg:#0c1116; --panel:#111820; --fg:#e3eaf2; --dim:#8f9dae; --line:#1f2a36;
  --accent:#6a9bff; --fill:#132540;
  --ok:#3fb87d; --wait:#d9a441; --you:#9d84ff; --drop:#5c6b7c;
}
:root[data-theme=light]{
  --bg:#fbfcfd; --panel:#fff; --fg:#131820; --dim:#5d6b7d; --line:#e2e8f0;
  --accent:#2f6fed; --fill:#e8f0fe;
  --ok:#0f8a5f; --wait:#b26a00; --you:#6d4aff; --drop:#94a3b8;
}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);margin:0 auto;padding:2.5rem 1.25rem 4rem;
  max-width:62rem;
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.mono,.anchor{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-variant-numeric:tabular-nums}
header{display:flex;flex-direction:column;gap:.75rem;margin-bottom:1.75rem}
h1{font-size:1.3rem;font-weight:650;margin:0;letter-spacing:-.01em;text-wrap:balance}
.summary{display:flex;flex-wrap:wrap;gap:.4rem}
.stat{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.75rem;
  border:1px solid var(--line);background:var(--panel);border-radius:6px;
  padding:.2rem .55rem;color:var(--dim);white-space:nowrap}
.stat b{font-weight:600;color:var(--fg)}
.stat.you{border-color:var(--you);color:var(--you)}
.stat.you b{color:var(--you)}
.threads{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.25rem}
/* The progress fill is a gradient on the card, not a child: a clipped
   child needs overflow:hidden, and that silently eats every tooltip. */
.thread{display:flex;align-items:center;gap:.5rem;padding:.35rem .55rem;
  border:1px solid var(--line);border-radius:7px;
  background:linear-gradient(to right,var(--fill) 0 var(--pct,0%),
    var(--panel) var(--pct,0%) 100%)}
.thread[style*="--pct:0%"]{background:var(--panel)}
.thread.child{margin-left:1.5rem}
.thread.muted{opacity:.7}
.grow{flex:1;min-width:0}
.ttl{display:block;white-space:nowrap;overflow:hidden;font-weight:600;cursor:help}
.ref,.pick{flex:none;min-width:5.5rem;text-align:center}
.ref{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;
  font-weight:500;text-decoration:none;padding:.05rem .3rem;border-radius:4px;
  background:color-mix(in srgb,var(--accent) 12%,transparent)}
.ref:hover{text-decoration:underline}
.pick{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;
  color:var(--dim);background:var(--panel);border:1px dashed var(--line);
  border-radius:4px;padding:.05rem .25rem;cursor:pointer}
.pick:hover{border-color:var(--accent);color:var(--accent)}
/* A ticket whose description has fallen behind the session. Amber,
   not the blocked hues: nothing is waiting, the record is just out of
   date. */
/* A \`summary\` is \`display:list-item\` by default, which parks its text
   in the corner even once the marker is hidden. Flex centring is what
   puts the glyph back in the middle of the circle. */
.info{flex:none;width:1.15rem;height:1.15rem;padding:0;border-radius:999px;
  display:flex;align-items:center;justify-content:center;
  border:1px solid var(--wait);background:var(--panel);color:var(--wait);
  font:600 .68rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}
.info:hover{background:var(--wait);color:var(--panel)}
button.stat{font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:.75rem;cursor:pointer}
.stat.outdated{border-color:var(--wait);color:var(--wait)}
.stat.outdated b{color:var(--wait)}
.stat.outdated:hover{background:var(--wait);color:var(--panel)}
.stat.outdated:hover b{color:var(--panel)}
.copied{position:fixed;left:50%;bottom:1.5rem;transform:translateX(-50%);z-index:50;
  padding:.5rem .8rem;border-radius:7px;border:1px solid var(--line);
  background:var(--panel);color:var(--fg);font-size:.82rem;
  box-shadow:0 8px 24px rgb(0 0 0 / .2);max-width:min(38rem,90vw)}
.anchor{color:var(--dim);font-size:.71rem;white-space:nowrap;flex:none}
.rel:not(:empty)::before{content:" · "}
/* State reads twice: the card's border carries it at a distance, the
   pill names it up close, and the reason waits behind the pill. */
.thread.s-blocked-internal{border-color:var(--wait)}
.thread.s-blocked-external{border-color:var(--accent)}
.thread.s-blocked-principal{border-color:var(--you);box-shadow:inset 0 0 0 1px var(--you)}
.thread.s-parked{border-style:dashed}
.pill{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.7rem;
  flex:none;border:1px solid var(--line);border-radius:999px;padding:.05rem .5rem;
  color:var(--dim);background:var(--panel);cursor:help}
.s-blocked-internal .pill{color:var(--wait);border-color:currentColor}
.s-blocked-external .pill{color:var(--accent);border-color:currentColor}
.s-blocked-principal .pill{color:var(--you);border-color:currentColor;font-weight:600}
.s-parked .pill{border-style:dashed}
/* Severity tiers (skills#58). The card border carries the tier at a
   distance; blocked-on-principal is deliberately absent — violet owns
   that state, and the quiet default stays quiet. Light red is the
   awkward tier everywhere: here it is the red hue at lower weight. */
:root{--t-red:#d92d20; --t-red-soft:#f97066; --t-orange:#e8590c; --t-yellow:#b78103}
@media (prefers-color-scheme:dark){
  :root{--t-red:#f97066; --t-red-soft:#e0726a; --t-orange:#ff922b; --t-yellow:#e3b341}
}
:root[data-theme=dark]{--t-red:#f97066; --t-red-soft:#e0726a; --t-orange:#ff922b; --t-yellow:#e3b341}
:root[data-theme=light]{--t-red:#d92d20; --t-red-soft:#f97066; --t-orange:#e8590c; --t-yellow:#b78103}
.thread.t-blocking-urgent{border-color:var(--t-red);box-shadow:inset 3px 0 0 var(--t-red)}
.thread.t-blocking-important{border-color:var(--t-red-soft);box-shadow:inset 3px 0 0 var(--t-red-soft)}
.thread.t-urgent{border-color:var(--t-orange);box-shadow:inset 3px 0 0 var(--t-orange)}
.thread.t-important{border-color:var(--t-yellow);box-shadow:inset 3px 0 0 var(--t-yellow)}
.t-blocking-urgent .pill{color:var(--t-red);border-color:currentColor;font-weight:600}
.t-blocking-important .pill{color:var(--t-red-soft);border-color:currentColor}
/* The sessions section: one head carries the selected session's
   identity and totals and IS the picker; the dropdown lists every
   session (and the overview) with names beside ids; beneath, only the
   last seal shows, the whole run behind one expand. Stretch rules stay
   quiet when clean — amber marks a reminded stretch, red a gave-up,
   and everything else is dim monospace a reader scans, not reads. */
.sessions{margin:0 0 1.5rem;display:flex;flex-direction:column;gap:.5rem}
.picker{position:relative}
.picker>summary{list-style:none;cursor:pointer;display:flex;align-items:center;
  gap:.6rem;border:1px solid var(--line);background:var(--panel);
  border-radius:7px;padding:.45rem .65rem}
.picker>summary::-webkit-details-marker{display:none}
.picker>summary:hover{border-color:var(--accent)}
.sesshead{display:none;align-items:baseline;gap:.35rem .7rem;flex:1;min-width:0;
  flex-wrap:wrap}
.sesshead.on{display:flex}
.sname{font-weight:600;white-space:nowrap}
.sid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;
  color:var(--dim);white-space:nowrap}
.stotals{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.74rem;
  color:var(--dim)}
.caret{color:var(--dim);flex:none;font-size:.7rem}
.options{position:absolute;left:0;right:0;top:calc(100% + .3rem);z-index:40;
  margin:0;padding:.25rem;list-style:none;border:1px solid var(--line);
  border-radius:8px;background:var(--panel);
  box-shadow:0 10px 30px rgb(0 0 0 / .18);display:flex;flex-direction:column;
  max-height:60vh;overflow:auto}
.opt{font:inherit;text-align:left;display:flex;align-items:baseline;
  gap:.35rem .7rem;flex-wrap:wrap;width:100%;border:0;background:none;
  color:var(--fg);border-radius:6px;padding:.4rem .5rem;cursor:pointer}
.opt:hover{background:var(--fill)}
.opt b{white-space:nowrap}
.oid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;
  color:var(--dim)}
.ototals{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;
  color:var(--dim);margin-left:auto}
.sess{border:1px solid var(--line);border-radius:7px;background:var(--panel);
  padding:.35rem .55rem}
.allseals>summary{font-size:.72rem;color:var(--dim);cursor:pointer;
  padding:.1rem 0 .25rem}
.stretchlist{list-style:none;margin:.35rem 0 0;padding:0;display:flex;
  flex-direction:column;gap:.15rem}
.stretch{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;
  color:var(--dim);border-top:1px solid var(--line);padding:.2rem 0 0}
.stretch .sthreads{flex:1;min-width:8rem;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;color:var(--fg)}
.stretch.st-remind{border-top-color:var(--wait)}
.stretch .remind{color:var(--wait)}
.stretch.st-gaveup{border-top-color:var(--t-red)}
.stretch .gaveup{color:var(--t-red);font-weight:600}
.stretch.tail,.stretch.legacy{border-top-style:dashed;font-style:italic}
.gap{border:1px dashed var(--wait);color:var(--wait);border-radius:4px;
  padding:0 .3rem;cursor:help}
.mult{color:var(--dim)}
.mult.hot{color:var(--fg);font-weight:600}
.older>summary{font-size:.7rem;color:var(--dim);cursor:pointer;padding:.15rem 0}
.stretch .schecks{color:var(--dim)}
.note{color:var(--dim);font-size:.84rem}
hr{border:0;border-top:1px solid var(--line);margin:2.25rem 0 1rem}
.done{gap:0}
.thread.closed{gap:.5rem;background:none;border:0;border-radius:0;padding:.15rem 0}
.thread.closed .ttl{font-weight:400}
.thread.dropped{color:var(--drop)}
.thread.dropped .ttl{text-decoration:line-through}
.mark{color:var(--ok)}
.thread.dropped .mark{color:var(--drop)}
a{color:var(--accent);text-underline-offset:2px}
/* The prompt disclosures. \`details\` opens with no script at all, so
   the text is always reachable; the copy button is the shortcut, not
   the mechanism. */
.pop{position:relative;flex:none}
.pop>summary{list-style:none;cursor:pointer}
.pop>summary::-webkit-details-marker{display:none}
/* Also a summary, and also list-item by default. */
summary.stat.outdated{display:inline-block}
/* The un-scripted placement: right-aligned under the control, and
   never wider than the viewport. Script refines this to a clamped
   fixed position; this is what a reader gets if it does not run. */
.pop-body{position:absolute;right:0;top:calc(100% + .35rem);z-index:40;
  width:min(34rem,80vw);max-width:calc(100vw - 1rem);
  padding:.5rem;border-radius:8px;
  border:1px solid var(--line);background:var(--panel);
  box-shadow:0 10px 30px rgb(0 0 0 / .18)}
.pop-head{display:flex;align-items:center;justify-content:space-between;
  gap:.5rem;font-size:.72rem;color:var(--dim);padding:0 .1rem .35rem}
.pop-acts{display:flex;align-items:center;gap:.3rem;flex:none}
.cp,.x{font:600 .7rem/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;
  padding:.25rem .5rem;border-radius:5px;border:1px solid var(--accent);
  background:var(--panel);color:var(--accent)}
.x{border-color:var(--line);color:var(--dim);padding:.25rem .4rem}
.cp:hover{background:var(--accent);color:var(--panel)}
.x:hover{border-color:var(--fg);color:var(--fg)}
.pop-text{width:100%;resize:vertical;padding:.45rem .55rem;border-radius:6px;
  border:1px solid var(--line);background:var(--bg);color:var(--fg);
  font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
/* The self-report. Deliberately plain and at the end: it is a tool for
   the two of us, not part of the ledger. */
.diag{margin-top:2.5rem;font-size:.75rem;color:var(--dim)}
.diag>summary{cursor:pointer}
.diag .pop-body{position:static;width:auto;margin-top:.4rem}
/* A linked title stays typographically a title: the link is the whole
   row's affordance, not a blue interruption in the middle of it. */
.tlink{color:inherit;text-decoration:none;min-width:0}
.tlink:hover{text-decoration:underline;text-decoration-color:var(--accent)}
a:focus-visible,:focus-visible{outline:2px solid var(--accent);outline-offset:2px;
  border-radius:3px}
`;
