/**
 * VLM Labeling Daemon manager.
 *
 * Spawns the Python daemon as a child process and tracks its state via a PID
 * file + append-only log file — both in `process.cwd()` (apps/hub-web/ when
 * running `next dev`).  File-based state survives Next.js hot-reloads.
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const PID_FILE = path.join(process.cwd(), ".vlm-daemon.pid");
const LOG_FILE = path.join(process.cwd(), ".vlm-daemon.log");
const MAX_LOG_LINES = 500;

// Script is at <monorepo-root>/scripts/clip-label-local.py.
// process.cwd() = apps/hub-web when running next dev.
const SCRIPT_PATH = path.resolve(
  process.cwd(),
  "..",
  "..",
  "scripts",
  "clip-label-local.py",
);

// On Windows, Windows ssh.exe rejects WSL keys due to ACL permissions.
// Spawn the daemon through wsl.exe so it uses WSL's ssh (which respects Linux perms).
function getSpawnTarget(scriptPath: string): {
  cmd: string;
  scriptArg: string;
} {
  if (process.platform !== "win32") {
    return { cmd: "python3", scriptArg: scriptPath };
  }
  // Convert C:\foo\bar to /mnt/c/foo/bar for WSL
  const unixPath = scriptPath
    .replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`)
    .replace(/\\/g, "/");
  return { cmd: "wsl.exe", scriptArg: unixPath };
}

function appendLog(line: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  try {
    fs.appendFileSync(LOG_FILE, `[${ts}] ${line}\n`);
  } catch {
    // non-fatal
  }
}

export function isDaemonRunning(): boolean {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0); // throws ESRCH if process does not exist
    return true;
  } catch {
    return false;
  }
}

export function getDaemonPid(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    return pid || null;
  } catch {
    return null;
  }
}

export function startDaemon(libraryId: string): { pid: number } {
  if (isDaemonRunning()) {
    throw new Error("Daemon is already running");
  }

  // Clear / create log file
  fs.writeFileSync(
    LOG_FILE,
    `[${new Date().toISOString()}] Starting VLM daemon for library ${libraryId}\n`,
  );

  const { cmd, scriptArg } = getSpawnTarget(SCRIPT_PATH);
  // On Windows: wsl.exe python3 <unix-path> --daemon ...
  // On Linux/Mac: python3 <path> --daemon ...
  const spawnArgs =
    process.platform === "win32"
      ? [
          "python3",
          scriptArg,
          "--daemon",
          "--library-id",
          libraryId,
          "--poll-interval",
          "20",
        ]
      : [
          scriptArg,
          "--daemon",
          "--library-id",
          libraryId,
          "--poll-interval",
          "20",
        ];

  const proc = spawn(cmd, spawnArgs, {
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      PYTHONUNBUFFERED: "1",
    },
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (!proc.pid) {
    throw new Error("Failed to spawn Python process — is Python installed?");
  }

  proc.stdout?.on("data", (data: Buffer) => {
    data.toString().split("\n").filter(Boolean).forEach(appendLog);
  });
  proc.stderr?.on("data", (data: Buffer) => {
    data
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => appendLog(`[stderr] ${l}`));
  });
  proc.on("exit", (code) => {
    appendLog(`Process exited with code ${code}`);
    try {
      fs.unlinkSync(PID_FILE);
    } catch {}
  });
  proc.on("error", (err) => {
    appendLog(`[error] ${err.message}`);
    try {
      fs.unlinkSync(PID_FILE);
    } catch {}
  });

  fs.writeFileSync(PID_FILE, String(proc.pid));
  appendLog(`Spawned PID ${proc.pid}`);

  return { pid: proc.pid };
}

export function stopDaemon(): void {
  const pid = getDaemonPid();
  if (!pid) throw new Error("No daemon PID on file");
  try {
    process.kill(pid, "SIGTERM");
    appendLog(`Sent SIGTERM to PID ${pid}`);
  } catch {
    appendLog(`Process ${pid} already gone`);
  }
  try {
    fs.unlinkSync(PID_FILE);
  } catch {}
}

export function getDaemonLogs(lines = 60): string[] {
  try {
    const raw = fs.readFileSync(LOG_FILE, "utf8");
    const all = raw.split("\n").filter(Boolean);
    return all.slice(-lines);
  } catch {
    return [];
  }
}

export function getDaemonStatus(): {
  running: boolean;
  pid: number | null;
  logPath: string;
} {
  const running = isDaemonRunning();
  const pid = running ? getDaemonPid() : null;
  return { running, pid, logPath: LOG_FILE };
}
