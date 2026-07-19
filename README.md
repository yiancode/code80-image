# Code80 Image

Code80 Image is an open-source Codex plugin for local batch image generation,
image editing, task recovery, and result management through Code80 GPT/Grok
image models or the current Codex Agent.

## Install

```bash
codex plugin marketplace add yiancode/code80-image
codex plugin add code80-image@code80-image
```

Create a new Codex task after installation. Open **Code80 Image settings** to
add one local group for each Code80 API key, then configure the GPT/Grok models
available to that group.

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
> https://github.com/yiancode/code80-image. Use the Codex CLI to add the
> `yiancode/code80-image` marketplace, install
> `code80-image@code80-image`, and verify that the plugin is enabled. Do not
> change the plugin source. When finished, remind me to create a new Codex task
> so the MCP server and skill are loaded.

### Claude Code

Paste this into Claude Code:

> Install Code80 Image for my local Codex app from
> https://github.com/yiancode/code80-image. This is a Codex plugin, not a
> Claude Code plugin. In the terminal, run
> `codex plugin marketplace add yiancode/code80-image`, then
> `codex plugin add code80-image@code80-image`. Verify the installation with
> `codex plugin list` and report the installed version and enabled status. Do
> not modify the repository.

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
