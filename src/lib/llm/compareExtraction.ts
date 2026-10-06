import type { ExtractedData } from "./schemas";
import type { ExtractionUncertain, UncertainCell } from "@/lib/types";

/** Bagian 6.2: bandingkan hasil A dan B. Bentuk sama -> daftar sel berbeda; beda bentuk -> shape_mismatch. */
export function compareExtraction(a: ExtractedData, b: ExtractedData): ExtractionUncertain {
  const sameShape =
    a.tables.length === b.tables.length &&
    a.tables.every((ta, i) => {
      const tb = b.tables[i];
      return (
        ta.columns.length === tb.columns.length &&
        ta.columns.every((c, j) => c === tb.columns[j]) &&
        ta.rows.length === tb.rows.length &&
        ta.rows.every((r, j) => r.label === tb.rows[j].label)
      );
    });
  if (!sameShape) return { shape_mismatch: true };

  const cells: UncertainCell[] = [];
  a.tables.forEach((ta, i) => {
    const tb = b.tables[i];
    ta.rows.forEach((ra, j) => {
      ra.values.forEach((va, k) => {
        const vb = tb.rows[j].values[k];
        if (va !== vb) cells.push({ table: ta.name, row: ra.label, column: ta.columns[k], a: va, b: vb });
      });
    });
  });
  return cells;
}
