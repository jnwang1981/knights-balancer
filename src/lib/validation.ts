import { ABILITY_KEYS, POSITIONS, type AbilityKey, type Familiarity, type Player, type Position } from './types';

/** 评分合法：空，或 1–5 之间步长 0.5。整数化校验避免浮点误差。 */
export function isValidScore(v: unknown): v is number | null {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const doubled = v * 2;
  return Number.isInteger(doubled) && doubled >= 2 && doubled <= 10;
}
export function scoreError(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) return '必须是数字或留空';
  const doubled = v * 2;
  if (!Number.isInteger(doubled)) return '步长必须是 0.5';
  if (doubled < 2 || doubled > 10) return '范围是 1–5';
  return null;
}
/** 解析输入框文本：'' -> null；否则数字（非法时返回 undefined 表示拒绝）。 */
export function parseScoreInput(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return isValidScore(n) ? n : undefined;
}

export function validatePlayer(p: unknown): string[] {
  const errs: string[] = [];
  if (!p || typeof p !== 'object') return ['球员不是对象'];
  const x = p as Record<string, unknown>;
  if (typeof x.id !== 'string' || !x.id) errs.push('球员 id 缺失');
  if (typeof x.name !== 'string' || !x.name.trim()) errs.push(`球员 ${String(x.id)} 姓名缺失`);
  if (!x.scores || typeof x.scores !== 'object') { errs.push(`球员 ${String(x.name)} 缺少 scores`); return errs; }
  const s = x.scores as Record<string, unknown>;
  for (const k of ABILITY_KEYS) {
    const e = scoreError(s[k]);
    if (e) errs.push(`球员 ${String(x.name)} ${k}：${e}`);
  }
  if (x.familiarity && typeof x.familiarity === 'object') {
    const f = x.familiarity as Record<string, unknown>;
    for (const pos of POSITIONS) {
      const v = f[pos];
      if (v !== undefined && !['expert','familiar','emergency','unevaluated','unsuitable'].includes(String(v))) {
        errs.push(`球员 ${String(x.name)} 位置 ${pos} 熟悉度非法`);
      }
    }
  }
  if (x.primaryPosition !== null && x.primaryPosition !== undefined && !POSITIONS.includes(x.primaryPosition as Position)) {
    errs.push(`球员 ${String(x.name)} 主位置非法`);
  }
  if (x.canPivot !== 'yes' && x.canPivot !== 'no' && x.canPivot !== 'unknown') errs.push(`球员 ${String(x.name)} 后场支点取值非法`);
  if (x.canOrganize !== 'yes' && x.canOrganize !== 'no' && x.canOrganize !== 'unknown') errs.push(`球员 ${String(x.name)} 组织接应取值非法`);
  return errs;
}

/** 缺少哪些外场评分：用于阻止分组并明确列出。 */
export function missingOutfield(p: Player): AbilityKey[] {
  const need: AbilityKey[] = ['technique','passing','attackAwareness','defenseAwareness','speed','offBall','stamina','covering'];
  return need.filter((k) => p.scores[k] === null || p.scores[k] === undefined);
}

export const FAMILIARITY_VALUES: Familiarity[] = ['expert','familiar','emergency','unevaluated','unsuitable'];
