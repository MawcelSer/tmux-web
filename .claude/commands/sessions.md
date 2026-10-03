# Sessions

Manage Claude Code session history — list, load, alias, and inspect sessions.

## Actions

### List Sessions
```
/sessions list
/sessions list --limit 10
/sessions list --date 2026-02-01
```

### Load Session
```
/sessions load <id|alias>
```

### Create Alias
```
/sessions alias <id> <name>
```

### Remove Alias
```
/sessions alias --remove <name>
```

### Session Info
```
/sessions info <id|alias>
```

### List Aliases
```
/sessions aliases
```

## Arguments

$ARGUMENTS:
- `list [options]` — List sessions (`--limit`, `--date`, `--search`)
- `load <id|alias>` — Load session content
- `alias <id> <name>` — Create alias
- `alias --remove <name>` — Remove alias
- `info <id|alias>` — Show session statistics
- `aliases` — List all aliases
- `help` — Show help

## Notes

- Sessions are stored in `~/.claude/sessions/`
- Aliases are stored in `~/.claude/session-aliases.json`
- Session IDs can be shortened (first 4-8 characters)
