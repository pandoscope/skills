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

function words(s,    n, w, i, out) {
    n = split(s, w)
    for (i = 1; i <= n; i++) out = out (i > 1 ? " " : "") w[i]
    return out
}

# Reads the --before text: its code blocks in order, and each paragraph
# both as written and as a bare word sequence.
function read_before(    line, fence, code, para, n) {
    while ((getline line < before) > 0) {
        if (line ~ /^[ \t]*(```|~~~)/) {
            if (fence) bcode[++nb] = code
            fence = !fence; code = ""
            if (para != "") { bwords[words(para)] = 1; braw[para] = 1; para = "" }
            continue
        }
        if (fence) { code = code line "\n"; continue }
        if (line ~ /^[ \t]*$/) {
            if (para != "") { bwords[words(para)] = 1; braw[para] = 1 }
            para = ""
        } else para = para line "\n"
    }
    if (para != "") { bwords[words(para)] = 1; braw[para] = 1 }
    close(before)
}

# A paragraph ended: fails when it holds the same words as a paragraph
# of the old text but breaks its lines differently.
function end_para() {
    if (para == "") return
    if (before != "" && !style && on("markdown skill primed") \
        && (words(para) in bwords) && !(para in braw))
        f_at(para_start, "reflow", "untouched words, new line breaks: restore the old lines, or reflow in a style commit")
    para = ""
}

BEGIN { if (before != "") read_before() }

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
    if (/^[ \t]*(```|~~~)/) {
        if (in_fence) acode[++na] = code
        else code_start[na + 1] = FNR
        in_fence = !in_fence; code = ""
        end_para()
        next
    }
    if (in_fence) { code = code $0 "\n"; next }
    if (/^[ \t]*$/) end_para()
    else { if (para == "") para_start = FNR; para = para $0 "\n" }
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
    end_para()
    if (before == "") {
        print "skipped code-exact: no --before text to compare"
        if (on("markdown skill primed")) print "skipped reflow: no --before text to compare"
    }
    else {
        for (i = 1; i <= (na > nb ? na : nb); i++)
            if (acode[i] != bcode[i]) {
                f_at(i in code_start ? code_start[i] : 1, "code-exact", "code blocks come through a rewrite byte-identical")
                break
            }
    }
    if (on("ticket") && low_all !~ /grill/)
        f_at(1, "ungrilled", "state whether the ticket was grilled")
    exit failed
}
