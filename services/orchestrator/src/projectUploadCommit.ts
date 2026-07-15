export type UploadCommitStage = "host" | "vm" | "storage";

export interface ProjectUploadOperations {
  writeHost(): Promise<void>;
  writeVm?: () => Promise<void>;
  syncStorage(): Promise<void>;
  removeHost(): Promise<void>;
  removeVm?: () => Promise<void>;
  removeStorage(): Promise<void>;
}

export type ProjectUploadCommitResult =
  | { ok: true }
  | {
      ok: false;
      failedStage: UploadCommitStage;
      error: string;
      rollbackComplete: boolean;
      rollbackErrors: string[];
    };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Commit one new, randomly named upload and remove every attempted copy when a
 * later stage fails. Cleanup is attempted even when a write itself throws,
 * because filesystem and remote writes can fail after producing partial data.
 */
export async function commitProjectUpload(
  operations: ProjectUploadOperations,
): Promise<ProjectUploadCommitResult> {
  let stage: UploadCommitStage = "host";
  let hostAttempted = false;
  let vmAttempted = false;
  let storageAttempted = false;

  try {
    hostAttempted = true;
    await operations.writeHost();

    if (operations.writeVm) {
      stage = "vm";
      vmAttempted = true;
      await operations.writeVm();
    }

    stage = "storage";
    storageAttempted = true;
    await operations.syncStorage();
    return { ok: true };
  } catch (error) {
    const rollbackErrors: string[] = [];
    const rollback = async (name: string, action: (() => Promise<void>) | undefined) => {
      if (!action) return;
      try {
        await action();
      } catch (rollbackError) {
        rollbackErrors.push(`${name}: ${errorMessage(rollbackError)}`);
      }
    };

    if (storageAttempted) await rollback("storage", operations.removeStorage);
    if (vmAttempted) await rollback("vm", operations.removeVm);
    if (hostAttempted) await rollback("host", operations.removeHost);

    return {
      ok: false,
      failedStage: stage,
      error: errorMessage(error),
      rollbackComplete: rollbackErrors.length === 0,
      rollbackErrors,
    };
  }
}
