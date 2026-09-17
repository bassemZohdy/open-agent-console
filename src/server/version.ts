import { readFileSync } from "node:fs";

type PackageManifest = { version?: string };

let version = "0.0.0";
try {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as PackageManifest;
  if (manifest.version) version = manifest.version;
} catch {
  // Keep a safe fallback for unusual embedded runtimes.
}

export const appVersion = version;
