/**
 * Files that may contain credentials are never exposed through project-file or
 * model-facing APIs. Matching is path based so the same rule protects HTTP,
 * WebSocket, @file references, and agent file tools.
 */
export function isSensitiveProjectPath(input: string): boolean {
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = normalized.split("/").filter(Boolean);
  const lower = parts.map((part) => part.toLowerCase());
  const base = lower.at(-1) ?? "";

  if (lower.includes(".ssh")) return true;
  if (lower.includes(".aws") && base === "credentials") return true;
  if (lower.includes(".config") && lower.includes("gcloud")) return true;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if ([".npmrc", ".pypirc", ".netrc", ".git-credentials"].includes(base)) return true;
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/.test(base)) return true;
  // Regex (rather than path.extname) also catches stem-less dotfiles such as
  // exactly `.pem` / `.key`, matching the sandbox-agent enforcement.
  if (/\.(?:key|pem|p12|pfx|crt|cer)$/.test(base)) return true;
  return false;
}
