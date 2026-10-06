import { COPY_MIN_RUN } from "../config";

export type WordCount = { total: number; excluded: number; counted: number };

const WORD_TOKEN = /[\p{L}\p{N}&%$£€]/u;
const EDGE_NON_ALNUM = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function words(text: string): string[] {
  return text.split(/\s+/).filter((t) => t !== "" && WORD_TOKEN.test(t));
}

function normalize(word: string): string {
  return word.toLowerCase().replace(EDGE_NON_ALNUM, "");
}

/** Bagian 4.1. Dipakai server dan browser. */
export function countWords(essay: string, prompt: string): WordCount {
  const essayWords = words(essay).map(normalize);
  const promptWords = words(prompt).map(normalize);
  const total = essayWords.length;

  let excluded = 0;
  if (promptWords.length >= COPY_MIN_RUN) {
    const grams = new Set<string>();
    for (let i = 0; i + COPY_MIN_RUN <= promptWords.length; i++) {
      grams.add(promptWords.slice(i, i + COPY_MIN_RUN).join(" "));
    }
    const copied = new Array<boolean>(total).fill(false);
    for (let i = 0; i + COPY_MIN_RUN <= total; i++) {
      if (grams.has(essayWords.slice(i, i + COPY_MIN_RUN).join(" "))) {
        for (let j = i; j < i + COPY_MIN_RUN; j++) copied[j] = true;
      }
    }
    excluded = copied.filter(Boolean).length;
  }

  return { total, excluded, counted: total - excluded };
}
