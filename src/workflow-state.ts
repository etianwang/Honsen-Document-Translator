export type WorkflowPhase = "empty" | "importing" | "review-source" | "translating" | "review-translation" | "exporting-docx" | "exporting-pdf";

export const isWorkflowBusy = (phase: WorkflowPhase): boolean => ["importing", "translating", "exporting-docx", "exporting-pdf"].includes(phase);
export const canTranslate = (phase: WorkflowPhase): boolean => phase === "review-source";
export const canExport = (phase: WorkflowPhase): boolean => phase === "review-translation";
export const recoverAfterCancel = (phase: WorkflowPhase): WorkflowPhase => phase === "importing" ? "empty" : phase === "translating" ? "review-source" : "review-translation";
