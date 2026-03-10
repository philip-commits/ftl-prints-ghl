# CLAUDE.md

This repo contains Claude Code skills and a hosted TypeScript dashboard for Fort Lauderdale Screen Printing (FTL Prints) operations.

## Structure

Each skill lives in `.claude/skills/` with its own folder and `SKILL.md` file:

```
.claude/skills/<skill-name>/
  SKILL.md    — The skill definition (YAML frontmatter + markdown)
```

The hosted dashboard lives in `dashboard/` (deployed to Vercel, triggered by GitHub Actions cron).

## Available Skills

- `.claude/skills/ghl-activity/` — Daily CRM activity summary (messages, notes, tasks, stage changes)
