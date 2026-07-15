import { describe, expect, it } from "vitest";
import { buildFileUrl, parsePullRequestUrl } from "../../src/domain/pull-request";
import { pullRequest } from "../fixtures";

describe("pull request URLs", () => {
  it("extracts repository coordinates", () => {
    expect(parsePullRequestUrl(pullRequest.url)).toEqual({ owner: "acme", name: "widgets", number: 42 });
  });

  it("rejects non-GitHub and non-PR URLs", () => {
    expect(() => parsePullRequestUrl("https://example.com/acme/widgets/pull/42")).toThrow();
    expect(() => parsePullRequestUrl("https://github.com/acme/widgets/issues/42")).toThrow();
  });

  it("builds an encoded full-file URL at the reviewed SHA", () => {
    expect(buildFileUrl(pullRequest, "src/a file.ts")).toBe(
      "https://github.com/acme/widgets/blob/head-sha/src/a%20file.ts",
    );
  });
});
