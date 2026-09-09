import { describe, it, expect } from "vitest";
import { PAGE_HEIGHT, PAGE_WIDTH, MARGIN, createPaginatedCanvas } from "./pdfDoc";

describe("createPaginatedCanvas", () => {
  it("starts with exactly one page, sized Letter portrait by default", async () => {
    const canvas = await createPaginatedCanvas();

    expect(canvas.doc.getPageCount()).toBe(1);
    expect(canvas.page.getWidth()).toBe(PAGE_WIDTH);
    expect(canvas.page.getHeight()).toBe(PAGE_HEIGHT);
  });

  it("sizes pages Letter landscape (dimensions swapped) when landscape: true", async () => {
    const canvas = await createPaginatedCanvas({ landscape: true });

    expect(canvas.page.getWidth()).toBe(PAGE_HEIGHT);
    expect(canvas.page.getHeight()).toBe(PAGE_WIDTH);
  });

  it("ensureSpace returns the same y and adds no page when enough room remains", async () => {
    const canvas = await createPaginatedCanvas();

    const y = canvas.ensureSpace(400, 20);

    expect(y).toBe(400);
    expect(canvas.doc.getPageCount()).toBe(1);
  });

  it("ensureSpace starts a new page and returns a top-of-page y when the needed height doesn't fit", async () => {
    const canvas = await createPaginatedCanvas();

    // Close to the bottom margin: a 20pt block should not fit.
    const y = canvas.ensureSpace(MARGIN + 5, 20);

    expect(canvas.doc.getPageCount()).toBe(2);
    expect(y).toBe(PAGE_HEIGHT - MARGIN);
  });

  it("updates canvas.page to the new page after a break, so text/hr draw to it", async () => {
    const canvas = await createPaginatedCanvas();
    const firstPage = canvas.page;

    canvas.ensureSpace(MARGIN, 50);

    expect(canvas.page).not.toBe(firstPage);
  });

  it("calls onNewPage with the fresh canvas and starting y on every page break, including none on the first page", async () => {
    const calls: number[] = [];
    const canvas = await createPaginatedCanvas({
      onNewPage: (_canvas, startY) => calls.push(startY),
    });

    expect(calls).toHaveLength(0);

    canvas.ensureSpace(MARGIN, 50);
    canvas.ensureSpace(MARGIN, 50);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(PAGE_HEIGHT - MARGIN);
  });

  it("respects a custom bottomMargin when deciding whether content fits", async () => {
    const canvas = await createPaginatedCanvas({ bottomMargin: 200 });

    // 210 - 20 = 190, above the default MARGIN threshold but below this custom one.
    const y = canvas.ensureSpace(210, 20);

    expect(canvas.doc.getPageCount()).toBe(2);
    expect(y).not.toBe(210);
  });

  it("does not throw when text/hr are called across a page break", async () => {
    const canvas = await createPaginatedCanvas();
    canvas.text("first page", MARGIN, 400);
    canvas.ensureSpace(MARGIN, 50);
    expect(() => canvas.text("second page", MARGIN, 400)).not.toThrow();
    expect(() => canvas.hr(400)).not.toThrow();
  });
});
