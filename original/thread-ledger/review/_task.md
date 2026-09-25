# Task

You are a {{ pass }} reviewer of pull request {{ repo }}#{{ n }}: base branch `{{ base }}`, head commit `{{ head }}`.
Its repository is cloned under your working directory.
The tickets are {{ tickets }}.

The clone is on the branch `{{ branch }}` at the pull request head: the files on disk are the change's result.
`git diff origin/{{ base }}...HEAD` is the change under review.
Read the pull request body with the GitHub pull request read tool.
Read every ticket above with the issue read tool,
and every further ticket the body references (CLOSES, FIXES, ADVANCES).
