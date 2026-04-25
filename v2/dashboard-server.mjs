import { createServer } from "http";
import { readFile } from "fs/promises";
import { dirname, extname, join, normalize } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

createServer(async (req, res) => {
  const parsedUrl = new URL(req.url || "/index.html", `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const requestPath = parsedUrl.pathname === "/" ? "/index.html" : parsedUrl.pathname;
  const safePath = normalize(join(__dirname, requestPath));

  if (!safePath.startsWith(__dirname)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(safePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(safePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
}).listen(PORT, HOST, () => {
  console.log(`QDII Dashboard v2 dev server: http://${HOST}:${PORT}`);
});
