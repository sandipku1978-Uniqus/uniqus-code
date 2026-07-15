import { mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFirecrackerNetworkConfig, PersistentNetworkAllocator } from "./networkConfig.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Firecracker network configuration", () => {
  it("derives every default address from one /16", () => {
    const config = parseFirecrackerNetworkConfig({});
    expect(config).toMatchObject({
      cidr: "172.16.0.0/16",
      prefix: 16,
      netmask: "255.255.0.0",
      gateway: "172.16.0.1",
      bootstrapIp: "172.16.255.254",
      projectAddressCount: 65_532,
    });
  });

  it("derives an alternate private /24", () => {
    const config = parseFirecrackerNetworkConfig({ FIRECRACKER_CIDR: "10.44.7.0/24" });
    expect(config).toMatchObject({
      cidr: "10.44.7.0/24",
      prefix: 24,
      netmask: "255.255.255.0",
      gateway: "10.44.7.1",
      bootstrapIp: "10.44.7.254",
      projectAddressCount: 252,
    });
  });

  it("rejects inconsistent legacy overrides and non-private networks", () => {
    expect(() => parseFirecrackerNetworkConfig({
      FIRECRACKER_CIDR: "10.44.7.0/24",
      FIRECRACKER_GATEWAY: "10.44.7.2",
    })).toThrow(/conflicts/);
    expect(() => parseFirecrackerNetworkConfig({ FIRECRACKER_CIDR: "203.0.113.0/24" }))
      .toThrow(/RFC1918/);
  });
});

describe("persistent Firecracker IPAM", () => {
  it("assigns unique addresses, survives restart, and releases stale ownership", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gate15-ipam-"));
    dirs.push(dir);
    const state = path.join(dir, "ipam.json");
    const config = parseFirecrackerNetworkConfig({ FIRECRACKER_CIDR: "192.168.90.0/29" });
    const ids = [
      "554be509-fad7-428b-8976-0c20de0bcf09",
      "e7ec957e-6ecf-4f2c-a774-0af77f52c89d",
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    const first = new PersistentNetworkAllocator(config, state);
    const addresses = ids.map((id) => first.allocate(id));
    expect(new Set(addresses).size).toBe(ids.length);
    expect(() => first.allocate("33333333-3333-4333-8333-333333333333"))
      .toThrow(/exhausted/);

    const restarted = new PersistentNetworkAllocator(config, state);
    expect(restarted.allocate(ids[0])).toBe(addresses[0]);
    restarted.release(ids[1]);
    expect(restarted.allocate("33333333-3333-4333-8333-333333333333"))
      .toMatch(/^192\.168\.90\./);
  });

  it("fails closed when another host allocator owns the lock", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gate15-ipam-"));
    dirs.push(dir);
    const state = path.join(dir, "ipam.json");
    mkdirSync(`${state}.lock`);
    const config = parseFirecrackerNetworkConfig({ FIRECRACKER_CIDR: "192.168.91.0/29" });
    const allocator = new PersistentNetworkAllocator(config, state);
    expect(() => allocator.allocate("11111111-1111-4111-8111-111111111111"))
      .toThrow(/ownership lock is busy/);
  });

  it("reclaims a stale allocator lock after a crashed process", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gate15-ipam-"));
    dirs.push(dir);
    const state = path.join(dir, "ipam.json");
    const lock = `${state}.lock`;
    mkdirSync(lock);
    const stale = new Date(Date.now() - 120_000);
    utimesSync(lock, stale, stale);
    const config = parseFirecrackerNetworkConfig({ FIRECRACKER_CIDR: "192.168.92.0/29" });
    const allocator = new PersistentNetworkAllocator(config, state);
    expect(allocator.allocate("11111111-1111-4111-8111-111111111111"))
      .toMatch(/^192\.168\.92\./);
  });
});
