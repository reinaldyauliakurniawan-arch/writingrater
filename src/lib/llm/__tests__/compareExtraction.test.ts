import { describe, expect, it } from "vitest";
import { compareExtraction } from "../compareExtraction";
import { ExtractedData } from "../schemas";
import a from "../__fixtures__/extract.json";
import b from "../__fixtures__/extract-b.json";

describe("compareExtraction (6.2)", () => {
  it("fixture A dan B berbeda tepat di satu sel", () => {
    expect(compareExtraction(ExtractedData.parse(a), ExtractedData.parse(b))).toEqual([
      { table: "Sales", row: "Product B", column: "2005", a: "~22", b: "~24" },
    ]);
  });

  it("hasil identik -> tidak ada sel tidak pasti", () => {
    expect(compareExtraction(ExtractedData.parse(a), ExtractedData.parse(a))).toEqual([]);
  });

  it("bentuk berbeda -> shape_mismatch", () => {
    const other = ExtractedData.parse({ ...a, tables: [{ ...a.tables[0], columns: ["2000", "2010", "2020"] }] });
    expect(compareExtraction(ExtractedData.parse(a), other)).toEqual({ shape_mismatch: true });
  });
});
