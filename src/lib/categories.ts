/**
 * Event categories. This is the second place colour carries meaning rather than
 * decoration (the first is the sleep-stage chart), so hue is allowed here.
 *
 * The hue is never the only signal: every dot is paired with the category name
 * in the agenda, which keeps it readable for colour-blind users and in
 * greyscale. Muted values, because the dot is 4px and the palette has to sit
 * inside an otherwise monochrome interface.
 */
export type CalCategory = "work" | "academics" | "extracurriculars" | "personal" | "other";

type Cat = { id: CalCategory; label: string; color: string };

export const CATEGORIES: readonly Cat[] = [
  { id: "work", label: "Work", color: "#e8a33d" },
  { id: "academics", label: "Academics", color: "#7f9cf5" },
  { id: "extracurriculars", label: "Extracurriculars", color: "#4fc4a1" },
  { id: "personal", label: "Personal", color: "#dd7fb4" },
  { id: "other", label: "Other", color: "#98a0ab" },
] as const;

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Unknown or missing values collapse to "other" so old saved data still loads. */
export const normalizeCategory = (v: unknown): CalCategory =>
  typeof v === "string" && byId.has(v as CalCategory) ? (v as CalCategory) : "other";

export const categoryColor = (v: unknown): string =>
  byId.get(normalizeCategory(v))?.color ?? CATEGORIES[4].color;

export const categoryLabel = (v: unknown): string =>
  byId.get(normalizeCategory(v))?.label ?? CATEGORIES[4].label;

/**
 * Tasks are a different taxonomy — a task is a thing to do, not a block of
 * time — so the labels differ from events even where the hue does not. Reusing
 * a colour keeps "pink means Personal" true across the whole interface, so
 * colour stays a property of the category name rather than the object type.
 */
export type TaskCategory = "personal" | "assignments" | "other";

type TaskCat = { id: TaskCategory; label: string; color: string };

export const TASK_CATEGORIES: readonly TaskCat[] = [
  { id: "personal", label: "Personal", color: "#dd7fb4" },
  { id: "assignments", label: "Assignments", color: "#7f9cf5" },
  { id: "other", label: "Other", color: "#98a0ab" },
] as const;

const taskById = new Map(TASK_CATEGORIES.map((c) => [c.id, c]));

export const normalizeTaskCategory = (v: unknown): TaskCategory =>
  typeof v === "string" && taskById.has(v as TaskCategory) ? (v as TaskCategory) : "other";

export const taskCategoryColor = (v: unknown): string =>
  taskById.get(normalizeTaskCategory(v))?.color ?? TASK_CATEGORIES[2].color;

export const taskCategoryLabel = (v: unknown): string =>
  taskById.get(normalizeTaskCategory(v))?.label ?? TASK_CATEGORIES[2].label;
