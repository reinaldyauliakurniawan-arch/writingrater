import { describe, expect, it } from "vitest";
import { locateCorrections, toSegments, type CorrectionInput } from "../corrections";

const c = (quote: string, type: CorrectionInput["type"] = "grammar"): CorrectionInput => ({
  quote,
  type,
  issue: "issue",
  correction: "fix",
});

describe("locateCorrections", () => {
  const essay = "People has many reason. In my opinion people has  to work hard.";

  it("menemukan kutipan persis dan mengurutkan berdasarkan posisi", () => {
    const marks = locateCorrections(essay, [c("many reason", "vocab"), c("People has")]);
    expect(marks.map((m) => essay.slice(m.start, m.end))).toEqual(["People has", "many reason"]);
  });

  it("kutipan berulang: kemunculan berikutnya dipakai untuk koreksi berikutnya", () => {
    const marks = locateCorrections(essay, [c("people has"), c("people has")]);
    expect(marks.map((m) => m.start)).toEqual([0, essay.indexOf("people has  to")]);
  });

  it("toleran beda spasi, huruf besar, dan tanda kutip lengkung", () => {
    const text = "It’s  a\nbig problem.";
    const [m] = locateCorrections(text, [c("it's a big")]);
    expect(text.slice(m.start, m.end)).toBe("It’s  a\nbig");
  });

  it("membuang kutipan yang tidak ada atau bertumpuk", () => {
    const marks = locateCorrections(essay, [c("does not exist"), c("many reason"), c("reason. In")]);
    expect(marks).toHaveLength(1);
  });
});

describe("toSegments", () => {
  it("menyusun ulang teks utuh dari segmen", () => {
    const text = "aa bb cc";
    const marks = locateCorrections(text, [c("bb")]);
    const segs = toSegments(text, marks);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.map((s) => !!s.mark)).toEqual([false, true, false]);
  });
});
