// ============================================================
// L2L — Sandbox-aware launcher
// `electron .` needs the SUID chrome-sandbox helper on Linux;
// when the system isn't configured for it, we fall back to
// --no-sandbox so the app still opens with a single command.
//
//   node scripts/launch.js            → opens the app
//   node scripts/launch.js <script>   → runs a script in Electron
// ============================================================

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const electronPath = require("electron"); // resolves to the electron binary path

// app path defaults to "." (the project = our Electron app)
const args = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["."];

if (process.platform === "linux") {
  const sandboxPath = path.join(path.dirname(electronPath), "chrome-sandbox");
  let needsNoSandbox = true;
  try {
    const st = fs.statSync(sandboxPath);
    const isSetuid = (st.mode & 0o4000) !== 0;
    const isRootOwned = st.uid === 0;
    needsNoSandbox = !isSetuid || !isRootOwned;
  } catch {
    /* sandbox helper missing */
  }
  if (needsNoSandbox) {
    args.unshift("--no-sandbox");
  }
}

const child = spawn(electronPath, args, { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("Failed to launch Electron:", err.message);
  process.exit(1);
});
