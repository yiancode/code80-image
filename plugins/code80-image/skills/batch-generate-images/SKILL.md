---
name: batch-generate-images
description: Operate Code80 Image whenever the user asks to create, batch, edit, retry, inspect, or organize images with Code80 GPT/Grok models or Codex generation.
---

# Code80 Image operator

Use the Code80 Image MCP tools as the source of truth for local image jobs.

## Start and model selection

1. Open the workbench with `open_code80_image` when it is not already visible.
2. Omit `offeringId` to use the user's configured default. Never silently choose
   a different model.
3. Call `list_image_offerings` only when the user asks to see or override models.
4. If no default exists, open the settings tab and tell the user to configure one.

## New work

- For a new independent request, call `create_image_batch` once.
- Put every distinct prompt into its own `jobs[]` item. Do not collapse different
  prompts into a shared summary.
- Use `count` for multiple variations of one text-only prompt.
- For folder work, call `inspect_image_folder` first when understanding filenames
  or visual contents matters.
- Pass existing results through `referenceImages` using their real `batchId` and
  `imageId`; do not invent a path from a display label.
- Supply a stable `requestKey` so retries do not create duplicate charged work.

## Existing batches

- Add work with `append_image_jobs`; do not create a replacement batch.
- Rebuild a terminal task by setting `sourceJobId` on the appended job.
- Modify exact images with `modify_selected_images`. The plugin keeps the prior
  output as a numbered version in the same batch.
- Use `list_image_batches` if the user refers to an earlier image and its batch ID
  is not present in the current context.
- Delete or merge only when the user explicitly requests that destructive action.

## Codex generation

When the selected offering uses `agent`:

1. Read each queued job returned by the batch tool.
2. Call `start_agent_image_job` before generating it.
3. Use the exact returned prompt and all returned reference paths.
4. Generate using the current Agent's available image capability.
5. Call `complete_agent_image_job` with the real local result path, or
   `fail_agent_image_job` with the actual error.

Do not leave an Agent job running after the generation attempt ends.

## Privacy

Tell the user when local reference images will be sent to Code80. API keys remain
in local secure storage and must never be copied into prompts or chat messages.
