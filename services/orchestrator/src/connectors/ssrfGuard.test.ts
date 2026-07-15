import { describe, expect, it } from "vitest";
import type { LookupOptions } from "node:dns";
import {
  isBlockedIp,
  assertPublicHost,
  pinningLookup,
  readResponseTextLimited,
  validatePathComponent,
} from "./ssrfGuard.js";

describe("readResponseTextLimited", () => {
  it("cancels a response stream as soon as the byte limit is crossed", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8).fill(65));
        controller.enqueue(new Uint8Array(8).fill(66));
      },
      cancel() {
        canceled = true;
      },
    });
    const result = await readResponseTextLimited(
      new Response(body) as unknown as Parameters<typeof readResponseTextLimited>[0],
      10,
    );
    expect(result).toEqual({ text: "AAAAAAAABB", truncated: true });
    expect(canceled).toBe(true);
  });
});

function pinnedLookup(options: LookupOptions): Promise<{ address: unknown; family?: number }> {
  return new Promise((resolve, reject) => {
    pinningLookup("8.8.8.8", options, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });
}

describe("pinningLookup", () => {
  it("returns every vetted address when Node requests all for family auto-selection", async () => {
    await expect(pinnedLookup({ all: true })).resolves.toEqual({
      address: [{ address: "8.8.8.8", family: 4 }],
      family: undefined,
    });
  });

  it("retains the legacy single-address callback shape when all is false", async () => {
    await expect(pinnedLookup({ family: 4 })).resolves.toEqual({
      address: "8.8.8.8",
      family: 4,
    });
  });
});

describe("isBlockedIp — IPv4", () => {
  it("blocks loopback / private / link-local / metadata / CGNAT", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.5", // fleet bridge
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "140.82.112.3"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });
});

describe("isBlockedIp — IPv6 (the C-2 regression)", () => {
  it("blocks IPv4-mapped loopback/metadata/fleet-bridge in BOTH dotted and hex-compressed form", () => {
    for (const ip of [
      "::ffff:127.0.0.1",
      "::ffff:7f00:1", // hex form Node's URL parser produces — the original bypass
      "::ffff:169.254.169.254",
      "::ffff:a9fe:a9fe",
      "::ffff:172.16.0.5",
      "::ffff:ac10:5",
      "::ffff:10.0.0.1",
      "::ffff:192.168.1.1",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("blocks loopback, unspecified, and IPv4-compatible loopback", () => {
    for (const ip of ["::1", "::", "::127.0.0.1", "::7f00:1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("blocks the full fe80::/10 link-local and fec0::/10 site-local ranges", () => {
    for (const ip of ["fe80::1", "fe90::1", "fea0::1", "feb0::1", "fec0::1", "fefe::1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("blocks unique-local (fc/fd) and multicast (ff)", () => {
    for (const ip of ["fc00::1", "fd12:3456::1", "ff02::1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("blocks NAT64 and 6to4 wrapping an internal v4", () => {
    expect(isBlockedIp("64:ff9b::7f00:1"), "NAT64 loopback").toBe(true);
    expect(isBlockedIp("64:ff9b::a9fe:a9fe"), "NAT64 metadata").toBe(true);
    expect(isBlockedIp("2002:7f00:1::1"), "6to4 loopback").toBe(true);
    expect(isBlockedIp("2002:a9fe:a9fe::1"), "6to4 metadata").toBe(true);
  });

  it("allows genuinely public IPv6 (and v4-mapped public)", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::8.8.8.8"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });
});

describe("assertPublicHost — URL-normalized IPv6 literals", () => {
  it("rejects a bracketed IPv4-mapped loopback after URL normalization", async () => {
    // new URL('http://[::ffff:127.0.0.1]/').hostname === '[::ffff:7f00:1]'
    const host = new URL("http://[::ffff:127.0.0.1]/").hostname;
    await expect(assertPublicHost(host)).rejects.toThrow();
  });

  it("rejects bracketed loopback and metadata", async () => {
    await expect(assertPublicHost("[::1]")).rejects.toThrow();
    await expect(assertPublicHost("[::ffff:169.254.169.254]")).rejects.toThrow();
  });
});

describe("validatePathComponent", () => {
  it("accepts safe owner/repo segments", () => {
    expect(validatePathComponent("anthropics", "owner")).toBe("anthropics");
    expect(validatePathComponent("claude-code.v2", "repo")).toBe("claude-code.v2");
  });

  it("rejects traversal / separators / dot segments", () => {
    for (const bad of ["..", ".", "a/b", "a..b/..", "owner repo", "a%2f", ""]) {
      expect(() => validatePathComponent(bad)).toThrow();
    }
  });
});
