export interface ProjectMutationLease {
  projectId: string;
  owner: string;
  release: () => void;
}

/**
 * One mutating execution lane per project. JavaScript's synchronous Map
 * check/set makes acquisition atomic within an orchestrator process; durable
 * task ownership is additionally protected by its database lease.
 */
export class ProjectMutationLanes {
  private readonly owners = new Map<string, string>();

  tryAcquire(projectId: string, owner: string): ProjectMutationLease | null {
    if (this.owners.has(projectId)) return null;
    this.owners.set(projectId, owner);
    let released = false;
    return {
      projectId,
      owner,
      release: () => {
        if (released) return;
        released = true;
        if (this.owners.get(projectId) === owner) this.owners.delete(projectId);
      },
    };
  }

  owner(projectId: string): string | null {
    return this.owners.get(projectId) ?? null;
  }
}
