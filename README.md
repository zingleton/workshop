# workshop plugin

A Claude Code plugin that bundles skills and commands for the **personal AI assistant workshop**. It is built up by composing content from other skill and plugin repositories.

## Structure

```
.claude-plugin/
  plugin.json        # plugin manifest (name, version, author)
  marketplace.json   # optional — present if this repo also acts as a marketplace
commands/            # slash commands (one .md per command)
skills/              # skills (each in its own subdirectory with SKILL.md)
agents/              # subagent definitions
hooks/               # hook scripts
```

## Install

From a Claude Code project:

```bash
claude plugin marketplace add zingleton/workshop --scope project
claude plugin install workshop@workshop --scope project
```

## Bundled content & attribution

This plugin composes content from other open-source plugins. Upstream licenses are preserved under [`LICENSES/`](LICENSES/).

| Content | Source | License |
| --- | --- | --- |
| `commands/email.md`, `commands/summary.md`, `skills/email-triage/` | [ericporres/email-triage-plugin](https://github.com/ericporres/email-triage-plugin) | MIT |
