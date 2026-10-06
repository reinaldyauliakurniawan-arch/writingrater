import { describe, expect, it } from "vitest";
import { formatDate, resultCopyText } from "../format";
import type { CriterionView } from "../types";

describe("format", () => {
  it("Salin hasil persis template 8.3", () => {
    const criteria: CriterionView[] = [
      { key: "task", name: "Task Achievement", band: 5, feedback: "FB1", tip: "TIP1" },
      { key: "cc", name: "Coherence & Cohesion", band: 6, feedback: "FB2", tip: null },
      { key: "lr", name: "Lexical Resource", band: 6, feedback: "FB3", tip: null },
      { key: "gra", name: "Grammatical Range & Accuracy", band: 5, feedback: "FB4", tip: null },
    ];
    expect(resultCopyText(criteria, 5.5)).toBe(
      [
        "Task Achievement",
        "5.0",
        "FB1",
        "TIP1",
        "",
        "Coherence & Cohesion",
        "6.0",
        "FB2",
        "",
        "Lexical Resource",
        "6.0",
        "FB3",
        "",
        "Grammatical Range & Accuracy",
        "5.0",
        "FB4",
        "",
        "Overall: 5.5",
      ].join("\n"),
    );
  });

  it("tanggal id-ID zona Asia/Jakarta", () => {
    expect(formatDate("2026-10-06T07:30:00Z")).toBe("6 Okt 2026 14.30");
  });
});
