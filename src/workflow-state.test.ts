import { describe, expect, it } from "vitest";
import { canExport, canTranslate, isWorkflowBusy, recoverAfterCancel, restoreSourceReview } from "./workflow-state";

describe("workflow state", () => {
  it("only permits translation after source review and export after translation review", () => {
    expect(canTranslate("empty")).toBe(false);
    expect(canTranslate("review-source")).toBe(true);
    expect(canTranslate("review-translation")).toBe(false);
    expect(canExport("review-source")).toBe(false);
    expect(canExport("review-translation")).toBe(true);
  });

  it("keeps cancellation recoverable", () => {
    expect(isWorkflowBusy("importing")).toBe(true);
    expect(recoverAfterCancel("importing")).toBe("empty");
    expect(recoverAfterCancel("translating")).toBe("review-source");
    expect(recoverAfterCancel("exporting-pdf")).toBe("review-translation");
  });

  it("restores source review for a completed document after a development hot reload", () => {
    expect(restoreSourceReview("empty", true)).toBe("review-source");
    expect(restoreSourceReview("empty", false)).toBe("empty");
    expect(restoreSourceReview("review-translation", true)).toBe("review-translation");
  });
});
