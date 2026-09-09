import { describe, it, expect } from "vitest";
import { EDGES, ROOT, getEdge, manyEdgeKeys, resolvePath, pathCardinality } from "./graph";

describe("EDGES", () => {
  it("has a unique key per edge", () => {
    const keys = EDGES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("roots every edge chain in job, directly or transitively", () => {
    for (const edge of EDGES) {
      if (edge.from === ROOT) continue;
      const parent = EDGES.find((e) => e.to === edge.from);
      expect(parent, `edge "${edge.key}" has no parent reaching "${edge.from}"`).toBeDefined();
    }
  });
});

describe("getEdge", () => {
  it("finds an edge by key", () => {
    expect(getEdge("client")?.to).toBe("client");
  });

  it("returns undefined for an unknown key", () => {
    expect(getEdge("nope")).toBeUndefined();
  });
});

describe("manyEdgeKeys", () => {
  it("lists only many-cardinality edges", () => {
    const keys = manyEdgeKeys();
    expect(keys).toContain("lineItems");
    expect(keys).toContain("timeEntries");
    expect(keys).not.toContain("client");
    expect(keys).not.toContain("personnel"); // one hop relative to jobAssignment, not job
  });
});

describe("resolvePath", () => {
  it("resolves an empty path to the root", () => {
    expect(resolvePath([])).toBe("job");
  });

  it("resolves a single-hop path", () => {
    expect(resolvePath(["client"])).toBe("client");
  });

  it("resolves a two-hop path through a join edge", () => {
    expect(resolvePath(["assignments", "personnel"])).toBe("personnel");
  });

  it("returns undefined for an unknown edge key", () => {
    expect(resolvePath(["nope"])).toBeUndefined();
  });

  it("returns undefined when an edge's from-node does not match where the path currently is", () => {
    // "personnel" starts at jobAssignment, not job — invalid as a first hop.
    expect(resolvePath(["personnel"])).toBeUndefined();
  });
});

describe("pathCardinality", () => {
  it("is one for a field on the root itself", () => {
    expect(pathCardinality([])).toBe("one");
  });

  it("is one for a single one-edge hop", () => {
    expect(pathCardinality(["client"])).toBe("one");
  });

  it("is many when any edge on the path is many, even if the last hop is one", () => {
    expect(pathCardinality(["assignments", "personnel"])).toBe("many");
  });

  it("is many for a direct many edge", () => {
    expect(pathCardinality(["timeEntries"])).toBe("many");
  });
});
