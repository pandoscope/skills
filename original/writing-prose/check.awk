# writing-prose rules the code can judge. Reads the text under check
# (after an optional --before file) and prints one line per finding:
#   <file>:<line>: F <rule-id>: <message>   fails the run
#   <file>:<line>: H <rule-id>: <message>   candidate for the agent
# Rule ids match the rules files beside SKILL.md.

function f_at(line, id, msg) { printf "%s:%d: F %s: %s\n", name, line, id, msg; failed = 1 }
function f(id, msg) { f_at(FNR, id, msg) }
function h(id, msg) { printf "%s:%d: H %s: %s\n", name, FNR, id, msg }

# True when alternation `words` occurs as a whole word in s.
function has_word(s, words) {
    return s ~ ("(^|[^a-z0-9_'-])(" words ")([^a-z0-9_'-]|$)")
}

function on(surfaces) { return index(" " surfaces " ", " " surface " ") > 0 }

# Angle placeholders outside code in tracker text; HTML tags pass.
function tracker_placeholders(s,    tag) {
    while (match(s, /<[a-z][a-z0-9_-]*>/)) {
        tag = substr(s, RSTART + 1, RLENGTH - 2)
        if (tag !~ /^(a|b|i|u|s|p|br|hr|em|strong|code|pre|sub|sup|kbd|details|summary|ul|ol|li|img|table|tr|td|th|div|span|blockquote|del|ins|mark|small)$/)
            return 1
        s = substr(s, RSTART + RLENGTH)
    }
    return 0
}

# A commit hash standing alone: 7-40 hex digits with a letter and a digit,
# outside markdown links, bare URLs and owner/repo@sha references.
function bare_hash(s,    tok) {
    gsub(/`/, " ", s)
    gsub(/\[[^]]*\]\([^)]*\)/, " ", s)
    gsub(/https?:\/\/[^ )>]*/, " ", s)
    gsub(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]+/, " ", s)
    while (match(s, /(^|[^0-9A-Za-z_\/])[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]+/)) {
        tok = substr(s, RSTART, RLENGTH)
        sub(/^[^0-9a-f]/, "", tok)
        s = substr(s, RSTART + RLENGTH)
        if (s ~ /^[0-9A-Za-z_]/ || length(tok) > 40) continue
        if (tok ~ /[a-f]/ && tok ~ /[0-9]/) return 1
    }
    return 0
}

{
    if (/^[ \t]*(```|~~~)/) { in_fence = !in_fence; next }
    if (in_fence) next
    raw = $0
    if (on("comment") && raw ~ /[«»]/)
        f("code-placeholder", "code takes <angle> placeholders, never guillemets")
    if (on("comment")) {
        if (raw !~ /^[ \t]*(#|\/\/|\/\*|\*|--|;)/ || raw ~ /^#!/) next
        sub(/^[ \t]*(#+|\/\/+|\/\*+|\*+|--|;+)[ \t]*/, "", raw)
    }
    low_all = low_all tolower(raw) " "
    prose = raw
    gsub(/`[^`]*`/, "", prose)
    low = tolower(prose)

    if (has_word(low, "just|really|basically|actually|simply"))
        f("filler", "cut the filler word")
    if (low ~ /(^|[.!?][ \t]+)(sure|certainly|of course|absolutely|great question)([ ,.!]|$)/ \
        || low ~ /(happy|glad) to help|i'd be happy|hope this helps|feel free to/)
        f("pleasantry", "cut the pleasantry")
    if (!on("chat") && raw ~ /[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z-[a-z0-9]/)
        f("store-id", "state the reason in plain words, not a private record id")
    if (on("ticket tracker") && tracker_placeholders(prose))
        f("tracker-placeholder", "tracker text takes «guillemet» placeholders")
    if (on("ticket tracker") && bare_hash(raw))
        f("commit-link", "link the commit: [short](repo-url/commit/full) or owner/repo@sha")
}

END {
    if (on("ticket") && low_all !~ /grill/)
        f_at(1, "ungrilled", "state whether the ticket was grilled")
    exit failed
}
