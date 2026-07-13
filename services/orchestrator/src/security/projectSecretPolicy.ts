/**
 * Values stored in project_secrets for deployment convenience but explicitly
 * designed to be embedded in generated clients. Keep this list narrow and tied
 * to first-party connector contracts; name prefixes such as NEXT_PUBLIC_ are
 * model-controlled and must never become an implicit disclosure policy.
 */
const MODEL_VISIBLE_PROJECT_CONFIG = new Set([
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
]);

export function isModelVisibleProjectConfig(name: string): boolean {
  return MODEL_VISIBLE_PROJECT_CONFIG.has(name.trim().toUpperCase());
}
