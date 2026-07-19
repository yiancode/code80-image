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
