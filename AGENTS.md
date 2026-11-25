# Rules for AI Agent Contributions

Agents write code, tests, commit messages, issues, pull request descriptions, and reviews themselves. Their contributions should be traceable without a signature on every post.

1. **Commits:** End each commit that implements changes written by an agent with `Generated-by: <tool name>`, for example `Generated-by: Claude Code`. Do not use `Co-authored-by` for AI tools. Review-only work does not need a commit trailer.
2. **Pull requests:** State the actual roles once in the PR description, for example `Implementation: Claude Code · Review: GPT agent`. If the review has not happened yet, write `Review: pending`.
3. **Issues and comments:** An identifiable bot account is enough. If the author account does not identify the agent, name it once in the post. Each comment should add a finding, a decision, or a new result rather than just announce activity.
4. **No promotion:** Do not add “Powered by” or “Generated with” footers, use product links as signatures, or put vendor names in titles unless they are relevant to the task.
5. **Human approval:** Agents may implement and review changes, but a human decides whether to merge the PR. Record a human review only if it actually took place.
6. **Existing history:** These rules apply going forward. Leave old commit messages unchanged. If an earlier contribution is missing important attribution, add it to the relevant PR or issue instead.
7. **Models and roles:** This file is the single source of truth for which agent does what. Implementation and planning run on Claude Code with Claude Opus at high effort. Reviews come from a separate GPT agent at high effort, which posts its reviews with the marker `<!-- reviewed-sha: <sha> -->` and may push fix commits. Prompts of scheduled tasks and other documents refer to this rule instead of repeating it.
