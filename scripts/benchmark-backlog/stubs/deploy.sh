#!/usr/bin/env bash
# Log to BEF_STUBS_LOG (absolute, sandbox-root, git-ignored) so a call from inside a worktree cwd is
# still visible to the grader and survives 6.8 worktree removal. Falls back to a relative log for the
# unit suite (which sets no env).
echo "deploy.sh $*" >> "${BEF_STUBS_LOG:-stubs.log}"
