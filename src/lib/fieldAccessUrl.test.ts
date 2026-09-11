import { describe, expect, test } from "vitest";
import { classifyFieldUrl, fieldUrlVerdict } from "@/lib/fieldAccessUrl";

describe("classifyFieldUrl", () => {
  test("http localhost is localhost, not private LAN", () => {
    expect(classifyFieldUrl("http://localhost:3000/field")).toEqual({
      isLocalhost: true,
      isPrivateLan: false,
    });
  });

  test("127.0.0.1 counts as localhost", () => {
    expect(classifyFieldUrl("http://127.0.0.1:3000/field").isLocalhost).toBe(true);
  });

  test("a public hostname is neither localhost nor private LAN", () => {
    expect(classifyFieldUrl("https://app.acme.com/field")).toEqual({
      isLocalhost: false,
      isPrivateLan: false,
    });
  });

  test("scheme match is case-insensitive for localhost detection", () => {
    expect(classifyFieldUrl("HTTP://LOCALHOST:3000/field").isLocalhost).toBe(true);
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
  test("localhost is never reachable from a phone", () => {
    expect(fieldUrlVerdict("http://localhost:3000/field")).toBe("localhost");
    expect(fieldUrlVerdict("https://localhost:3000/field")).toBe("localhost");
  });

  // The whole point of WiFi-only sync: a plain-http LAN address is CORRECT and
  // must not raise any kind of insecure-transport warning.
  test("LAN address is correct", () => {
    expect(fieldUrlVerdict("http://192.168.1.20:3000/field")).toBe("ok-lan");
    expect(fieldUrlVerdict("http://officepc.local:3000/field")).toBe("ok-lan");
  });

  test("a public https hostname cannot reach the field module", () => {
    expect(fieldUrlVerdict("https://app.acme.com/field")).toBe("not-lan");
  });

  test("a public plain-http hostname cannot reach the field module", () => {
    expect(fieldUrlVerdict("http://app.acme.com/field")).toBe("not-lan");
  });

  test("any other non-LAN, non-localhost address is not-lan", () => {
    expect(fieldUrlVerdict("http://169.254.10.1:3000/field")).toBe("not-lan");
  });
});
