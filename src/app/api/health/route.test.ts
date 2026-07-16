import { describe, expect, test } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  test("identifies the app so the Electron shell can distinguish it from a foreign server on the same port", async () => {
    // Arrange / Act
    const res = await GET();
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.app).toBe("whitevanops");
    expect(body.ok).toBe(true);
  });
});
