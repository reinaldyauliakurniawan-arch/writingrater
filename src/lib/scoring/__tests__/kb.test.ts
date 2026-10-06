import { describe, expect, it } from "vitest";
import descriptorsJson from "../../kb/descriptors.json";
import { DescriptorsSchema, getBandDescriptors, getCeilingLines, getDescriptors } from "../../kb";

describe("knowledge base (bagian 5)", () => {
  it("descriptors.json lolos validasi zod: 2 task x 4 kriteria x band 1–9", () => {
    const d = DescriptorsSchema.parse(descriptorsJson);
    for (const task of ["task1_academic", "task2"] as const) {
      for (const k of ["task", "cc", "lr", "gra"] as const) {
        expect(Object.keys(d.tasks[task][k]).sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
      }
    }
  });

  it("tidak ada teks General Training di task1_academic", () => {
    const text = JSON.stringify(descriptorsJson.tasks.task1_academic);
    expect(text).not.toMatch(/General Training/);
    expect(text).not.toMatch(/\(Academic\)/);
  });

  it("getDescriptors('task2') berformat sesuai 5.2", () => {
    const out = getDescriptors("task2");
    const lines = out.split("\n");
    expect(lines[0]).toBe("### Task Response");
    expect(lines[1]).toBe("Band 9:");
    expect(lines[2]).toBe("- The prompt is appropriately addressed and explored in depth.");
    const headings = lines.filter((l) => l.startsWith("### "));
    expect(headings).toEqual([
      "### Task Response",
      "### Coherence & Cohesion",
      "### Lexical Resource",
      "### Grammatical Range & Accuracy",
    ]);
    // urutan band 9 -> 1 di setiap kriteria
    const bandLines = lines.filter((l) => /^Band \d:$/.test(l));
    expect(bandLines.slice(0, 9)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1].map((b) => `Band ${b}:`));
    expect(bandLines).toHaveLength(36);
  });

  it("kalimat negatif diberi prefiks [LIMITING]", () => {
    const out = getDescriptors("task2");
    expect(out).toContain("- [LIMITING] The main parts of the prompt are incompletely addressed.");
    expect(out).toContain("- [LIMITING] Responses of 20 words or fewer are rated at Band 1.");
    expect(out).not.toContain("- [LIMITING] The prompt is appropriately addressed and explored in depth.");
  });

  it("getBandDescriptors hanya memuat satu band", () => {
    const out = getBandDescriptors("task1_academic", 7);
    expect(out.match(/^Band \d:$/gm)).toEqual(["Band 7:", "Band 7:", "Band 7:", "Band 7:"]);
    expect(out.split("\n")[0]).toBe("### Task Achievement");
  });

  it("getCeilingLines hanya berisi ceiling yang berlaku", () => {
    const t1 = getCeilingLines("task1_academic");
    expect(t1).toContain("t1_ta_no_data: There is no data (figures) to support the description.");
    expect(t1).not.toContain("t2_tr_incomplete");
  });
});
