// A script compiled into an app of its own, so that macOS grants (which belong to the app that
// asks) land on it and the permission dialog carries its name. Used by scripts/permission-probe.ts
// scripts/hook-probe.ts and scripts/example-app.ts. On Windows and Linux the "app" is a plain executable in dist/.
//
// A bundle is built once and reused, so its identity, and with it its grants, survive between
// runs; it is rebuilt when its sources (the script, src/, build/) are newer than it, or on
// --rebuild. An ad-hoc signature changes with the binary, so a rebuilt app's grant record is
// stale, and macOS neither honors it nor asks again while it exists: the rebuild resets it, and
// the next run asks afresh.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

export const mac = process.platform === "darwin";

export const root = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
export const dist = join(root, "dist");

export type TestApp = {
  name: string;
  bundleId: string;
  app: string; // the .app on macOS, the executable elsewhere
  binary: string;
};

// Compiles <entry> (a path under the package root) into dist/sweetview-<short>(.app) with bundle
// id dev.n1h.sweetview.<short>, unless an up-to-date one is there already.
export async function buildTestApp(
  short: string,
  entry: string,
  rebuild = false,
): Promise<TestApp> {
  const name = `sweetview-${short}`;
  const bundleId = `dev.n1h.sweetview.${short}`;
  const app = mac ? join(dist, `${name}.app`) : join(dist, name);
  const binary = mac
    ? join(app, "Contents", "MacOS", name)
    : join(dist, name + (process.platform === "win32" ? ".exe" : ""));
  const source = join(root, entry);

  const stale =
    existsSync(binary) &&
    newestMtime([source, join(root, "src"), join(root, "build")]) >
      statSync(binary).mtimeMs;
  if (stale && !rebuild)
    console.log(`${name} is older than its sources: rebuilding it`);
  if ((rebuild || stale) && existsSync(mac ? app : binary))
    rmSync(mac ? app : binary, { recursive: true, force: true });

  if (!existsSync(binary)) {
    mkdirSync(join(binary, ".."), { recursive: true });
    console.log(`compiling ${name}...`);
    await $`bun build --compile ${source} --outfile ${binary}`
      .cwd(root)
      .quiet();
    if (mac) {
      writeFileSync(
        join(app, "Contents", "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundleDisplayName</key><string>${name}</string>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleExecutable</key><string>${name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`,
      );
      chmodSync(binary, 0o755);
      await $`codesign --sign - --force --deep ${app}`.quiet();
      console.log(`built ${app} (${bundleId})`);
      // The grant record of the previous binary is stale now: macOS neither honors it nor asks
      // again while it is there, so it goes, and the next run asks afresh.
      await resetGrants({ name, bundleId, app, binary });
    }
  }
  return { name, bundleId, app, binary };
}

// Wipes every grant the app holds (macOS), so that it asks again.
export async function resetGrants(app: TestApp) {
  if (!mac) return;
  console.log(`resetting every grant of ${app.bundleId}`);
  await $`tccutil reset All ${app.bundleId}`.nothrow().quiet();
}

// Runs the app with the arguments and waits for it to exit. On macOS it goes through `open`, so that
// the app, not this terminal, is the process macOS attributes the grants to; its stdout is lost,
// which is why the apps write a file instead.
export async function runTestApp(app: TestApp, args: string[]) {
  if (mac) await $`open -W -n ${app.app} --args ${args}`.nothrow().quiet();
  else await $`${app.binary} ${args}`.nothrow().quiet();
}

function newestMtime(paths: string[]): number {
  let newest = 0;
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const st = statSync(p);
    newest = Math.max(
      newest,
      st.isDirectory()
        ? newestMtime(readdirSync(p).map((f) => join(p, f)))
        : st.mtimeMs,
    );
  }
  return newest;
}
