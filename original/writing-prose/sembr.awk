# Rewrites prose paragraphs one sentence per line, the `sembr` rule.
# check.sh --fix runs this file and writes its output over the file.
# With --before, lines that stand in the old text ahead of a paragraph's first change are printed as they were,
# because the `reflow` rule forbids touching them.
# A sentence longer than `LIMIT` visible characters is broken after the comma, semicolon or colon nearest its middle.
# A sentence with no such break stays on one line:
# where to split it is a wording decision the `long-line` rule leaves to the writer.

# The text a line contributes to a paragraph, as in patterns.awk.
function para_text(line) {
    if (surface != "comment") return line
    if (line !~ /^[ \t]*(#|\/\/|\/\*|\*|--|;)/ || line ~ /^#!/) return "\001"
    sub(/^[ \t]*(#+|\/\/+|\/\*+|\*+|--|;+)[ \t]*/, "", line)
    return line
}

# The marker and indentation a comment line opens with.
function prefix_of(line) {
    if (surface != "comment") { match(line, /^[ \t]*/); return substr(line, 1, RLENGTH) }
    match(line, /^[ \t]*(#+|\/\/+|\*+|--|;+)[ \t]?/)
    return substr(line, 1, RLENGTH)
}

# A line that starts or continues running prose.
# Lists, headings, quotes, tables, HTML and blank lines do not.
function prose(t) {
    return t != "\001" && t !~ /^[ \t]*$/ \
        && t !~ /^[ \t]*([-+*][ \t]|[0-9]+[.)][ \t]|[#>|<])/
}

function read_before(    line) {
    while ((getline line < before) > 0) bline[para_text(line)] = 1
    close(before)
}

# Length as read: a link counts as its label, a URL as one word.
function visible(s) {
    gsub(/\]\([^)]*\)/, "]", s)
    gsub(/https?:\/\/[^ )>]*/, "URL", s)
    return length(s)
}

# Splits s at sentence ends into out[1..n] and returns n.
# A sentence ends at . ! or ? after a letter, digit, ) or backtick,
# followed by spaces and a capital letter or an identifier such as cycleOf, max_blocks or check.sh, outside code spans.
function sentences(s, out,    n, i, c, code, start, rest) {
    n = 0; code = 0; start = 1
    for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (c == "`") { code = !code; continue }
        if (code || c !~ /[.!?]/ || i == 1) continue
        if (substr(s, i - 1, 1) !~ /[a-z0-9)`"']/) continue
        rest = substr(s, i + 1)
        if (rest !~ /^ +([A-Z`]|[a-z]+[A-Z_.][a-zA-Z_])/) continue
        if (substr(s, 1, i) ~ /(^| )(e\.g|i\.e|etc|vs|cf)\.$/) continue
        out[++n] = substr(s, start, i - start + 1)
        match(rest, /^ +/)
        i += RLENGTH; start = i + 1
    }
    if (start <= length(s)) out[++n] = substr(s, start)
    return n
}

# Prints sentence s with prefix p, broken at clause boundaries while it is longer than `LIMIT`.
function emit(p, s,    i, c, code, link, mid, best, dist, d) {
    if (visible(s) <= LIMIT) { print p s; return }
    mid = int(length(s) / 2); best = 0; code = 0; link = 0
    for (i = 2; i < length(s); i++) {
        c = substr(s, i, 1)
        if (c == "`") code = !code
        else if (c == "[") link++
        else if (c == ")" && link > 0) link--
        if (code || link || c !~ /[,;:]/ || substr(s, i + 1, 1) != " ") continue
        d = i - mid; if (d < 0) d = -d
        if (!best || d < dist) { best = i; dist = d }
    }
    if (!best) { print p s; return }
    emit(p, substr(s, 1, best))
    emit(p, substr(s, best + 2))
}

function flush(    i, first, joined, n, parts) {
    if (!np) return
    first = 1
    if (before != "") while (first <= np && ptext[first] in bline) print plines[first++]
    joined = ""
    for (i = first; i <= np; i++) {
        sub(/^[ \t]+/, "", ptext[i]); sub(/[ \t]+$/, "", ptext[i])
        joined = joined (i > first ? " " : "") ptext[i]
    }
    n = first <= np ? sentences(joined, parts) : 0
    for (i = 1; i <= n; i++) emit(pfx, parts[i])
    np = 0
}

BEGIN {
    if (LIMIT == "") LIMIT = 120
    if (before != "") read_before()
}

{
    line = $0
    if (line ~ /^[ \t]*(```|~~~)/) { flush(); fence = !fence; print line; next }
    if (fence) { print line; next }
    t = para_text(line)
    # A list item and its indented continuation lines stay as written.
    if (t ~ /^[ \t]*([-+*][ \t]|[0-9]+[.)][ \t])/) { flush(); inlist = 1; print line; next }
    if (inlist && t ~ /^[ \t]+[^ \t]/) { print line; next }
    inlist = 0
    if (!prose(t)) { flush(); print line; next }
    if (np && prefix_of(line) != pfx) flush()
    if (!np) pfx = prefix_of(line)
    plines[++np] = line; ptext[np] = t
}

END { flush() }
