# writing-prose rules the code can judge. Reads the text under check
# (after an optional --before file) and prints one line per finding:
#   <file>:<line>: F <rule-id>: <message>   fails the run
#   <file>:<line>: H <rule-id>: <message>   candidate for the agent
# Rule ids match the rules files beside SKILL.md.

function f(id, msg) { printf "%s:%d: F %s: %s\n", name, FNR, id, msg; failed = 1 }
function h(id, msg) { printf "%s:%d: H %s: %s\n", name, FNR, id, msg }

# True when word list `words` (alternation) occurs as a whole word in s.
function has_word(s, words) {
    return s ~ ("(^|[^a-z0-9_'-])(" words ")([^a-z0-9_'-]|$)")
}

{
    if (/^[ \t]*(```|~~~)/) { in_fence = !in_fence; next }
    if (in_fence) next
    prose = $0
    gsub(/`[^`]*`/, "", prose)
    low = tolower(prose)
    if (has_word(low, "just|really|basically|actually|simply"))
        f("filler", "cut the filler word")
}

END { exit failed }
