import { describe, expect, it } from "vitest";
import { checkExtractedData, checkGradeOutput, ExtractedData, FactCheck, GradeOutput } from "../schemas";
import gradeFixture from "../__fixtures__/grade.json";
import factcheckFixture from "../__fixtures__/factcheck.json";
import extractFixture from "../__fixtures__/extract.json";

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

function grade(feedbackWords: number, tip: string | null = null) {
  const c = { evidence: ["quote"], band: 6, feedback: words(feedbackWords), tip };
  return GradeOutput.parse({
    language_check: "english",
    criteria: { task: c, cc: c, lr: c, gra: c },
    ceilings_triggered: [],
  });
}

describe("schemas (bagian 6)", () => {
  it("fixture mock lolos skema dan validasi tambahan", () => {
    const g = GradeOutput.parse(gradeFixture);
    expect(checkGradeOutput(g)).toBeNull();
    FactCheck.parse(factcheckFixture);
    expect(checkExtractedData(ExtractedData.parse(extractFixture))).toBeNull();
  });

  it("band di luar 0–9 atau pecahan ditolak", () => {
    const c = { evidence: ["q"], band: 6.5, feedback: "x", tip: null };
    expect(GradeOutput.safeParse({ language_check: "english", criteria: { task: c, cc: c, lr: c, gra: c }, ceilings_triggered: [] }).success).toBe(false);
  });

  it("evidence wajib 1–6 item", () => {
    const c = { evidence: [], band: 6, feedback: "x", tip: null };
    expect(GradeOutput.safeParse({ language_check: "english", criteria: { task: c, cc: c, lr: c, gra: c }, ceilings_triggered: [] }).success).toBe(false);
  });

  it("feedback 60–180 kata", () => {
    expect(checkGradeOutput(grade(59))).toMatch(/feedback/);
    expect(checkGradeOutput(grade(60))).toBeNull();
    expect(checkGradeOutput(grade(180))).toBeNull();
    expect(checkGradeOutput(grade(181))).toMatch(/feedback/);
  });

  it("tip maksimal 20 kata", () => {
    expect(checkGradeOutput(grade(100, words(20)))).toBeNull();
    expect(checkGradeOutput(grade(100, words(21)))).toMatch(/tip/);
  });

  it("not_english tidak dicek panjang feedback", () => {
    const g = { ...grade(100), language_check: "not_english" as const };
    g.criteria.task = { ...g.criteria.task, feedback: "short" };
    expect(checkGradeOutput(g)).toBeNull();
  });

  it("jumlah values harus sama dengan columns", () => {
    const d = ExtractedData.parse({
      chart_type: "bar", title: "t", units: "%",
      tables: [{ name: "a", columns: ["2000", "2010"], rows: [{ label: "x", values: ["1"] }] }],
      process_steps: [], map_changes: [], notes: [],
    });
    expect(checkExtractedData(d)).toMatch(/values/);
  });
});
