import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

// Preview only the public landing-page assets, never the repository itself.
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/robots.txt", ["robots.txt", "text/plain; charset=utf-8"]],
  ["/images/kevin-mel-grand-central.jpg", ["images/kevin-mel-grand-central.jpg", "image/jpeg"]],
]);

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url, "http://127.0.0.1").pathname;
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  const asset = assets.get(pathname);
  if (!asset) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  try {
    const [filename, contentType] = asset;
    const bytes = await readFile(new URL(`../coming-soon/${filename}`, import.meta.url));
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": bytes.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Landing-page asset could not be read.");
  }
});

server.on("error", (error) => {
  console.error(`Local preview could not start: ${error.code ?? "unknown error"}`);
  process.exitCode = 1;
});

server.listen(5185, "127.0.0.1", () => {
  console.log("Coming-soon preview: http://127.0.0.1:5185/ (Ctrl+C to stop)");
});
