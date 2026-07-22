import { describe, expect, test } from "vitest";
import { classifyFieldUrl } from "@/lib/fieldAccessUrl";

describe("classifyFieldUrl", () => {
  test("https tunnel URL is https, not localhost, not plain http", () => {
    expect(classifyFieldUrl("https://acme.whitevanops.com/field")).toEqual({
      isLocalhost: false,
      isPlainHttp: false,
      isHttps: true,
    });
  });

  test("client-owned https URL classifies as https", () => {
    expect(classifyFieldUrl("https://app.acmevans.com/field").isHttps).toBe(true);
  });

  test("http localhost is localhost, not plain-http-public", () => {
    expect(classifyFieldUrl("http://localhost:3000/field")).toEqual({
      isLocalhost: true,
      isPlainHttp: false,
      isHttps: false,
    });
  });

  test("127.0.0.1 counts as localhost", () => {
    expect(classifyFieldUrl("http://127.0.0.1:3000/field").isLocalhost).toBe(true);
  });

  test("public plain http is flagged as plain http, not https", () => {
    expect(classifyFieldUrl("http://acme.duckdns.org:3000/field")).toEqual({
      isLocalhost: false,
      isPlainHttp: true,
      isHttps: false,
    });
  });

  test("scheme match is case-insensitive", () => {
    expect(classifyFieldUrl("HTTPS://acme.whitevanops.com/field").isHttps).toBe(true);
  });
});
