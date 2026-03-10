# CLAUDE.md

This repo contains Claude Code skills and a hosted TypeScript dashboard for Fort Lauderdale Screen Printing (FTL Prints) operations.

## Structure

Each skill lives in `.claude/skills/` with its own folder and `SKILL.md` file:

```
.claude/skills/<skill-name>/
  SKILL.md    — The skill definition (YAML frontmatter + markdown)
```

The hosted dashboard lives in `dashboard/` (deployed to Vercel, triggered by GitHub Actions cron).

## Recommendation Prompt (`dashboard/src/lib/claude/recommendations.ts`)

The system prompt in this file drives all lead recommendations in the cron job. Follow these rules when modifying it:

1. **Decision hierarchy is numbered 1-10, first match wins.** New rules go into the correct position in the hierarchy — don't append to the end or add a separate section. Higher number = lower priority.
2. **Never add conflicting instructions.** If a new rule contradicts an existing one, update the existing rule instead of adding a second one. Search for related keywords before writing.
3. **Keep it concise.** The prompt should stay under ~150 lines. If it's growing, consolidate — don't just keep adding sections.
4. **No duplicate guidance.** Each concept should appear in exactly one place. If "move to Cooled Off" is mentioned, it should be in one rule, not three.
5. **Test after changes.** Push and trigger the pipeline (`gh workflow run pipeline.yml`) to verify the AI follows new rules. LLMs can ignore instructions that are ambiguous or buried — if a rule isn't being followed, make it more explicit and move it higher in the hierarchy.

## Available Skills

- `.claude/skills/ghl-activity/` — Daily CRM activity summary (messages, notes, tasks, stage changes)
