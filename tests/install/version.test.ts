import { describe, expect, it } from "vitest";
import { compareVersions } from "../../src/install/version";

describe("compareVersions", () => {
  it("compares numeric semantic versions", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("0.7.0", "0.7.0")).toBe(0);
    expect(compareVersions("0.7.0", "0.7.1")).toBe(-1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });

  it("rejects non-numeric versions", () => {
    expect(() => compareVersions("v0.7.0", "0.7.0")).toThrow(/Unsupported version: v0.7.0/);
    expect(() => compareVersions("0.7", "0.7.0")).toThrow(/Unsupported version: 0.7/);
  });
});
