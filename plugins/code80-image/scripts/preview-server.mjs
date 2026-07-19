import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const port = Number(process.env.CODE80_IMAGE_PREVIEW_PORT || 4173);
const file = path.join(process.cwd(), "web", "preview.html");
const server = createServer(async (_request, response) => {
  try {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(await readFile(file));
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Code80 Image preview: http://127.0.0.1:${port}`));
