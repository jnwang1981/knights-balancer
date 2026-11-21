import { OUTFIELD_KEYS, type AbilityKey, type RoleValue, type TeamId } from './types';

export const ALGORITHM_VERSION = 'grouping-v1.6';

// ---- 整数化：评分 ×2 为整数（1→2 … 5→10），全程整数比较，杜绝浮点排序漂移 ----
// v1.6：因伤只能守门的人不踢外场，两队外场人数可能不同（7 对 8），平均分差是有理数。
// 用 (分子, 分母) 表示，比较时交叉相乘（数值很小，double 精确整数运算无误差）。
export function toInt(score: number): number { return Math.round(score * 2); }

export interface Rational { n: number; d: number }
export function compareRational(a: Rational, b: Rational): number {
  const l = a.n * b.d, r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

export interface GroupingInputPlayer {
  id: string;
  scores: Record<AbilityKey, number | null>; // 当场有效评分（已扣当天状态/伤病）
  canPivot: RoleValue;
  canOrganize: RoleValue;
  /** 因伤只能守门：整场固定守门，不踢外场；外场评分不进本队平均。 */
  gkOnly: boolean;
}

/** 该球员当场有效八项；gkOnly 的人不参与外场计算，返回 null 表示不计入。 */
export function effectiveOutfield(p: GroupingInputPlayer): Record<AbilityKey, number> | null {
  if (p.gkOnly) return null;
  const out = {} as Record<AbilityKey, number>;
  for (const k of OUTFIELD_KEYS) {
    const v = p.scores[k];
    if (v === null || v === undefined) return null;
    out[k] = v;
  }
  return out;
}

export interface TeamMetrics {
  teamA: string[]; teamB: string[];
  /** 每项平均分差 Δ（有理数：n/d 分）。 */
  deltas: Record<AbilityKey, Rational>;
  averages: Record<TeamId, Record<AbilityKey, number>>;
  /** 外场人数（gkOnly 的人不计入）：7 或 8。 */
  outfieldCount: Record<TeamId, number>;
  maxDelta: number; // 展示用：最大 Δ（分）
  maxDeltaKey: AbilityKey;
  weighted: number; // 体能+无球+回防 Δ 之和（展示用，分）
  sumDelta: number; // 八项 Δ 之和（展示用，分）
  /** 排序键：同一分母下的分子（maxD, weightedD, sumD）+ 组合键。分母 sortDen 两队共用。 */
  sortKey: [number, number, number, string];
  sortDen: number;
  gkComplete: boolean;
  constraintOk: boolean;
  constraintIssues: string[];
}

/** 枚举全部人数相等的分组：固定排序后第一人在 A 队，消除 A/B 互换重复。 */
export function enumeratePartitions(sortedIds: string[], m: number): string[][] {
  const first = sortedIds[0];
  const rest = sortedIds.slice(1);
  const out: string[][] = [];
  const pick: string[] = [];
  function rec(start: number) {
    if (pick.length === m - 1) { out.push([first, ...pick]); return; }
    for (let i = start; i < rest.length; i++) {
      if (rest.length - i < (m - 1) - pick.length) break;
      pick.push(rest[i]); rec(i + 1); pick.pop();
    }
  }
  rec(0);
  return out;
}
export function combinationCount(n: number, m: number): number {
  let r = 1; const k = m - 1; const N = n - 1;
  for (let i = 1; i <= k; i++) r = (r * (N - k + i)) / i;
  return Math.round(r);
}

export function evaluatePartition(
  teamAIds: string[], allIds: string[],
  byId: Map<string, GroupingInputPlayer>,
  requirePivot: boolean, requireOrganize: boolean,
): TeamMetrics {
  const setA = new Set(teamAIds);
  const teamBIds = allIds.filter((id) => !setA.has(id));
  const m = teamAIds.length;
  const gkOnlyA = teamAIds.filter((id) => byId.get(id)!.gkOnly).length;
  const gkOnlyB = teamBIds.filter((id) => byId.get(id)!.gkOnly).length;
  const mA = m - gkOnlyA, mB = m - gkOnlyB; // 外场人数
  const den = 2 * mA * mB; // Δ 的公共分母
  const sums: Record<TeamId, Record<AbilityKey, number>> = {
    dark: {} as Record<AbilityKey, number>, light: {} as Record<AbilityKey, number>,
  };
  for (const k of OUTFIELD_KEYS) { sums.dark[k] = 0; sums.light[k] = 0; }
  for (const id of allIds) {
    const e = effectiveOutfield(byId.get(id)!);
    if (!e) continue; // gkOnly 的人不进外场平均
    const side: TeamId = setA.has(id) ? 'dark' : 'light';
    for (const k of OUTFIELD_KEYS) sums[side][k] += toInt(e[k]);
  }
  // Δ_k = |sumA/(2*mA) − sumB/(2*mB)| = |sumA*mB − sumB*mA| / (2*mA*mB)
  const deltas = {} as Record<AbilityKey, Rational>;
  const averages = { dark: {} as Record<AbilityKey, number>, light: {} as Record<AbilityKey, number> };
  for (const k of OUTFIELD_KEYS) {
    const num = Math.abs(sums.dark[k] * mB - sums.light[k] * mA);
    deltas[k] = { n: num, d: den };
    averages.dark[k] = sums.dark[k] / (2 * mA);
    averages.light[k] = sums.light[k] / (2 * mB);
  }
  const maxKey = OUTFIELD_KEYS.reduce((a, b) => (compareRational(deltas[b], deltas[a]) > 0 ? b : a));
  const weightedNum = deltas.stamina.n + deltas.offBall.n + deltas.covering.n;
  const sumNum = OUTFIELD_KEYS.reduce((s, k) => s + deltas[k].n, 0);
  const key = [...teamAIds].sort().join(',');
  const issues: string[] = [];
  // 一队最多一个因伤只能守门的人（两个就排不开了：7 个外场位置只剩 6 个人）。
  if (gkOnlyA > 1) issues.push('深黑队有两名因伤只能守门的球员，排不开');
  if (gkOnlyB > 1) issues.push('浅蓝队有两名因伤只能守门的球员，排不开');
  // 支点/接应只算能踢外场的人。
  const outfieldA = teamAIds.filter((id) => !byId.get(id)!.gkOnly);
  const outfieldB = teamBIds.filter((id) => !byId.get(id)!.gkOnly);
  if (requirePivot) {
    for (const [label, ids] of [['深黑', outfieldA], ['浅蓝', outfieldB]] as const) {
      if (!ids.some((id) => byId.get(id)!.canPivot === 'yes')) issues.push(`${label}队没有已确认的后场支点（只能守门的人不算）`);
    }
  }
  if (requireOrganize) {
    for (const [label, ids] of [['深黑', outfieldA], ['浅蓝', outfieldB]] as const) {
      if (!ids.some((id) => byId.get(id)!.canOrganize === 'yes')) issues.push(`${label}队没有已确认的组织接应者（只能守门的人不算）`);
    }
  }
  const gkComplete = allIds.every((id) => byId.get(id)!.scores.goalkeeping !== null);
  return {
    teamA: [...teamAIds].sort(), teamB: [...teamBIds].sort(),
    deltas, averages,
    outfieldCount: { dark: mA, light: mB },
    maxDelta: deltas[maxKey].n / deltas[maxKey].d, maxDeltaKey: maxKey,
    weighted: weightedNum / den, sumDelta: sumNum / den,
    sortKey: [deltas[maxKey].n, weightedNum, sumNum, key],
    sortDen: den,
    gkComplete, constraintOk: issues.length === 0, constraintIssues: issues,
  };
}

export function compareMetrics(a: TeamMetrics, b: TeamMetrics): number {
  const an = [a.sortKey[0], a.sortKey[1], a.sortKey[2]];
  const bn = [b.sortKey[0], b.sortKey[1], b.sortKey[2]];
  for (let i = 0; i < 3; i++) {
    const l = an[i] * b.sortDen, r = bn[i] * a.sortDen;
    if (l !== r) return l - r;
  }
  const ka = a.sortKey[3], kb = b.sortKey[3];
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export interface GroupingResult {
  algorithmVersion: string;
  totalEnumerated: number;
  feasibleCount: number;
  /** 能力前 10 名（按能力排序）。位置版再按覆盖取前 3 作推荐。 */
  candidates: { rank: number; metrics: TeamMetrics }[];
  missing: { playerId: string; missingKeys: AbilityKey[] }[];
  blockedReason: string | null;
  constraints: { requirePivot: boolean; requireOrganize: boolean };
}

export function groupPlayers(
  inputs: GroupingInputPlayer[],
  opts: { requirePivot: boolean; requireOrganize: boolean },
): GroupingResult {
  const sorted = [...inputs].sort((a, b) => (a.id < b.id ? -1 : 1));
  const ids = sorted.map((p) => p.id);
  const byId = new Map(sorted.map((p) => [p.id, p]));
  // 缺评分只拦能踢外场的人：gkOnly 的人外场评分不用，不拦。
  const missing = sorted
    .filter((p) => !p.gkOnly)
    .map((p) => {
      const eff = effectiveOutfield(p);
      const missingKeys = eff ? [] : OUTFIELD_KEYS.filter((k) => p.scores[k] === null || p.scores[k] === undefined);
      return { playerId: p.id, missingKeys };
    })
    .filter((x) => x.missingKeys.length > 0);
  const base: GroupingResult = {
    algorithmVersion: ALGORITHM_VERSION, totalEnumerated: 0, feasibleCount: 0,
    candidates: [], missing, blockedReason: null, constraints: opts,
  };
  if (ids.length < 8 || ids.length > 20) return { ...base, blockedReason: `人数须为 8–20 人，当前 ${ids.length} 人` };
  if (ids.length % 2 !== 0) return { ...base, blockedReason: `人数为奇数（${ids.length} 人），请先调整出勤名单，不要偷偷排除一个人` };
  if (missing.length > 0) return { ...base, blockedReason: '有球员缺少外场评分，无法生成数值推荐' };
  const m = ids.length / 2;
  const partitions = enumeratePartitions(ids, m);
  const all: TeamMetrics[] = [];
  let feasible = 0;
  for (const part of partitions) {
    const met = evaluatePartition(part, ids, byId, opts.requirePivot, opts.requireOrganize);
    if (met.constraintOk) { feasible++; all.push(met); }
  }
  all.sort(compareMetrics);
  const candidates: GroupingResult['candidates'] = all.slice(0, 10).map((met, i) => ({ rank: i + 1, metrics: met }));
  const blockedReason = feasible === 0
    ? '没有满足硬约束的分组：请检查每队是否至少有一名已确认的后场支点 / 组织接应者（只能守门的人不算），或一队是否有多名因伤只能守门的球员；或明确关闭约束后重算（不会自动放宽）。'
    : null;
  return { ...base, totalEnumerated: partitions.length, feasibleCount: feasible, candidates, blockedReason };
}
