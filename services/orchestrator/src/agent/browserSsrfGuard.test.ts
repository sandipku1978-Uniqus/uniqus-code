import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import net from "node:net";
import {
  assertBrowserRequestAllowed,
  resolveBrowserTarget,
  startBrowserSsrfProxy,
} from "./browserSsrfGuard.js";

describe("browser SSRF request guard", () => {
  it("checks every public request with the supplied DNS validator", async () => {
    const validate = vi.fn(async () => {});
    await assertBrowserRequestAllowed("https://cdn.example.com/app.js", undefined, validate);
    expect(validate).toHaveBeenCalledWith("cdn.example.com");
  });

  it("allows only the exact private preview origin capability", async () => {
    const rejectPrivate = vi.fn(async () => { throw new Error("private"); });
    await expect(assertBrowserRequestAllowed(
      "http://172.16.0.2:3000/app.js",
      "http://172.16.0.2:3000",
      rejectPrivate,
    )).resolves.toBeUndefined();
    await expect(assertBrowserRequestAllowed(
      "http://172.16.0.3:3000/app.js",
      "http://172.16.0.2:3000",
      rejectPrivate,
    )).rejects.toThrow("private");
  });

  it("blocks non-network protocols", async () => {
    await expect(assertBrowserRequestAllowed("file:///etc/passwd")).rejects.toThrow("blocked");
  });

  it("allows only the trusted preview host and port to resolve privately", async () => {
    await expect(resolveBrowserTarget("127.0.0.1", 4173)).rejects.toThrow(/blocked/);
    await expect(
      resolveBrowserTarget("127.0.0.1", 4173, "http://127.0.0.1:4173"),
    ).resolves.toMatchObject({ address: "127.0.0.1", family: 4, port: 4173 });
    await expect(
      resolveBrowserTarget("127.0.0.1", 4174, "http://127.0.0.1:4173"),
    ).rejects.toThrow(/blocked/);
  });

  it("forwards through the exact IP returned by the validated resolver", async () => {
    const upstream = http.createServer((req, res) => {
      expect(req.headers.host).toMatch(/^rebind\.example:/);
      res.end("pinned response");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("no port");

    const resolver = vi.fn(async (_hostname: string, port: number) => ({
      address: "127.0.0.1",
      family: 4,
      port,
    }));
    const proxy = await startBrowserSsrfProxy(undefined, resolver);
    const proxyUrl = new URL(proxy.url);
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.request({
          hostname: proxyUrl.hostname,
          port: Number(proxyUrl.port),
          path: `http://rebind.example:${upstreamAddress.port}/asset.js`,
          headers: { host: `rebind.example:${upstreamAddress.port}` },
        }, (res) => {
          let value = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { value += chunk; });
          res.on("end", () => resolve(value));
        });
        req.on("error", reject);
        req.end();
      });
      expect(body).toBe("pinned response");
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(resolver).toHaveBeenCalledWith("rebind.example", upstreamAddress.port);
    } finally {
      await proxy.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("pins HTTPS CONNECT tunnels to the resolver's literal IP", async () => {
    const upstream = net.createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("no port");
    const resolver = vi.fn(async (_hostname: string, port: number) => ({
      address: "127.0.0.1",
      family: 4,
      port,
    }));
    const proxy = await startBrowserSsrfProxy(undefined, resolver);
    const proxyUrl = new URL(proxy.url);
    const client = net.connect(Number(proxyUrl.port), proxyUrl.hostname);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("CONNECT proxy timed out")), 2_000);
        let buffer = "";
        let tunneled = false;
        client.on("connect", () => {
          client.write(
            `CONNECT secure.example:${upstreamAddress.port} HTTP/1.1\r\n` +
            `Host: secure.example:${upstreamAddress.port}\r\n\r\n`,
          );
        });
        client.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          if (!tunneled) {
            const end = buffer.indexOf("\r\n\r\n");
            if (end === -1) return;
            expect(buffer.slice(0, end)).toContain("200 Connection Established");
            buffer = buffer.slice(end + 4);
            tunneled = true;
            client.write("tunnel-ping");
          }
          if (tunneled && buffer.includes("tunnel-ping")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        client.on("error", reject);
      });
      expect(resolver).toHaveBeenCalledWith("secure.example", upstreamAddress.port);
    } finally {
      client.destroy();
      await proxy.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
