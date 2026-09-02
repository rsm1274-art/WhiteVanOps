import { describe, expect, test } from "vitest";
import { classifyFieldUrl, fieldUrlVerdict } from "@/lib/fieldAccessUrl";

describe("classifyFieldUrl", () => {
  test("https tunnel URL is https, not localhost, not plain http", () => {
    expect(classifyFieldUrl("https://acme.whitevanops.com/field")).toEqual({
      isLocalhost: false,
      isPlainHttp: false,
      isHttps: true,
      isPrivateLan: false,
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
      isPrivateLan: false,
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
      isPrivateLan: false,
    });
  });

  test("scheme match is case-insensitive", () => {
    expect(classifyFieldUrl("HTTPS://acme.whitevanops.com/field").isHttps).toBe(true);
  });
});

describe("isPrivateLan", () => {
  test.each([
    "http://192.168.1.20:3000/field",
    "http://10.4.1.7:3000/field",
    "http://172.16.0.9:3000/field",
    "http://172.31.255.254:3000/field",
    "http://officepc.local:3000/field",
  ])("%s is private LAN", (url) => {
    expect(classifyFieldUrl(url).isPrivateLan).toBe(true);
  });

  // 172.15 and 172.32 sit just outside 172.16/12. A naive /^172\./ check would
  // wrongly treat public addresses in those ranges as the office LAN.
  test.each([
    "http://172.15.0.1:3000/field",
    "http://172.32.0.1:3000/field",
    "http://169.254.10.1:3000/field",
    "https://app.acme.com/field",
    "http://localhost:3000/field",
  ])("%s is not private LAN", (url) => {
    expect(classifyFieldUrl(url).isPrivateLan).toBe(false);
  });
});

describe("fieldUrlVerdict", () => {
  test("localhost is unusable on both plans", () => {
    expect(fieldUrlVerdict("http://localhost:3000/field", false)).toBe("localhost");
    expect(fieldUrlVerdict("http://localhost:3000/field", true)).toBe("localhost");
  });

  // The whole point of the Base plan: a plain-http LAN address is CORRECT and
  // must not raise the "credentials travel unencrypted" warning.
  test("LAN address is correct on both plans", () => {
    expect(fieldUrlVerdict("http://192.168.1.20:3000/field", false)).toBe("ok-lan");
    expect(fieldUrlVerdict("http://192.168.1.20:3000/field", true)).toBe("ok-lan");
  });

  test("public https is a tunnel on Plus, needs Plus on Base", () => {
    expect(fieldUrlVerdict("https://app.acme.com/field", true)).toBe("ok-tunnel");
    expect(fieldUrlVerdict("https://app.acme.com/field", false)).toBe("remote-needs-plus");
  });

  test("public plain http warns about plaintext on Plus, needs Plus on Base", () => {
    expect(fieldUrlVerdict("http://app.acme.com/field", true)).toBe("public-plain-http");
    expect(fieldUrlVerdict("http://app.acme.com/field", false)).toBe("remote-needs-plus");
  });
});
