import type { AppData } from './types';
import { SCHEMA_VERSION, STORAGE_KEY } from './types';
import { validatePlayer } from './validation';

/** 校验导入的完整结构、评分范围、ID 唯一性与引用完整性。失败返回错误列表，绝不破坏原数据。 */
export function validateAppData(data: unknown): string[] {
  const errs: string[] = [];
  if (!data || typeof data !== 'object') return ['不是有效的 JSON 对象'];
  const d = data as Record<string, unknown>;
  if (d.schemaVersion !== SCHEMA_VERSION) errs.push(`schemaVersion 必须是 ${SCHEMA_VERSION}`);
  if (!Array.isArray(d.players)) return [...errs, 'players 必须是数组'];
  const ids = new Set<string>();
  for (const p of d.players as unknown[]) {
    errs.push(...validatePlayer(p));
    const id = (p as { id?: unknown })?.id;
    if (typeof id === 'string') { if (ids.has(id)) errs.push(`球员 id 重复：${id}`); ids.add(id); }
  }
  if (d.baseline && typeof d.baseline === 'object') {
    const b = d.baseline as Record<string, unknown>;
    for (const t of ['dark', 'light']) {
      if (!Array.isArray(b[t])) errs.push(`baseline.${t} 必须是数组`);
      else for (const id of b[t] as unknown[]) if (typeof id === 'string' && !ids.has(id)) errs.push(`基线分组引用了不存在的球员：${id}`);
    }
  }
  if (d.matches !== undefined && !Array.isArray(d.matches)) errs.push('matches 必须是数组');
  if (Array.isArray(d.matches)) {
    for (const m of d.matches as Record<string, unknown>[]) {
      const teams = m.teams as Record<string, string[]> | undefined;
      if (teams) for (const t of ['dark', 'light']) for (const id of teams[t] ?? []) {
        if (!ids.has(id) && !(m.snapshot as Record<string, unknown> | undefined)?.players) errs.push(`比赛 ${String(m.id)} 引用了不存在的球员：${id}`);
      }
      const evs = (m.events ?? []) as Record<string, unknown>[];
      const roster = new Set([...(teams?.dark ?? []), ...(teams?.light ?? [])]);
      for (const ev of evs) {
        for (const f of ['scorerId', 'primaryAssistId', 'secondaryAssistId']) {
          const v = ev[f];
          if (typeof v === 'string' && v && !roster.has(v)) errs.push(`比赛 ${String(m.id)} 事件 ${String(ev.id)} 的 ${f} 不在当场名单`);
        }
      }
    }
  }
  if (d.partnerships !== undefined && !Array.isArray(d.partnerships)) errs.push('partnerships 必须是数组');
  return errs;
}

export function parseImport(text: string): { data: AppData | null; errors: string[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { data: null, errors: ['JSON 解析失败'] }; }
  const errors = validateAppData(parsed);
  return errors.length ? { data: null, errors } : { data: parsed as AppData, errors: [] };
}

export function loadStored(): { data: AppData | null; corrupted: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { data: null, corrupted: null };
    const parsed = JSON.parse(raw);
    const errors = validateAppData(parsed);
    if (errors.length) return { data: null, corrupted: `本地数据损坏，未清空：${errors.slice(0, 3).join('；')}` };
    return { data: parsed as AppData, corrupted: null };
  } catch (e) {
    return { data: null, corrupted: `本地数据无法读取，未清空：${e instanceof Error ? e.message : String(e)}` };
  }
}
export function saveStored(data: AppData): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
export function exportJson(data: AppData): string { return JSON.stringify(data, null, 2); }
