/**
 * Запуск workflow GitHub Actions зі сторінки налаштувань (кнопки «Увійти через віддалений
 * браузер» і «Запустити робота»).
 *
 * Якщо задано секрет GH_WORKFLOW_TOKEN (fine-grained PAT лише для цього репозиторію з
 * дозволом Actions: Read and write), Worker сам викликає workflow_dispatch, і людині нікуди
 * ходити не треба. Без токена сторінка показує посилання на вкладку Actions, де треба
 * натиснути «Run workflow».
 */
export interface ActionsEnv {
  GH_WORKFLOW_TOKEN?: string;
  GITHUB_REPO?: string;
}

export const DEFAULT_REPO = 'MikhailoTroynin/lesson-guard';

export const WORKFLOWS = {
  'google-login': 'google-login.yml',
  robot: 'robot.yml',
} as const;
export type WorkflowName = keyof typeof WORKFLOWS;

export const isWorkflowName = (v: unknown): v is WorkflowName => typeof v === 'string' && v in WORKFLOWS;

export function repoOf(env: ActionsEnv): string {
  const r = env.GITHUB_REPO?.trim();
  return r && /^[\w.-]+\/[\w.-]+$/.test(r) ? r : DEFAULT_REPO;
}

/** Сторінка workflow на GitHub (там є кнопка «Run workflow»). */
export function workflowUrl(env: ActionsEnv, name: WorkflowName): string {
  return `https://github.com/${repoOf(env)}/actions/workflows/${WORKFLOWS[name]}`;
}

export interface RunResult {
  /** true — workflow запущено через API; false — треба натиснути «Run workflow» за посиланням. */
  started: boolean;
  url: string;
  error?: string;
}

export async function runWorkflow(env: ActionsEnv, name: WorkflowName, doFetch: typeof fetch = fetch): Promise<RunResult> {
  const url = workflowUrl(env, name);
  const token = env.GH_WORKFLOW_TOKEN?.trim();
  if (!token) return { started: false, url };
  const res = await doFetch(`https://api.github.com/repos/${repoOf(env)}/actions/workflows/${WORKFLOWS[name]}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'lesson-guard-worker',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (res.status === 204) return { started: true, url };
  const body = (await res.text().catch(() => '')).slice(0, 200);
  const hint =
    res.status === 401 || res.status === 403
      ? 'секрет GH_WORKFLOW_TOKEN недійсний або без дозволу Actions: Read and write'
      : res.status === 404
        ? 'workflow не знайдено в гілці main (або токен не має доступу до репозиторію)'
        : body;
  return { started: false, url, error: `GitHub: HTTP ${res.status} — ${hint}` };
}
