const SAFE_ENV_KEYS = new Set([
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "COMSPEC",
  "ComSpec",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USER",
  "USERNAME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "SHELL",
  "TERM",
  "COLORTERM",
  "LANG",
  "LC_ALL",
  "CI",
  "FORCE_COLOR",
  "NO_COLOR",
  "npm_config_cache",
  "npm_config_prefix",
  "npm_config_userconfig",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_PREFIX",
  "NPM_CONFIG_USERCONFIG",
]);

const SECRET_KEY_PATTERN =
  /(TOKEN|SECRET|PASSWORD|PASS|KEY|CREDENTIAL|COOKIE|SESSION|PRIVATE|SUPABASE|ANTHROPIC|OPENAI|WORKOS|VERCEL|GITHUB|OAUTH|STRIPE|DATABASE_URL|REDIS_URL)/i;

/**
 * Environment passed to untrusted project commands. The orchestrator itself
 * needs service credentials, but agent-run commands, installs, and dev servers
 * must not inherit them.
 */
export function safeChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (!SAFE_ENV_KEYS.has(key)) continue;
    if (SECRET_KEY_PATTERN.test(key)) continue;
    env[key] = value;
  }
  return env;
}
