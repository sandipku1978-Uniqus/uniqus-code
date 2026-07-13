const FIRECRACKER_MODES = new Set(["firecracker", "fc"]);

export function configuredSandboxMode(): string {
  return (process.env.UNIQUS_SANDBOX ?? "").trim().toLowerCase();
}
export function firecrackerModeConfigured(): boolean {
  return FIRECRACKER_MODES.has(configuredSandboxMode());
}

/** Host execution is an explicit local-development escape hatch, never a fallback. */
export function hostSandboxExplicitlyAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.UNIQUS_ALLOW_HOST_SANDBOX === "1";
}

export function assertSandboxModeConfigured(): void {
  const mode = configuredSandboxMode();
  if (FIRECRACKER_MODES.has(mode)) return;
  if (!mode && hostSandboxExplicitlyAllowed()) return;
  if (mode) {
    throw new Error(
      `Unsupported UNIQUS_SANDBOX='${mode}'. Use 'firecracker', or set UNIQUS_ALLOW_HOST_SANDBOX=1 for local development only.`,
    );
  }
  throw new Error(
    "UNIQUS_SANDBOX must be set to 'firecracker'. Local host execution requires the explicit UNIQUS_ALLOW_HOST_SANDBOX=1 development override.",
  );
}

export function assertHostSandboxAllowed(): void {
  if (!hostSandboxExplicitlyAllowed()) {
    throw new Error(
      "Refusing to execute a sandbox command on the orchestrator host. Configure Firecracker, or explicitly opt into local development with UNIQUS_ALLOW_HOST_SANDBOX=1.",
    );
  }
}
