"""Syntactic checks by dependency parse: verb-distance and relative-clause.

Usage: parse.py <file> <name> <surface> [<before-file>]
check.sh --parse runs this through uvx with spaCy and its English model pinned,
and the awk heuristics for the same two rules step aside.
Prints H candidates as `<name>:<line>: H <rule>: <message>`, like patterns.awk.
"""
import bisect
import re
import sys

import spacy

BETWEEN = {"relcl", "acl", "appos"}


def paragraphs(lines, surface, sh):
    """Prose paragraphs as (text, start offsets, line numbers); code fences and code are skipped."""
    paras, cur, fence = [], [], False

    def flush():
        if cur:
            paras.append(list(cur))
            cur.clear()

    for n, raw in enumerate(lines, 1):
        if surface == "comment":
            s = raw.strip()
            if not s.startswith("#" if sh else "//"):
                flush()
                continue
            text = re.sub(r"^\s*(//+|#+)\s?", "", raw)
        else:
            if raw.strip().startswith("```"):
                fence = not fence
                flush()
                continue
            if fence or raw.strip().startswith("|"):
                flush()
                continue
            text = re.sub(r"^\s*([-*+>]|#+|\d+[.)])\s+", "", raw)
        if not text.strip():
            flush()
            continue
        cur.append((n, text.strip()))
    flush()
    out = []
    for para in paras:
        starts, nums, parts, pos = [], [], [], 0
        for n, text in para:
            starts.append(pos)
            nums.append(n)
            parts.append(text)
            pos += len(text) + 1
        out.append((" ".join(parts), starts, nums))
    return out


def masked(text):
    """Code spans become one opaque word of the same length, so offsets keep their lines."""
    return re.sub(r"`[^`]*`", lambda m: "x" * len(m.group(0)), text)


def segments(text):
    """Spans of the text to parse on their own, split after a colon and at a single dash.

    A lead-in without a verb before a colon or dash ("A closed list rather than free text: provenance is …")
    is parsed with the clause after it as one sentence, and the parser then pairs words that are no subject and verb.
    A dash with a second dash later in its sentence opens a parenthesis, which verb-distance must still see, so it stays.
    """
    cuts, closing = [], -1
    for m in re.finditer(r":\s|\s—\s", text):
        if m.group(0).strip() == "—":
            if m.start() == closing:
                continue
            rest = re.split(r"[.!?]\s", text[m.end():], maxsplit=1)[0]
            pair = re.search(r"\s—\s", rest)
            if pair:
                closing = m.end() + pair.start()
                continue
        cuts.append(m.end())
    bounds = [0] + cuts + [len(text)]
    return [(a, b) for a, b in zip(bounds, bounds[1:]) if text[a:b].strip()]


def verb_distance(sent):
    for t in sent:
        if t.dep_ not in ("nsubj", "nsubjpass") or t.head.pos_ not in ("VERB", "AUX") or t.i > t.head.i:
            continue
        between = [w for w in sent if t.i < w.i < t.head.i]
        # Auxiliaries and negation belong to the verb, not to the gap before it.
        words = [w for w in between if not w.is_punct
                 and not (w.head.i == t.head.i and w.dep_ in ("aux", "auxpass", "neg"))]
        if any(w.dep_ in BETWEEN for w in between) or any(w.text in ("(", "—") for w in between):
            yield t, f"a clause or parenthesis sits between `{t.text}` and `{t.head.text}`"
            continue
        preps = [c for c in t.children if c.dep_ == "prep" and t.i < c.i < t.head.i]
        in_one_prep = len(preps) == 1 and all(w in set(preps[0].subtree) for w in words)
        if len(words) > 4 and not in_one_prep:
            yield t, f"{len(words)} words between `{t.text}` and `{t.head.text}`"


def relative_clause(sent):
    # Only the reduced relative: a contact clause ("the causes the model cannot fix") reads naturally,
    # and the principal picked a rewrite that uses one (skills#240, P2).
    for t in sent:
        if t.dep_ == "acl" and t.tag_ in ("VBN", "VBG") and t.head.pos_ == "NOUN" \
                and not any(c.dep_ in ("nsubj", "nsubjpass", "mark") for c in t.children):
            yield t, f"reduced relative `{t.head.text} {t.text}`: open it with that or which"


def main():
    path, name, surface = sys.argv[1], sys.argv[2], sys.argv[3]
    before = open(sys.argv[4]).read() if len(sys.argv) > 4 and sys.argv[4] else None
    lines = open(path).read().split("\n")
    first = lines[0] if lines else ""
    sh = name.endswith((".sh", ".bash", ".py")) or (first.startswith("#!") and re.search(r"\b(ba)?sh\b|python", first) is not None)
    nlp = spacy.load("en_core_web_sm")
    for text, starts, nums in paragraphs(lines, surface, sh):
        # With a `before` file, a paragraph it already holds is untouched.
        if before is not None and text in " ".join(before.split()):
            continue
        plain = masked(text)
        for start, end in segments(plain):
            for sent in nlp(plain[start:end]).sents:
                for rule, finder in (("verb-distance", verb_distance), ("relative-clause", relative_clause)):
                    for tok, msg in finder(sent):
                        line = nums[bisect.bisect_right(starts, start + tok.idx) - 1]
                        print(f"{name}:{line}: H {rule}: {msg}")
                        break


if __name__ == "__main__":
    main()
