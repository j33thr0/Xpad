// Serves the X pad web app and signs fee claims after checking an X post.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { Wallet, getAddress, isAddress } from "ethers";
import { signClaim } from "./sign.js";

try { process.loadEnvFile(join(import.meta.dirname, ".env")); } catch {}
const WEB = join(import.meta.dirname, "web");
const PORT = Number(process.env.PORT || 3000);
const verifier = new Wallet(process.env.VERIFIER_KEY ?? (() => { throw new Error("VERIFIER_KEY missing: run a deploy script first"); })());
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

// Checks that `postUrl` is a public X post by `handle` whose text contains `wallet`.
async function checkPost(handle, postUrl, wallet) {
  const m = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,25})/.exec(postUrl);
  if (!m) throw new Error("Paste the link to your post, like https://x.com/you/status/123");
  // The handle in a post URL is ignored by X, so trust only the author oEmbed reports.
  const r = await fetch(`https://publish.x.com/oembed?omit_script=1&url=https://x.com/i/status/${m[1]}`, { signal: AbortSignal.timeout(10e3) });
  if (!r.ok) throw new Error("X could not find that post. Is it public?");
  const post = await r.json();
  const author = String(post.author_url ?? "").split("/").pop().toLowerCase();
  if (author !== handle) throw new Error(`That post is by @${author}, not @${handle}`);
  if (!String(post.html ?? "").toLowerCase().includes(wallet.toLowerCase())) throw new Error("Your wallet address is not in that post");
}

async function verify(body) {
  const { handle, postUrl, wallet } = body;
  if (typeof handle !== "string" || !/^[a-z0-9_]{1,15}$/.test(handle)) throw new Error("Bad handle");
  if (typeof wallet !== "string" || !isAddress(wallet)) throw new Error("Bad wallet address");
  if (typeof postUrl !== "string") throw new Error("Bad post link");
  await checkPost(handle, postUrl, wallet);
  const { chainId, xpad } = JSON.parse(await readFile(join(WEB, "config.json"), "utf8"));
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const sig = await signClaim(verifier, chainId, xpad, handle, getAddress(wallet), deadline);
  return { deadline, sig };
}

const send = (res, code, body, type = "application/json") =>
  res.writeHead(code, { "content-type": type }).end(Buffer.isBuffer(body) ? body : JSON.stringify(body));

// 10 post checks per IP per 10 minutes, so nobody can use the server to hammer X.
// Behind a proxy (Render, Caddy) every request comes from the proxy, so read the client IP from its headers.
// shortcut: X-Forwarded-For can be faked when no proxy cleans it; that only lets someone skip this limit.
const hits = new Map();
function limited(req) {
  const hd = req.headers;
  const ip = String(hd["cf-connecting-ip"] ?? hd["true-client-ip"] ?? hd["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) return hits.set(ip, { n: 1, reset: now + 600e3 }), false;
  return ++h.n > 10;
}
setInterval(() => { const now = Date.now(); for (const [ip, h] of hits) if (now > h.reset) hits.delete(ip); }, 600e3).unref();

createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/verify") {
      if (limited(req)) return send(res, 429, { error: "Too many tries. Wait 10 minutes and try again." });
      let raw = "";
      for await (const chunk of req) if ((raw += chunk).length > 4096) throw new Error("Request too big");
      return send(res, 200, await verify(JSON.parse(raw)));
    }
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    const file = join(WEB, path || "index.html");
    if (!file.startsWith(WEB + sep)) return send(res, 403, { error: "Forbidden" });
    const ext = extname(file);
    const data = await readFile(file).catch(() => (ext ? null : readFile(join(WEB, "index.html")))); // page paths load the app
    if (!data) return send(res, 404, { error: "Not found" });
    send(res, 200, data, TYPES[ext] ?? TYPES[".html"]);
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}).listen(PORT, process.env.HOST || "127.0.0.1", () => console.log(`X pad on http://localhost:${PORT}`)); // only reachable through the proxy
