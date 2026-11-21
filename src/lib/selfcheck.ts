import type { MatchDayStatus, Player } from './types';
import { defaultMatchDay, defaultMatchDayStatus } from './types';
import { applyStatusPatch, effectiveScores } from './matchday';
import { groupPlayers } from './grouping';
import { assignOutfield } from './positioning';
import { seedData } from './seed';

export interface SelfCheckItem { name: string; ok: boolean; detail: string }
export interface SelfCheckResult { passed: boolean; checks: SelfCheckItem[] }

/**
 * 页面自检（纯函数，只读入球员数据，绝不碰界面状态）。
 * 回归教训（2026-11-20 真实 bug）：自检曾用引用保存状态、测完又把样本恢复成页面默认值，
 * 导致某球员打开页面就默认轻伤。本自检只操作深拷贝（structuredClone / JSON 拷贝）的工作副本，
 * 测完不写回任何东西；默认值校验直接读全新的 defaultMatchDay()。
 */
function deepClone<T>(v: T): T {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

export function runSelfCheck(players: Player[]): SelfCheckResult {
  const checks: SelfCheckItem[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  // 自检开始前给入参拍快照，结束时核对未被改动（自检只读入参、只在深拷贝上运算）。
  const inputBefore = JSON.stringify(players);

  // 1. 默认值：全新 MatchDay 的 statuses 为空 → 每人都是 正常 / 无伤病、两勾选都不勾。
  const fresh = defaultMatchDay();
  const defaultsEmpty = Object.keys(fresh.statuses).length === 0;
  const d = defaultMatchDayStatus();
  push(
    '默认状态为空',
    defaultsEmpty && d.fatigue === 'normal' && d.injury === 'none' && !d.cannotKeepGoal && !d.gkOnly,
    defaultsEmpty ? '打开页面时所有人默认 正常 / 无伤病，两个勾选都不勾' : '默认状态非空（回归！）',
  );

  // 2. 扣分表（深拷贝的工作副本上算，不碰原数据）。
  const seed = seedData();
  const p0 = deepClone(seed.players[0]);
  const st: MatchDayStatus = { ...defaultMatchDayStatus(), fatigue: 'clearly', injury: 'playingHurt' };
  const eff = effectiveScores(p0, st);
  const base = p0.scores;
  const expectStamina = base.stamina === null ? null : Math.max(1, base.stamina - 2);
  const expectSpeed = base.speed === null ? null : Math.max(1, base.speed - 1);
  push(
    '扣分表：明显疲劳+带伤上场',
    eff.stamina === expectStamina && eff.speed === expectSpeed && eff.goalkeeping === base.goalkeeping,
    `${p0.name} 体能 ${base.stamina}→${eff.stamina}（应 ${expectStamina}）、速度 ${base.speed}→${eff.speed}（应 ${expectSpeed}）、守门 ${base.goalkeeping} 不变`,
  );

  // 3. 二选一与自动取消（工作副本）。
  let s1 = applyStatusPatch(defaultMatchDayStatus(), { injury: 'playingHurt', gkOnly: true });
  const step1 = s1.gkOnly && !s1.cannotKeepGoal;
  s1 = applyStatusPatch(s1, { cannotKeepGoal: true });
  const step2 = s1.cannotKeepGoal && !s1.gkOnly;
  s1 = applyStatusPatch(s1, { injury: 'minor' });
  const step3 = !s1.gkOnly;
  const s2 = applyStatusPatch(defaultMatchDayStatus(), { gkOnly: true });
  const step4 = !s2.gkOnly; // 无伤病时勾不上只能守门
  push('只能守门二选一与自动取消', step1 && step2 && step3 && step4, '带伤勾上→勾不能守门自动取消只能守门→改回轻伤自动取消→无伤病勾不上');

  // 4. 不能守门不绑伤病：无伤病也能勾，改伤病不取消。
  let s3 = applyStatusPatch(defaultMatchDayStatus(), { cannotKeepGoal: true });
  const c1 = s3.cannotKeepGoal;
  s3 = applyStatusPatch(s3, { injury: 'minor' });
  const c2 = s3.cannotKeepGoal;
  s3 = applyStatusPatch(s3, { injury: 'none' });
  const c3 = s3.cannotKeepGoal;
  push('不能守门与伤病解绑', c1 && c2 && c3, '无伤病可勾；改轻伤/改回无伤病都不自动取消');

  // 5. 分组：16 名示例球员可行，且覆盖前 3 有序。
  const inputs = seed.players.map((p) => ({
    id: p.id, scores: effectiveScores(p, defaultMatchDayStatus()),
    canPivot: p.canPivot, canOrganize: p.canOrganize, gkOnly: false,
  }));
  const res = groupPlayers(inputs, { requirePivot: true, requireOrganize: true });
  push('分组：示例 16 人可行', res.feasibleCount > 0 && res.candidates.length === 10, `枚举 ${res.totalEnumerated}、可行 ${res.feasibleCount}、能力前 10 取到 ${res.candidates.length} 名`);
  const ordered = res.candidates.every((c, i) => i === 0 || res.candidates[i - 1].metrics.maxDelta <= c.metrics.maxDelta + 1e-9);
  push('分组：能力前 10 按 Δ 升序', res.candidates.length > 0 && ordered, `能力第 1 名最大 Δ ${res.candidates[0]?.metrics.maxDelta.toFixed(3) ?? '—'}，第 10 名 ${res.candidates[9]?.metrics.maxDelta.toFixed(3) ?? '—'}`);

  // 6. 只能守门：本队按 7 人算平均；一队两人直接不可行。
  const gkOnlyId = seed.players[0].id;
  const inputs2 = inputs.map((x) => (x.id === gkOnlyId ? { ...x, gkOnly: true } : x));
  const res2 = groupPlayers(inputs2, { requirePivot: true, requireOrganize: true });
  const seven = res2.candidates.some((c) =>
    (c.metrics.teamA.includes(gkOnlyId) && c.metrics.outfieldCount.dark === 7) ||
    (c.metrics.teamB.includes(gkOnlyId) && c.metrics.outfieldCount.light === 7));
  push('只能守门：本队按 7 人算平均', res2.feasibleCount > 0 && seven, `含固定守门人的分组里，其所在队外场人数为 7`);
  const twoGk = seed.players.slice(0, 2).map((p) => p.id);
  const inputs3 = inputs.map((x) => (twoGk.includes(x.id) ? { ...x, gkOnly: true } : x));
  const res3 = groupPlayers(inputs3, { requirePivot: true, requireOrganize: true });
  const bothSameTeamBlocked = !res3.candidates.some((c) =>
    (twoGk.every((id) => c.metrics.teamA.includes(id)) || twoGk.every((id) => c.metrics.teamB.includes(id))));
  push('只能守门：一队最多一个', bothSameTeamBlocked, '两名固定守门人在同一队的分组均被排除');

  // 7. 覆盖分配 DP：已知小例子。
  const demo = assignOutfield([
    { id: 'a', familiarity: { GK: 'unevaluated', CB: 'expert', LB: 'familiar', RB: 'unevaluated', DM: 'unevaluated', LM: 'unevaluated', RM: 'unevaluated', CF: 'unevaluated' } },
    { id: 'b', familiarity: { GK: 'unevaluated', CB: 'unevaluated', LB: 'expert', RB: 'familiar', DM: 'unevaluated', LM: 'unevaluated', RM: 'unevaluated', CF: 'unevaluated' } },
    { id: 'c', familiarity: { GK: 'unevaluated', CB: 'unevaluated', LB: 'unevaluated', RB: 'expert', DM: 'familiar', LM: 'unevaluated', RM: 'unevaluated', CF: 'unevaluated' } },
    { id: 'd', familiarity: { GK: 'unevaluated', CB: 'unevaluated', LB: 'unevaluated', RB: 'unevaluated', DM: 'expert', LM: 'familiar', RM: 'unevaluated', CF: 'unevaluated' } },
    { id: 'e', familiarity: { GK: 'unevaluated', CB: 'unevaluated', LB: 'unevaluated', RB: 'unevaluated', DM: 'unevaluated', LM: 'expert', RM: 'familiar', CF: 'unevaluated' } },
    { id: 'f', familiarity: { GK: 'unevaluated', CB: 'unevaluated', LB: 'unevaluated', RB: 'unevaluated', DM: 'unevaluated', LM: 'unevaluated', RM: 'expert', CF: 'familiar' } },
    { id: 'g', familiarity: { GK: 'unevaluated', CB: 'unevaluated', LB: 'unevaluated', RB: 'unevaluated', DM: 'unevaluated', LM: 'unevaluated', RM: 'unevaluated', CF: 'expert' } },
  ]);
  push('覆盖 DP：7 人全覆盖', demo !== null && demo.covered === 7, demo ? `覆盖 ${demo.covered}/7，总代价 ${demo.totalCost}` : '无解（不应发生）');

  // 8. 自检没有污染入参：结束时入参与开始快照一致。
  push('自检不污染数据', JSON.stringify(players) === inputBefore, '自检只读入参、只在深拷贝上运算');

  return { passed: checks.every((c) => c.ok), checks };
}
