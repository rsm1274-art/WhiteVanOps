import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "./exportFilename";

describe("sanitizeFilename", () => {
  it("returns a normal name unchanged", () => {
    expect(sanitizeFilename("Monthly Job Summary")).toBe("Monthly Job Summary");
  });

  it("strips CRLF sequences to prevent Content-Disposition header injection", () => {
    expect(sanitizeFilename('report\r\nSet-Cookie: evil=1')).toBe("reportSet-Cookie: evil=1");
  });

  it("strips bare CR and LF characters", () => {
    expect(sanitizeFilename("a\rb\nc")).toBe("abc");
  });

  it("strips double quotes so the filename can't break out of the quoted header value", () => {
    expect(sanitizeFilename('evil"; filename="other')).toBe("evil; filename=other");
  });

  it("replaces path separators so the value can't be read as a path", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("..-..-etc-passwd");
  });

  it("falls back to 'report' when the sanitized result is empty", () => {
    expect(sanitizeFilename('"""')).toBe("report");
    expect(sanitizeFilename("   ")).toBe("report");
    expect(sanitizeFilename("")).toBe("report");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeFilename("  spaced out  ")).toBe("spaced out");
  });
});
