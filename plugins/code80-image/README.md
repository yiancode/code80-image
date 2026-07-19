# Code80 Image

Code80 Image is a local MCP App for creating, editing, and organizing images
through Code80 or the current Codex Agent. Configuration, queue state, reference
paths, and generated files remain on the user's computer.

## Install in Codex

```bash
codex plugin marketplace add yiancode/code80-image
codex plugin add code80-image@code80-image
```

Open a new Codex task after installation so the MCP server and skill are loaded.

## What it does

- Creates persistent batches containing 1–50 independent image jobs.
- Calls Code80's OpenAI Images-compatible endpoints for GPT Image models.
- Uses Code80's JSON image contract for Grok generation and edits.
- Stores a separate API key for every Code80 group, using macOS Keychain when
  available.
- Supports a keyless `Codex 生成` option that hands jobs to the current Agent.
- Adds jobs to existing batches and rebuilds failed jobs without hiding history.
- Modifies completed images in place and preserves numbered local versions.
- Provides task, library, provider settings, preview, retry, cancel, copy, export,
  merge, and deletion controls.

## Code80 model configuration

Create one group for every Code80 platform group whose API key or available model
set differs. Each local group has its own endpoint, credential, concurrency limit,
and model list. The initial catalog includes:

- `gpt-image-2`
- `grok-imagine`
- `grok-imagine-image-quality`
- `grok-imagine-image`
- `grok-imagine-edit`

The connection test reads `/v1/models`. Generation uses
`/v1/images/generations`; edits use `/v1/images/edits`.

## Development

```bash
cd plugins/code80-image
npm install
npm run check
```

Code80 Image is licensed under MIT. Bundled open-source dependency notices are
generated into `THIRD_PARTY_NOTICES.md` with `npm run notices`.
