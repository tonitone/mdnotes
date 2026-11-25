# Rules for AI Agent Contributions

Agents write code, tests, commit messages, issues, pull request descriptions, and reviews themselves. Their contributions should be traceable without a signature on every post.

1. **Commits:** End each commit that implements changes written by an agent with `Generated-by: <tool name>`, for example `Generated-by: Claude Code`. Do not use `Co-authored-by` for AI tools. Review-only work does not need a commit trailer.
2. **Pull requests:** State the actual roles once in the PR description, for example `Implementation: Claude Code · Review: GPT agent`. If the review has not happened yet, write `Review: pending`.
3. **Issues and comments:** An identifiable bot account is enough. If the author account does not identify the agent, name it once in the post. Each comment should add a finding, a decision, or a new result rather than just announce activity.
4. **No promotion:** Do not add “Powered by” or “Generated with” footers, use product links as signatures, or put vendor names in titles unless they are relevant to the task.
5. **Merging:** The review agent merges a PR once CI is green and no finding is open. The implementing agent never merges its own PR. A human (the owner) decides and merges PRs that change workflows under `.github/`, the release configuration or this file, and every PR or issue labelled `needs-owner-decision`. Record a human review only if it actually took place.
6. **Existing history:** These rules apply going forward. Leave old commit messages unchanged. If an earlier contribution is missing important attribution, add it to the relevant PR or issue instead.
