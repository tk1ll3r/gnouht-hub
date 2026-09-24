export const TASK_STATUSES = ["todo", "doing", "attention", "done", "cut"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_KINDS = ["task", "assignment", "quiz", "exam", "report", "milestone"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_SOURCES = ["manual", "moodle", "markdown"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/** Effort guesses used until the user sets an estimate. */
export const DEFAULT_ESTIMATE_HOURS: Record<TaskKind, number> = {
  task: 2,
  assignment: 3,
  quiz: 1,
  exam: 8,
  report: 6,
  milestone: 4,
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "In progress",
  attention: "Needs attention",
  done: "Done",
  cut: "Cut",
};

export function isOpenStatus(status: TaskStatus): boolean {
  return status !== "done" && status !== "cut";
}

// `\b` is ASCII-only and treats Vietnamese letters as boundaries ("thi" would match "thiết"),
// so words are delimited with Unicode letter/number lookarounds instead.
function wordPattern(words: readonly string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

const KIND_PATTERNS: readonly [TaskKind, RegExp][] = [
  ["quiz", wordPattern(["quiz", "kiểm tra", "trắc nghiệm"])],
  ["exam", wordPattern(["exam", "thi", "midterm", "final", "giữa kỳ", "cuối kỳ"])],
  ["report", wordPattern(["report", "báo cáo", "paper", "thesis", "luận văn", "đồ án", "project"])],
  ["assignment", wordPattern(["assignment", "homework", "bài tập", "lab", "nộp", "submission", "due"])],
];

/** Guess a task kind from a deadline title, e.g. Moodle "Quiz 2 closes" → quiz. */
export function inferTaskKind(title: string): TaskKind {
  const normalized = title.normalize("NFC");
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(normalized)) return kind;
  }
  return "task";
}
