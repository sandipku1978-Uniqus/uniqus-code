import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface FirecrackerNetworkConfig {
  cidr: string;
  network: number;
  broadcast: number;
  prefix: number;
  netmask: string;
  gateway: string;
  bootstrapIp: string;
  firstProjectAddress: number;
  projectAddressCount: number;
}

function ipv4ToInt(value: string): number {
  const parts = value.split(".");
  if (parts.length !== 4) throw new Error(`invalid IPv4 address: ${value}`);
  let out = 0;
  for (const raw of parts) {
    if (!/^\d{1,3}$/.test(raw)) throw new Error(`invalid IPv4 address: ${value}`);
    const octet = Number(raw);
    if (octet < 0 || octet > 255) throw new Error(`invalid IPv4 address: ${value}`);
    out = ((out << 8) | octet) >>> 0;
  }
  return out >>> 0;
}

function intToIpv4(value: number): string {
  const n = value >>> 0;
  return `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

function prefixMask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
}

function assertPrivate(network: number, broadcast: number): void {
  const inRange = (start: string, end: string): boolean =>
    network >= ipv4ToInt(start) && broadcast <= ipv4ToInt(end);
  if (
    !inRange("10.0.0.0", "10.255.255.255") &&
    !inRange("172.16.0.0", "172.31.255.255") &&
    !inRange("192.168.0.0", "192.168.255.255")
  ) {
    throw new Error("FIRECRACKER_CIDR must be wholly contained in an RFC1918 private range");
  }
}

/** Parse the one canonical subnet and reject contradictory legacy overrides. */
export function parseFirecrackerNetworkConfig(
  env: NodeJS.ProcessEnv = process.env,
): FirecrackerNetworkConfig {
  const raw = env.FIRECRACKER_CIDR ?? "172.16.0.0/16";
  const [ipRaw, prefixRaw, extra] = raw.split("/");
  const prefix = Number(prefixRaw);
  if (extra !== undefined || !Number.isInteger(prefix) || prefix < 8 || prefix > 29) {
    throw new Error(`invalid FIRECRACKER_CIDR ${raw}; prefix must be between /8 and /29`);
  }
  const supplied = ipv4ToInt(ipRaw);
  const mask = prefixMask(prefix);
  const network = (supplied & mask) >>> 0;
  if (supplied !== network) {
    throw new Error(`FIRECRACKER_CIDR must use its network address (expected ${intToIpv4(network)}/${prefix})`);
  }
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  assertPrivate(network, broadcast);

  const cidr = `${intToIpv4(network)}/${prefix}`;
  const gateway = intToIpv4(network + 1);
  const bootstrapIp = intToIpv4(broadcast - 1);
  const netmask = intToIpv4(mask);
  // network, gateway, bootstrap, and broadcast are reserved.
  const firstProjectAddress = network + 2;
  const projectAddressCount = broadcast - network - 3;
  if (projectAddressCount < 2) throw new Error(`${cidr} has too few addresses for tenant VMs`);

  const expected: Array<[string, string | undefined, string]> = [
    ["FIRECRACKER_SUBNET", env.FIRECRACKER_SUBNET, cidr],
    ["FIRECRACKER_BRIDGE_CIDR", env.FIRECRACKER_BRIDGE_CIDR, `${gateway}/${prefix}`],
    ["FIRECRACKER_GATEWAY", env.FIRECRACKER_GATEWAY, gateway],
    ["FIRECRACKER_NETMASK", env.FIRECRACKER_NETMASK, netmask],
    ["FIRECRACKER_BOOTSTRAP_IP", env.FIRECRACKER_BOOTSTRAP_IP, bootstrapIp],
  ];
  for (const [name, actual, wanted] of expected) {
    if (actual !== undefined && actual !== wanted) {
      throw new Error(`${name}=${actual} conflicts with FIRECRACKER_CIDR; expected ${wanted}`);
    }
  }
  return { cidr, network, broadcast, prefix, netmask, gateway, bootstrapIp, firstProjectAddress, projectAddressCount };
}

interface IpamFile {
  version: 1;
  cidr: string;
  allocations: Record<string, string>;
}

/**
 * Small persistent per-host IPAM. The hash is only the first candidate;
 * collisions are linearly probed and the chosen address survives restarts.
 */
export class PersistentNetworkAllocator {
  private allocations = new Map<string, string>();
  private owners = new Map<string, string>();

  constructor(
    private readonly config: FirecrackerNetworkConfig,
    private readonly statePath: string,
  ) {}

  allocate(projectId: string): string {
    return this.withLock(() => {
      this.loadFresh();
      const retained = this.allocations.get(projectId);
      if (retained) return retained;

      const h = createHash("sha256").update(projectId).digest();
      const start = h.readUInt32BE(0) % this.config.projectAddressCount;
      for (let probe = 0; probe < this.config.projectAddressCount; probe += 1) {
        const offset = (start + probe) % this.config.projectAddressCount;
        const ip = intToIpv4(this.config.firstProjectAddress + offset);
        if (!this.owners.has(ip)) {
          this.allocations.set(projectId, ip);
          this.owners.set(ip, projectId);
          this.persist();
          return ip;
        }
      }
      throw new Error(`Firecracker IPAM exhausted for ${this.config.cidr}`);
    });
  }

  /** Release only after the project and all snapshots have been permanently deleted. */
  release(projectId: string): void {
    this.withLock(() => {
      this.loadFresh();
      const ip = this.allocations.get(projectId);
      if (!ip) return;
      this.allocations.delete(projectId);
      this.owners.delete(ip);
      this.persist();
    });
  }

  private loadFresh(): void {
    this.allocations.clear();
    this.owners.clear();
    let parsed: IpamFile | null = null;
    try {
      parsed = JSON.parse(readFileSync(this.statePath, "utf8")) as IpamFile;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw new Error(`could not read Firecracker IPAM ${this.statePath}`, { cause: error });
    }
    if (!parsed) return;
    if (parsed.version !== 1 || parsed.cidr !== this.config.cidr || !parsed.allocations) {
      throw new Error(`Firecracker IPAM ${this.statePath} does not match configured CIDR ${this.config.cidr}`);
    }
    for (const [projectId, ip] of Object.entries(parsed.allocations)) {
      const addr = ipv4ToInt(ip);
      const usable = addr >= this.config.firstProjectAddress &&
        addr < this.config.firstProjectAddress + this.config.projectAddressCount;
      if (!usable || this.owners.has(ip)) {
        throw new Error(`Firecracker IPAM contains invalid or duplicate address ${ip}`);
      }
      this.allocations.set(projectId, ip);
      this.owners.set(ip, projectId);
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.statePath), { recursive: true, mode: 0o700 });
    const temp = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    const body: IpamFile = {
      version: 1,
      cidr: this.config.cidr,
      allocations: Object.fromEntries(this.allocations),
    };
    writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.statePath);
  }

  /** Atomic host-local lock; a live competing allocator makes boot fail closed. */
  private withLock<T>(operation: () => T): T {
    const lockPath = `${this.statePath}.lock`;
    mkdirSync(path.dirname(this.statePath), { recursive: true, mode: 0o700 });
    let acquired = false;
    for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
      try {
        mkdirSync(lockPath, { mode: 0o700 });
        acquired = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let stale = false;
        try {
          stale = Date.now() - statSync(lockPath).mtimeMs > 60_000;
        } catch {
          continue;
        }
        if (stale) rmSync(lockPath, { recursive: true, force: true });
      }
    }
    if (!acquired) {
      throw new Error(`Firecracker IPAM ownership lock is busy: ${lockPath}`);
    }
    try {
      return operation();
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
    }
  }
}
