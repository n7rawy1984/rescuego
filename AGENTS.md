<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:pre-task-verification-rule -->
# MANDATORY: Pre-Task Verification Rule

Before starting ANY fix, feature, or roadmap task — you MUST first verify whether the work has already been done:

1. **Check the actual code/files** — read the relevant source files to see if the fix/feature already exists.
2. **Check SESSION_LOG.md** — see if it was documented as completed in a previous session.
3. **Check git log** — run `git log --oneline -20` to see recent commits that may have addressed it.

If the task is already done:
- Review the existing implementation for correctness and best practices.
- If it needs improvement (outdated pattern, missing edge case, better approach available) — fix it.
- If it's already correct — skip it silently and move to the next task.
- Do NOT re-implement from scratch or overwrite working code unnecessarily.

If partially done:
- Complete the missing parts.
- Review the existing parts for quality — improve if needed.

This rule applies to ALL work: audit fixes, roadmap phases, SEO tasks, Arabic translation tasks, and any other modifications.

**Reason:** Multiple sessions may work on the same codebase. Work may have been completed but not documented in the audit reports. Always verify before acting.
<!-- END:pre-task-verification-rule -->
