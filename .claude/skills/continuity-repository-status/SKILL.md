---
name: continuity-repository-status
description: Report bounded read-only local Git repository identity and status.
allowed-tools: Bash(git:*)
---

# Repository Status

Use only the explicitly supplied repository working directory.

1. Resolve the local Git repository root and HEAD object identity.
2. Report the current branch or detached-head state.
3. Report the configured upstream and ahead/behind counts only when locally resolvable.
4. Report clean or dirty status with sorted staged, unstaged, and untracked path names.
5. Return the exact package and procedure identity and a structured success or typed failure.

This procedure is read-only. It must not write repository content or Git state,
select or complete development activity, contact a network service, infer
meaning from repository content, or expand beyond local Git metadata.
