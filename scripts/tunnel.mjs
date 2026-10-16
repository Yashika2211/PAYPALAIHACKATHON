// Self-healing local webhook tunnel: starts a Cloudflare quick tunnel to the dev
// server, points the PayPal sandbox webhook at it, and restarts + re-registers
// whenever the tunnel is lost (quick tunnels die on sleep or network changes).
// Usage: pnpm tunnel [port]   (requires `cloudflared`)
import { execFile, spawn } from "node:child_process";

const port = process.argv[2] ?? "3000";
let child = null;
let current = null;

function register(url) {
  execFile("pnpm", ["-s", "exec", "tsx", "--env-file-if-exists=.env", "scripts/register-webhook.ts", url], (err, stdout, stderr) => {
    if (err) console.error(`[tunnel] webhook registration failed: ${stderr || err.message}`);
    else console.log(`[tunnel] ${stdout.trim().split("\n")[0]}`);
  });
}

function start() {
  current = null;
  child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  const onData = (buf) => {
    const text = buf.toString();
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0];
    if (url && url !== current) {
      current = url;
      console.log(`[tunnel] ${url} → localhost:${port}`);
      // Give Cloudflare a moment to route the new hostname before PayPal is told about it.
      setTimeout(() => register(url), 4000);
    }
    if (/Tunnel not found|failed to connect to the edge/i.test(text)) {
      console.warn("[tunnel] lost, restarting");
      child.kill();
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", () => setTimeout(start, 2000));
}

// Health probe: if the public URL stops answering, recycle the tunnel.
setInterval(async () => {
  if (!current) return;
  try {
    const res = await fetch(`${current}/api/health`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    console.warn("[tunnel] health check failed, restarting");
    child?.kill();
  }
}, 60_000);

process.on("SIGINT", () => {
  child?.removeAllListeners("exit");
  child?.kill();
  process.exit(0);
});

start();
