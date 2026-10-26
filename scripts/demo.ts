import { spawn } from "node:child_process";
import { cp, mkdir, open, readFile, rm } from "node:fs/promises";
import { watch } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const persist = resolve(root, ".wrangler/demo");
export const config = resolve(root, "wrangler.local.json");
const cli = resolve(root, "node_modules/wrangler/bin/wrangler.js");
// Keep logs local, disable telemetry and dotenv loading, and never use remote bindings.
export const localEnv = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: resolve(root, ".wrangler/logs"),
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
};
export function wrangler(
  args: string[],
  stdio: "inherit" | "pipe" = "inherit",
) {
  return spawn(process.execPath, [cli, ...args, "--config", config], {
    cwd: root,
    env: localEnv,
    stdio,
  });
}
async function command(args: string[]) {
  const child = wrangler(args, "pipe");
  let output = "";
  const collect = (data: Buffer) => {
    output = (output + data).slice(-16000);
  };
  child.stdout!.on("data", collect);
  child.stderr!.on("data", collect);
  const [code] = await once(child, "exit");
  if (code !== 0)
    throw new Error(`Wrangler ${args[0]} failed (${code}):\n${output}`);
  console.log("Local database migrations applied.");
}
export async function withDemoLock<T>(path: string, task: () => Promise<T>) {
  await mkdir(resolve(root, ".wrangler"), { recursive: true });
  const lockPath = `${path}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const pid = Number(await readFile(lockPath, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Error(`Demo lock is invalid: ${lockPath}`);
    try {
      process.kill(pid, 0);
      throw new Error(
        "Demo server or setup is running. Stop it before resetting or starting another demo.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    await rm(lockPath);
    lock = await open(lockPath, "wx");
  }
  try {
    await lock.writeFile(String(process.pid));
    return await task();
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
export async function prepareDemo(path = persist) {
  await rm(resolve(root, ".wrangler/demo-assets"), {
    recursive: true,
    force: true,
  });
  await mkdir(resolve(root, ".wrangler/demo-assets"), { recursive: true });
  await cp(resolve(root, "public"), resolve(root, ".wrangler/demo-assets"), {
    recursive: true,
  });
  await command([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    path,
  ]);
  Object.assign(process.env, {
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: localEnv.WRANGLER_LOG_PATH,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  });
  const { getPlatformProxy } = await import("wrangler");
  const { seedDemo } = await import("../demo/seed");
  const proxy = await getPlatformProxy<import("../src/core").Env>({
    configPath: config,
    persist: { path: resolve(path, "v3") },
    remoteBindings: false,
    envFiles: [],
  });
  try {
    console.log(
      (await seedDemo(proxy.env))
        ? "Demo fixture loaded."
        : "Demo edits preserved (fixture already loaded).",
    );
  } finally {
    await proxy.dispose();
  }
}
export async function resetDemo() {
  await withDemoLock(persist, async () => {
    await rm(persist, { recursive: true, force: true });
    await prepareDemo();
  });
}
async function dev() {
  await withDemoLock(persist, async () => {
    await prepareDemo();
    const child = wrangler([
      "dev",
      "--local",
      "--persist-to",
      persist,
      "--ip",
      "127.0.0.1",
      "--port",
      "8787",
    ]);
    let copying = Promise.resolve();
    const watcher = watch(resolve(root, "public"), { recursive: true }, () => {
      copying = copying
        .then(async () => {
          await rm(resolve(root, ".wrangler/demo-assets"), {
            recursive: true,
            force: true,
          });
          await cp(
            resolve(root, "public"),
            resolve(root, ".wrangler/demo-assets"),
            { recursive: true },
          );
        })
        .catch((error) => console.error("Asset copy failed:", error));
    });
    let stopping = false;
    const stop = () => {
      stopping = true;
      child.kill("SIGTERM");
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    console.log("Demo scenarios: http://127.0.0.1:8787/__demo");
    try {
      const [code, signal] = await once(child, "exit");
      if (code && !signal && !stopping)
        throw new Error(`Demo server exited (${code})`);
    } finally {
      watcher.close();
      await copying;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv[2] === "reset") await resetDemo();
    else if (!process.argv[2]) await dev();
    else throw new Error("Usage: node --import tsx scripts/demo.ts [reset]");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
