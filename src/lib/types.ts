// Tipe respons API (bagian 7.4), dipakai server dan browser. Tanpa import server.
import type { ExtractedData, FactCheck } from "@/lib/llm/schemas";
import type { CorrectionMark } from "@/lib/corrections";

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
  task_type: TaskTypeValue;
  original_text: string;
  original_marks: CorrectionMark[]; // urut, tidak bertumpuk
  has_corrections: boolean; // false = versi polished lama (dibuat sebelum fitur koreksi)
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
  question: { id: string; name: string } | null; // soal dari / tersimpan di database soal
};

export type QuestionView = {
  id: string;
  task_type: TaskTypeValue;
  name: string;
  prompt_text: string;
  image_url: string | null;
  extracted_data: ExtractedData | null;
  created_by_name: string | null;
  created_at: string;
  can_edit: boolean; // pembuat atau admin
};

export type ApiError = { code: string; message: string };

export type SessionView = {
  session: { id: string; writing_band: number | null; writing_band_raw: number | null; created_at: string };
  task1: SubmissionDetail | null;
  task2: SubmissionDetail | null;
};

export type HistoryView = {
  submissions: {
    id: string;
    task_type: TaskTypeValue;
    status: SubmissionStatusValue;
    task_band: number | null;
    session_id: string | null;
    prompt_preview: string;
    created_at: string;
  }[];
  sessions: { id: string; writing_band: number | null; created_at: string }[];
};
