export const TASK_BOARD_COLUMNS = [
  { id: 'todo', title: 'To Do' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
] as const;

export type TaskBoardStatus = typeof TASK_BOARD_COLUMNS[number]['id'];

export interface TaskBoardTask {
  id: number;
  title: string;
  description: string | null;
  status: TaskBoardStatus;
  created_at: string;
  parent_id: number | null;
  agent_id: string | null;
  from_role: string | null;
  target_role: string | null;
  payload: string | null;
}

const TASK_STATUSES = new Set<string>(TASK_BOARD_COLUMNS.map(column => column.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanTaskBoardText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\0/g, '').replace(/\s+/g, ' ').trim() : '';
}

function cleanTaskBoardPayload(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\0/g, '').trim() : '';
}

function nullableText(value: unknown): string | null {
  const trimmed = cleanTaskBoardText(value);
  return trimmed ? trimmed : null;
}

function nullablePayload(value: unknown): string | null {
  const trimmed = cleanTaskBoardPayload(value);
  return trimmed ? trimmed : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function normalizeStatusValue(value: unknown): string | null {
  const status = cleanTaskBoardText(value).toLowerCase();
  return status ? status : null;
}

export function isTaskBoardStatus(value: unknown): value is TaskBoardStatus {
  const status = normalizeStatusValue(value);
  return Boolean(status && TASK_STATUSES.has(status));
}

export function normalizeTaskBoardStatus(value: unknown): TaskBoardStatus {
  const status = normalizeStatusValue(value);
  return status && TASK_STATUSES.has(status) ? status as TaskBoardStatus : 'todo';
}

function normalizeTaskBoardTask(value: unknown): TaskBoardTask | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'number' && Number.isInteger(value.id) && value.id > 0 ? value.id : null;
  const title = cleanTaskBoardText(value.title);
  if (!id || !title) return null;

  return {
    id,
    title,
    description: nullableText(value.description),
    status: normalizeTaskBoardStatus(value.status),
    created_at: cleanTaskBoardText(value.created_at),
    parent_id: nullableNumber(value.parent_id),
    agent_id: nullableText(value.agent_id),
    from_role: nullableText(value.from_role),
    target_role: nullableText(value.target_role),
    payload: nullablePayload(value.payload),
  };
}

export function normalizeTaskBoardTasks(value: unknown): TaskBoardTask[] {
  if (!Array.isArray(value)) return [];
  const tasksById = new Map<number, TaskBoardTask>();

  for (const entry of value) {
    const task = normalizeTaskBoardTask(entry);
    if (!task) continue;
    if (tasksById.has(task.id)) tasksById.delete(task.id);
    tasksById.set(task.id, task);
  }

  return Array.from(tasksById.values());
}
