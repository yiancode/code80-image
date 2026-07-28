# Code80 Image

[中文](README.md) | English

Code80 Image is an open-source Codex plugin for local batch image generation,
image editing, task recovery, and result management through Code80 GPT/Grok
image models or the current Codex Agent.

## Install

### Check that your codex CLI supports plugins

`codex plugin` only exists in recent CLI builds. Run this first:

```bash
codex plugin --help
```

If it prints `error: unexpected argument 'plugin' found`, your codex CLI is too
old — the npm package `@openai/codex` 0.116.0, for example, has no such command.
Do not use the `codex` on your PATH in that case. Use the one shipped with the
Codex desktop app instead; on macOS it is distributed inside ChatGPT.app and is
usually newer:

```bash
/Applications/ChatGPT.app/Contents/Resources/codex plugin --help
```

Substitute that full path for `codex` in the commands below.

### Install the plugin

```bash
codex plugin marketplace add yiancode/code80-image
codex plugin add code80-image@code80-image
codex plugin list
```

The install is only complete when `codex plugin list` shows `code80-image` as
enabled.

Create a new Codex task afterwards so the MCP server and skill are loaded into
the session. Open **Code80 Image settings** to add one local group for each
Code80 API key, then configure the GPT/Grok models available to that group. New
groups use `https://dev.code80.ai` by default; existing groups keep their
configured address until you change and save them.

### Do not copy the skill folder by hand

Copying `plugins/code80-image/skills/batch-generate-images/` into
`~/.codex/skills/` — whether by hand or by asking an Agent to "install the
skill" — produces an empty shell. The skill prompt loads and Code80 Image shows
up in Codex, but the MCP server declared in `.mcp.json` is never registered, so
`open_code80_image`, `create_image_batch`, and every other tool is missing.

The usual symptom is the model replying that the Code80 Image MCP tools are not
loaded in the current session and it cannot open the workbench.

If you already installed it that way, delete
`~/.codex/skills/batch-generate-images/` before reinstalling as a plugin.
Otherwise that fake entry point keeps misleading the model.

## Update

```bash
codex plugin marketplace upgrade code80-image
codex plugin remove code80-image@code80-image
codex plugin add code80-image@code80-image
```

Completely quit and reopen Codex after updating, then create a new task. This is
especially important on Windows because an existing task keeps the previous MCP
server process and cached plugin files.

If the workbench opens but reports `MCP error -32000: MCP proxy request failed`,
first update to the latest plugin version and restart Codex. The plugin retries
transient proxy startup requests for reads and idempotent settings updates; it
intentionally does not retry image creation or other write operations that could
create duplicate charges.

## Install with an Agent

If the `codex` CLI is installed and signed in on your computer, you can ask an
Agent to complete the installation and verify it for you.

### Codex

Paste this into a Codex task:

> Install the Code80 Image plugin from
> https://github.com/yiancode/code80-image. First run `codex plugin --help` to
> confirm the CLI supports plugin subcommands; if it does not, use
> `/Applications/ChatGPT.app/Contents/Resources/codex` instead. Then add the
> `yiancode/code80-image` marketplace, install `code80-image@code80-image`, and
> verify with `codex plugin list` that it is enabled. Do not change the plugin
> source, and do not copy the skills folder into `~/.codex/skills/`. When
> finished, remind me to create a new Codex task so the MCP server and skill are
> loaded.

### Claude Code

Paste this into Claude Code:

> Install Code80 Image for my local Codex app from
> https://github.com/yiancode/code80-image. This is a Codex plugin, not a
> Claude Code plugin. First check `codex --version` and `codex plugin --help`; if
> that reports `unexpected argument`, use
> `/Applications/ChatGPT.app/Contents/Resources/codex` instead. Then run
> `codex plugin marketplace add yiancode/code80-image`, then
> `codex plugin add code80-image@code80-image`. Verify the installation with
> `codex plugin list` and report the installed version and enabled status. Do not
> modify the repository, and do not fall back to copying the skills folder.

## Highlights

- Persistent batches with 1–50 independent image jobs.
- Code80 GPT Image generation and editing.
- Code80 Grok generation and editing.
- Separate credentials and model catalogs for each Code80 group.
- Parallel execution, retry, cancel, task recovery, preview, copy, export,
  merge, and deletion workflows.
- Local storage for settings, queues, references, and generated images.
- macOS Keychain storage for API keys on macOS.

## Development

```bash
cd plugins/code80-image
npm install
npm run check
```

The plugin source and its compiled MCP App are under
[`plugins/code80-image`](plugins/code80-image).

## License

MIT. Dependency notices are available in
[`THIRD_PARTY_NOTICES.md`](plugins/code80-image/THIRD_PARTY_NOTICES.md).
