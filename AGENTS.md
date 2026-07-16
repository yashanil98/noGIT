# AGENTS.md

Instructions for AI coding agents working in a workspace that uses noGIT.

## What noGIT is

noGIT is a local snapshot system. It copies files into `.nogit/snapshots/` so you can roll back. It is NOT git. It has no branches, no remotes, no staging area. Think of it as an undo button.

## When to use it

- **Before any bulk operation:** checkpoint first. If you are about to rewrite multiple files, run a migration, or do anything risky, call `nogit_checkpoint` with a descriptive label.
- **After making changes you want to verify:** call `nogit_diff_summary` to see what you changed since the last checkpoint.
- **When something goes wrong:** call `nogit_restore_checkpoint_exact` to roll the workspace back to exactly the last checkpoint, including deleting files you added.
- **To inspect old code:** call `nogit_read_file` to view a previous version without restoring it.

## Available MCP tools

If the `nogit-mcp` server is registered, you have these tools:

| Tool | Use when... |
| --- | --- |
| `nogit_checkpoint(label)` | You are about to make risky changes |
| `nogit_diff_summary()` | You want to review what changed |
| `nogit_diff(path)` | You want to see exact changes to one file |
| `nogit_restore_checkpoint_exact()` | Something went wrong and you want to roll back completely |
| `nogit_undo()` | You restored but want to undo the restore |
| `nogit_read_file(path)` | You need to look at old code without changing anything |
| `nogit_status()` | You want to know the workspace state |

All tools accept checkpoint labels instead of timestamps. Omit the timestamp argument to default to the latest checkpoint.

## Rules

- Do NOT modify anything inside `.nogit/`. It is the snapshot store.
- Do NOT delete `.nogit/`. The user's history lives there.
- Do NOT commit `.nogit/` to git. It is already gitignored.
- Checkpoint BEFORE risky operations, not after.
- If you are unsure whether a restore is safe, call `nogit_diff_summary` first to understand what will change.
