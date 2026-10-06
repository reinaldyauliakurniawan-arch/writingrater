export const CRITERIA = ["task", "cc", "lr", "gra"] as const;
export type CriterionKey = (typeof CRITERIA)[number];
export type Bands = Record<CriterionKey, number>;
export type TaskType = "task1_academic" | "task2";

export const CRITERION_NAMES: Record<TaskType, Record<CriterionKey, string>> = {
  task1_academic: {
    task: "Task Achievement",
    cc: "Coherence & Cohesion",
    lr: "Lexical Resource",
    gra: "Grammatical Range & Accuracy",
  },
  task2: {
    task: "Task Response",
    cc: "Coherence & Cohesion",
    lr: "Lexical Resource",
    gra: "Grammatical Range & Accuracy",
  },
};

export function mapCriteria<T>(fn: (key: CriterionKey) => T): Record<CriterionKey, T> {
  return { task: fn("task"), cc: fn("cc"), lr: fn("lr"), gra: fn("gra") };
}
