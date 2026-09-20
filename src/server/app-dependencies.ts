import { createHash } from "node:crypto";
import { sqlite } from "./db/index.js";
import { RegistryRepository } from "./db/repository.js";
import { AgentRuntimeManager } from "./runtime/agent-runtime-manager.js";

export type AccessRole = "admin" | "user" | "guest";

export type AuthAccount = {
  username: string;
  passwordDigest: string;
  role: AccessRole;
};

export type AuthConfig = {
  accounts: AuthAccount[];
  sessionTtlMs: number;
  cookieName: string;
  secureCookie: boolean;
};

export function credentialDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function envAccount(
  usernameKey: string,
  passwordKey: string,
  role: AccessRole,
): AuthAccount | undefined {
  const username = process.env[usernameKey]?.trim();
  const password = process.env[passwordKey];
  if (!username || !password) return undefined;
  return { username, passwordDigest: credentialDigest(password), role };
}

function sessionTtlMs(): number {
  const configured = Number(process.env.OAC_SESSION_TTL_MS ?? 8 * 60 * 60 * 1000);
  if (!Number.isFinite(configured)) return 8 * 60 * 60 * 1000;
  return Math.min(Math.max(Math.trunc(configured), 5 * 60 * 1000), 30 * 24 * 60 * 60 * 1000);
}

export type AppDependencies = {
  repository?: RegistryRepository;
  runtime?: AgentRuntimeManager;
  sqlite?: typeof sqlite;
  role?: AccessRole;
  auth?: AuthConfig;
};

export function resolveAppDependencies(options: AppDependencies = {}) {
  const repository = options.repository ?? new RegistryRepository();
  const configuredRole = process.env.OAC_ROLE;
  const role = options.role ?? (
    configuredRole === "guest" || configuredRole === "user"
      ? configuredRole
      : "admin"
  );
  const auth = options.auth ?? {
    accounts: [
      envAccount("OAC_ADMIN_USERNAME", "OAC_ADMIN_PASSWORD", "admin"),
      envAccount("OAC_USER_USERNAME", "OAC_USER_PASSWORD", "user"),
      envAccount("OAC_GUEST_USERNAME", "OAC_GUEST_PASSWORD", "guest"),
    ].filter((account): account is AuthAccount => Boolean(account)),
    sessionTtlMs: sessionTtlMs(),
    cookieName: process.env.OAC_AUTH_COOKIE_NAME?.trim() || "oac_session",
    secureCookie: process.env.OAC_AUTH_COOKIE_SECURE === "true",
  } satisfies AuthConfig;
  return {
    repository,
    runtime: options.runtime ?? new AgentRuntimeManager({ database: repository.database, repository }),
    sqlite: options.sqlite ?? sqlite,
    role,
    auth,
  };
}
