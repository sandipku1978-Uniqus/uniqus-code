import { describe, expect, it } from "vitest";
import { createPinnedPostgresLookup } from "./postgres.js";

describe("createPinnedPostgresLookup", () => {
  it("returns only the address validated before the PostgreSQL connection", async () => {
    const lookup = createPinnedPostgresLookup({ address: "203.0.113.42", family: 4 });
    const result = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookup("hostname-that-could-now-rebind.example", { all: false }, (err, address, family) => {
        if (err) reject(err);
        else resolve({ address: String(address), family: Number(family) });
      });
    });
    expect(result).toEqual({ address: "203.0.113.42", family: 4 });
  });

  it("preserves Node's all-address lookup shape without resolving again", async () => {
    const lookup = createPinnedPostgresLookup({ address: "2001:db8::42", family: 6 });
    const result = await new Promise<unknown>((resolve, reject) => {
      lookup("example.test", { all: true }, (err, addresses) => {
        if (err) reject(err);
        else resolve(addresses);
      });
    });
    expect(result).toEqual([{ address: "2001:db8::42", family: 6 }]);
  });
});
