// Opens a public HTTPS tunnel to the local server so Discord can load the
// Activity. Resolves the cloudflared binary from (in order):
//   1. $CLOUDFLARED env var
//   2. ~/cloudflared(.exe)         (the standalone binary we downloaded)
//   3. "cloudflared" on PATH
//
// Quick tunnels get a random *.trycloudflare.com URL each run (you must
// re-paste it into the Discord URL Mapping). For a STABLE URL see README
// ("Stable tunnel URL").
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const port = process.env.TUNNEL_PORT || 3001;

function resolveBin() {
  if (process.env.CLOUDFLARED) return process.env.CLOUDFLARED;
  for (const name of ["cloudflared.exe", "cloudflared"]) {
    const p = path.join(os.homedir(), name);
    if (fs.existsSync(p)) return p;
  }
  return "cloudflared"; // assume it's on PATH
}

const bin = resolveBin();
console.log(`[tunnel] using ${bin} -> http://localhost:${port}`);
const child = spawn(bin, ["tunnel", "--url", `http://localhost:${port}`], { stdio: "inherit" });
child.on("error", (e) => {
  console.error(`[tunnel] failed to start cloudflared: ${e.message}`);
  console.error("[tunnel] install it (winget install Cloudflare.cloudflared) or set CLOUDFLARED=/path/to/cloudflared");
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
