# Python docstrings as comment prose, shared by patterns.awk and sembr.awk.
# check.sh loads this file ahead of either; each sets `py` for a .py file.

# A docstring line, read as comment prose on stream s ("main" or "before").
# A docstring is a triple-quoted string that starts a line at the top of the module or right after a line ending in a colon.
# Sets dkind to "open", "body", "deep" (indented past the docstring's own indentation), "close", or "" for any other line,
# and returns the line's text without quotes and indentation.
function doc_line(line, s,    t, d, i) {
    dkind = ""
    if (s in indoc) {
        d = indoc[s]
        i = index(line, d)
        t = i ? substr(line, 1, i - 1) : line
        if (i) { delete indoc[s]; dkind = "close" }
        else {
            match(t, /^[ \t]*/)
            dkind = (t !~ /^[ \t]*$/ && RLENGTH > base[s]) ? "deep" : "body"
        }
        sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t)
        return t
    }
    if (line ~ /^[ \t]*[rRuU]?("""|\047\047\047)/ && (!seen[s] || last[s] ~ /:[ \t]*$/)) {
        match(line, /^[ \t]*/)
        base[s] = RLENGTH
        t = substr(line, RLENGTH + 1)
        sub(/^[rRuU]/, "", t)
        d = substr(t, 1, 3)
        t = substr(t, 4)
        i = index(t, d)
        if (i) t = substr(t, 1, i - 1)
        else indoc[s] = d
        sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t)
        dkind = "open"; seen[s] = 1; last[s] = d
        return t
    }
    if (line !~ /^[ \t]*(#|$)/) {
        seen[s] = 1
        t = line
        sub(/[ \t]+#.*$/, "", t)
        last[s] = t
    }
    return ""
}
