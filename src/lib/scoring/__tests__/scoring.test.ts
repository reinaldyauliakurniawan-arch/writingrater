import { describe, expect, it, vi } from "vitest";
import { countWords } from "../wordCount";
import { applyHardRules, lengthFlags } from "../hardRules";
import { applyCeilings } from "../ceilings";
import { polishTarget, taskBand, writingBand } from "../rounding";
import type { Bands } from "../types";

describe("countWords (4.1)", () => {
  it("W1", () => {
    expect(countWords("The chart shows data.", "")).toEqual({ total: 4, excluded: 0, counted: 4 });
  });
  it("W2", () => {
    expect(countWords("17% of people & 3 cats — well-known.", "")).toEqual({ total: 7, excluded: 0, counted: 7 });
  });
  it("W3", () => {
    const prompt = "Some people believe that university education should be free for everyone.";
    expect(countWords(prompt + " I agree.", prompt)).toEqual({ total: 13, excluded: 11, counted: 2 });
  });
  it("W4", () => {
    expect(countWords("The graph below shows sales.", "the graph below shows")).toEqual({
      total: 5,
      excluded: 0,
      counted: 5,
    });
  });
  it("tanda baca berdiri sendiri tidak dihitung, e.g. dihitung 1", () => {
    expect(countWords("e.g. — , ...", "").total).toBe(1);
  });
});

describe("applyHardRules (4.2)", () => {
  it("counted 0 -> ESSAY_EMPTY", () => {
    expect(applyHardRules({ task: "task2", counted: 0 })).toEqual({ kind: "reject", code: "ESSAY_EMPTY" });
  });
  it("H1: counted 20 -> semua band 1 tanpa LLM", () => {
    const r = applyHardRules({ task: "task2", counted: 20 });
    expect(r.kind).toBe("fixed");
    if (r.kind !== "fixed") return;
    expect(r.template).toBe("BAND1_SHORT");
    for (const k of ["task", "cc", "lr", "gra"] as const) {
      expect(r.criteria[k].band).toBe(1);
      expect(r.criteria[k].tip).toBeNull();
      expect(r.criteria[k].feedback).toContain("at least 250 words");
    }
  });
  it("H2: counted 21 -> lanjut ke LLM", () => {
    expect(applyHardRules({ task: "task2", counted: 21 })).toEqual({ kind: "llm" });
  });
  it("not_english -> semua band 0", () => {
    const r = applyHardRules({ task: "task1_academic", counted: 200, languageCheck: "not_english" });
    expect(r.kind).toBe("fixed");
    if (r.kind === "fixed") expect(r.criteria.gra.band).toBe(0);
  });
  it("H3: Task 1, counted 149", () => {
    expect(lengthFlags("task1_academic", 149)).toEqual({ underlength: true, severeUnderlength: false });
  });
  it("H4: Task 1, counted 89", () => {
    expect(lengthFlags("task1_academic", 89)).toEqual({ underlength: true, severeUnderlength: true });
  });
  it("H5: Task 2, counted 149", () => {
    expect(lengthFlags("task2", 149)).toEqual({ underlength: true, severeUnderlength: true });
  });
});

describe("applyCeilings (4.3)", () => {
  const base: Bands = { task: 7, cc: 7, lr: 7, gra: 6 };
  it("C1", () => {
    expect(applyCeilings(base, ["t1_ta_no_data"], "task1_academic").bands.task).toBe(5);
  });
  it("C2", () => {
    expect(applyCeilings(base, ["gra_simple_dominant"], "task2").bands.gra).toBe(4);
  });
  it("C3", () => {
    expect(applyCeilings(base, ["t2_cc_no_paragraphing", "cc_off_topic"], "task2").bands.cc).toBe(2);
  });
  it("C4: id tidak berlaku -> tidak berubah, warning di-log", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = applyCeilings(base, ["t2_tr_incomplete"], "task1_academic");
    expect(r.bands.task).toBe(7);
    expect(r.applied).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("pembulatan (4.4)", () => {
  it.each([
    ["R1", [5, 6, 6, 5], 5.5, 5.5],
    ["R2", [6, 6, 6, 7], 6.25, 6.5],
    ["R3", [6, 7, 7, 7], 6.75, 7.0],
    ["R4", [5, 5, 5, 6], 5.25, 5.5],
  ] as const)("%s taskBand", (_id, b, raw, band) => {
    const r = taskBand([...b] as [number, number, number, number]);
    expect(r.raw).toBeCloseTo(raw, 4);
    expect(r.band).toBe(band);
  });

  it.each([
    ["R5", 5.5, 6.5, 6.1667, 6.0],
    ["R6", 6.0, 6.5, 6.3333, 6.5],
    ["R7", 7.0, 5.0, 5.6667, 5.5],
    ["R8", 6.5, 7.5, 7.1667, 7.0],
    ["R9", 6.75, 6.75, 6.75, 7.0],
  ] as const)("%s writingBand", (_id, t1, t2, raw, band) => {
    const r = writingBand(t1, t2);
    expect(r.raw).toBeCloseTo(raw, 4);
    expect(r.band).toBe(band);
  });
});

describe("polishTarget (bagian 1)", () => {
  it.each([
    [5.5, 7],
    [6.5, 7],
    [7.0, 8],
    [7.5, 8.5],
    [8.5, 9],
    [9.0, null],
  ])("task_band %s -> %s", (band, target) => {
    expect(polishTarget(band)).toBe(target);
  });
});
