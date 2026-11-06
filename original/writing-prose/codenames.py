"""Comment checks that need the code around a comment: code-mark and call-site.

Usage: codenames.py <file> <name> [<before-file>]
Prints H candidates as `<name>:<line>: H <rule>: <message>`, like patterns.awk.
With a before file, only comment blocks the before file lacks are checked.
Standard library only, so the check runs wherever check.sh does.
"""
import re
import sys

IDENT = r"[A-Za-z_$][\w$]*"
STRING = re.compile(r"(['\"`])((?:\\.|(?!\1).)*)\1")
# Common words a code name can share, which say nothing about the code when unmarked.
STOP = set("""a an the of at to in on is are be it its if else for and or not no as by with from this that then than
so do does did was were when while new return const let var function class true false null undefined
typeof await async break continue case switch default try catch throw finally delete void yield""".split())
SHAPED = re.compile(r"[a-z][a-z0-9]*[A-Z]\w*|\w*_\w+|\w+\.\w+(?:\.\w+)*|--[a-z][\w-]*|\w+\(\)")
PATH = re.compile(r"[\w./-]+\.(?:sh|mjs|js|ts|json|jsonl|py|md|ya?ml|awk|toml)|\.{0,2}/[\w./-]*")


def h(line, rule, msg):
    print(f"{NAME}:{line}: H {rule}: {msg}")


def is_comment(line, sh):
    s = line.strip()
    return s.startswith("#") if sh else s.startswith(("//", "/*", "*"))


def strip_marker(line):
    return re.sub(r"^\s*(//|#|/\*\*?|\*/?)\s?", "", line)


def code_of(lines, sh):
    """The code without comments, and the string literals it holds."""
    code, strings = [], []
    for line in lines:
        if is_comment(line, sh):
            continue
        if not sh:
            line = re.sub(r"\s//\s.*$", "", line)
        strings += [m.group(2) for m in STRING.finditer(line)]
        code.append(STRING.sub(" ", line))
    return "\n".join(code), strings


def names_in(code, strings):
    """Identifiers, their dotted parts, and whole-word string values."""
    names = set()
    for ident in re.findall(IDENT + r"(?:\.[A-Za-z_$][\w$]*)*", code):
        names.add(ident)
        names.update(ident.split("."))
    values = {s for s in strings if re.fullmatch(r"[A-Za-z][\w-]*", s)}
    return names, values


def line_comment(line, sh):
    return line.strip().startswith("#" if sh else "//")


def blocks(lines, sh):
    """Line-comment blocks as (first line number, the block's lines, the index after it).

    Doc comments are left out: the checks' precision was measured on line comments only (skills#240).
    """
    i = 0
    while i < len(lines):
        if line_comment(lines[i], sh):
            j = i
            while j < len(lines) and line_comment(lines[j], sh):
                j += 1
            yield i + 1, lines[i:j], j
            i = j
        else:
            i += 1


def check(lines, before, sh):
    whole_code, whole_strings = code_of(lines, sh)
    file_names, file_values = names_in(whole_code, whole_strings)
    in_strings = " ".join(whole_strings)
    for first, block, end in blocks(lines, sh):
        text = "\n".join(block)
        if before is not None and text in before:
            continue
        after_code, after_strings = code_of(lines[end:end + 12], sh)
        near_names, near_values = names_in(after_code, after_strings)
        near = {n for n in near_names | near_values if n.lower() not in STOP and len(n) > 1}
        marked_seen, foreign_seen = set(), set()
        for offset, raw in enumerate(block):
            line_no = first + offset
            prose = strip_marker(raw)
            marked = re.findall(r"`([^`]+)`", prose)
            plain = re.sub(r"`[^`]+`", " ", prose)
            plain = re.sub(r"\b\w+#\d+\b", " ", plain)
            plain = PATH.sub(" ", plain)
            for word in re.findall(IDENT, plain):
                if word in near and word not in marked_seen:
                    marked_seen.add(word)
                    h(line_no, "code-mark", f"mark `{word}` in backticks if the sentence means the code name")
            refs = marked + re.findall(r"--[a-z][\w-]*|" + IDENT + r"(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?", plain)
            for ref in refs:
                ref = ref.strip()
                if not (SHAPED.fullmatch(ref) or ref in marked) or PATH.fullmatch(ref) or " " in ref:
                    continue
                core = re.split(r"[\s({=:]", ref.lstrip("{").strip())[0].rstrip("()").strip(".")
                if not core or core in file_names or core in file_values:
                    continue
                if all(part in file_names for part in core.split(".")):
                    continue
                # A flag or a word the file handles inside a string is its own.
                if re.search(r"(?<![\w-])" + re.escape(core) + r"(?![\w-])", in_strings):
                    continue
                if ref in foreign_seen:
                    continue
                foreign_seen.add(ref)
                h(line_no, "call-site", f"{ref} is not in this file's code: state this file's contract, or move what the other code does to its call site")


if __name__ == "__main__":
    path, NAME = sys.argv[1], sys.argv[2]
    before = open(sys.argv[3]).read() if len(sys.argv) > 3 and sys.argv[3] else None
    first = open(path).readline()
    sh = NAME.endswith((".sh", ".bash", ".py")) or (first.startswith("#!") and re.search(r"\b(ba)?sh\b|python", first) is not None)
    check(open(path).read().split("\n"), before, sh)
