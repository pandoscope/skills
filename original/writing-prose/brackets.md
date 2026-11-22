# The bracket loop

The bracket loop finds what a reader lacks in a text, and answers it from the source.
Run it on a comment, a docstring, a doc section, a glossary entry or a rule list that describes code or a process, once `check.sh` passes.

1. **Bracket.** A fresh subagent gets the text alone, without the code, the conversation or your notes; it may get the project's glossary.
   It reads as someone who will act on the text.
   After each phrase it cannot resolve, it puts a question in brackets: `the [whose?] identity`, `published [to where?]`.
   It rewrites nothing.
   It ranks its brackets, and marks the ones without which it would act wrongly.
   When you cannot spawn a subagent, bracket the text yourself, sentence by sentence, and say so.
2. **Answer.** Answer each bracket from the code or the source the text describes, and cite the place.
   A bracket the source cannot answer goes to the principal as a question.
   A term the glossary defines needs a link, not an answer.
3. **Rewrite.** Rewrite each bracketed sentence so the answer stands in it, with the name the code uses.
   Answer every bracket in a sentence before you rewrite it: a sentence fixed for one bracket and sent out with a second one open comes back.
   Check each new claim against the source.
4. **Budget.** A text has a length its place allows.
   When the answers push it past that, keep the answers to the higher-ranked brackets and cut from the bottom.
5. **Literal pass.** Read the result once for what a bracketing reader repairs without noticing:
   a sentence without a subject or a verb, a sentence that parses two ways, a pronoun with two candidates, an "if" hidden in a relative clause or a label, and a verb whose actor cannot do it.

## What is not a finding

- A figure of speech the author chose, such as a term's own picture, is not a defect. Ask about it; do not fix it.
- A phrase that most readers bracket and the principal does not is a term the project knows: propose a glossary entry, and leave the text.
- The same bracket from the same reader five times is one bracket.

## When the principal brackets

The principal's brackets, rewrites and review questions are the skill's evidence.
Answer them as in steps 2 and 3, then record the text as it was, the principal's words verbatim and the approved text where the project keeps such records.
Propose the approved pair for `examples/`.
A shape for one kind of text becomes a rule once four approved texts of that kind share it; until then it stays an example.
