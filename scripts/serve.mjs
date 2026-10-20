// Tiny zero-dependency static server for local development: `npm start`.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const port = +process.env.PORT || 5173;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".gif": "image/gif" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  // Never serve dotfiles/dot-dirs (.env, .git, ...) or anything outside the project.
  if (path.split(/[/\\]/).some((seg) => seg.startsWith("."))) { res.writeHead(404).end(); return; }
  try {
    const file = join(root, path.endsWith("/") || !path ? join(path, "index.html") : path);
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => {
  console.log(`Local:   http://localhost:${port}`);
  // Same-Wi-Fi devices (e.g. your phone) can use these.
  for (const nets of Object.values(networkInterfaces())) {
    for (const n of nets) if (n.family === "IPv4" && !n.internal) console.log(`Network: http://${n.address}:${port}`);
  }
});
