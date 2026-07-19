import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { imageMetadata, scanFolder } from "../src/image-io.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAQAAABWKLW/AAAADElEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("folder inspection is deterministic and optionally recursive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "code80-images-"));
  try {
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "b.png"), png);
    await writeFile(path.join(root, "a.jpg"), png);
    await writeFile(path.join(root, "notes.txt"), "ignore");
    await writeFile(path.join(root, "nested", "c.webp"), png);
    assert.deepEqual((await scanFolder(root, false)).map((item) => item.name), ["a.jpg", "b.png"]);
    assert.equal((await scanFolder(root, true)).length, 3);
    const metadata = await imageMetadata(path.join(root, "b.png"));
    assert.deepEqual({ width: metadata.width, height: metadata.height }, { width: 2, height: 3 });
  } finally { await rm(root, { recursive: true, force: true }); }
});
