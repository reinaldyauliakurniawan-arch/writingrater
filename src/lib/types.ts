// Tipe respons API (bagian 7.4), dipakai server dan browser. Tanpa import server.
import type { ExtractedData, FactCheck } from "@/lib/llm/schemas";

export type TaskTypeValue = "task1_academic" | "task2";
export type SubmissionStatusValue = "draft" | "extracted" | "confirmed" | "graded";

export type CriterionView = {
  key: "task" | "cc" | "lr" | "gra";
  name: string;
  band: number;
  feedback: string;
  tip: string | null;
};

export type SubmissionResult = {
  id: string;
  task_type: TaskTypeValue;
  status: "graded";
  word_count: { total: number; excluded: number; counted: number; min: number };
  criteria: CriterionView[]; // urutan task, cc, lr, gra
  task_band: number;
  task_band_raw: number;
  fact_errors: FactCheck["fact_errors"] | null; // Task 1 saja
  session: { id: string; writing_band: number | null } | null;
  polish_target: number | null; // null jika polished tidak tersedia
};

export type PolishedView = {
  target_band: number;
  polished_text: string;
  rescored_task_band: number;
  rescored_criteria: CriterionView[];
};

export type UncertainCell = { table: string; row: string; column: string; a: string; b: string };
export type ExtractionUncertain = UncertainCell[] | { shape_mismatch: true };

export type SubmissionDetail = {
  id: string;
  task_type: TaskTypeValue;
  status: SubmissionStatusValue;
  session_id: string | null;
  prompt_text: string;
  prompt_image_url: string | null;
  extracted_data: ExtractedData | null;
  extraction_uncertain: ExtractionUncertain | null;
  essay_text: string;
  last_error_code: string | null;
  created_at: string;
  graded_at: string | null;
  result: SubmissionResult | null;
  polished: PolishedView | null;
};

export type ApiError = { code: string; message: string };
