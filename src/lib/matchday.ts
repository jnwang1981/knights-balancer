import type { AbilityKey, Fatigue, Injury, MatchDayStatus, Player } from './types';

// 当天状态与伤病：只临时调整这一场的有效评分，不改长期评分。
// 扣分幅度是试行参数，没有比赛数据支持（v1.5 原话，v1.6 保留此说明）。
// 规则：
// - 疲劳只扣体能：正常不扣；稍疲劳体能 −0.5；明显疲劳体能 −1；未知不扣、显示待确认。
// - 伤病：无伤病不扣；轻伤速度 −0.5、体能 −0.5；带伤上场速度 −1、体能 −1、无球跑动 −0.5、回防补位 −0.5。
// - 疲劳和伤病相加；每项扣完最低 1 分；评分为空的项目仍为空；守门评分不受疲劳和伤病影响。

export function fatigueStaminaDeduction(f: Fatigue): number {
  if (f === 'slightly') return 0.5;
  if (f === 'clearly') return 1;
  return 0; // normal / unknown 不扣分
}

export function injuryDeductions(injury: Injury): Partial<Record<AbilityKey, number>> {
  if (injury === 'minor') return { speed: 0.5, stamina: 0.5 };
  if (injury === 'playingHurt') return { speed: 1, stamina: 1, offBall: 0.5, covering: 0.5 };
  return {};
}

/** 单项扣分：空仍为空，否则扣完最低 1 分。 */
export function applyDeduction(base: number | null, deduction: number): number | null {
  if (base === null || base === undefined) return null;
  return Math.max(1, base - deduction);
}

/** 该球员当场有效九项（守门不受影响）。 */
export function effectiveScores(p: Player, st: MatchDayStatus): Record<AbilityKey, number | null> {
  const d = injuryDeductions(st.injury);
  const staminaDeduction = fatigueStaminaDeduction(st.fatigue) + (d.stamina ?? 0);
  const out = { ...p.scores };
  out.stamina = applyDeduction(p.scores.stamina, staminaDeduction);
  out.speed = applyDeduction(p.scores.speed, d.speed ?? 0);
  out.offBall = applyDeduction(p.scores.offBall, d.offBall ?? 0);
  out.covering = applyDeduction(p.scores.covering, d.covering ?? 0);
  // 其余五项（技术、传球、进攻、防守、守门）不受当天状态与伤病影响。
  return out;
}

/** 当场有效体能（兼容旧接口）。 */
export function effectiveStamina(base: number | null, st: MatchDayStatus): number | null {
  return applyDeduction(base, fatigueStaminaDeduction(st.fatigue) + (injuryDeductions(st.injury).stamina ?? 0));
}

/** 规范化当天状态：gkOnly 只有伤病=带伤上场时才成立，否则归一化为 false；gkOnly 与 cannotKeepGoal 二选一（gkOnly 优先）。 */
export function normalizeStatus(st: MatchDayStatus): MatchDayStatus {
  const next = { ...st };
  if (next.injury !== 'playingHurt') next.gkOnly = false;
  if (next.gkOnly) next.cannotKeepGoal = false;
  return next;
}

/**
 * 对单人状态打补丁（界面唯一入口）：
 * - 勾 cannotKeepGoal 时自动取消 gkOnly；勾 gkOnly 时自动取消 cannotKeepGoal；
 * - 伤病改离带伤上场时 gkOnly 自动取消；
 * - gkOnly 只能在伤病=带伤上场时勾上（否则忽略本次 gkOnly=true）。
 */
export function applyStatusPatch(prev: MatchDayStatus, patch: Partial<MatchDayStatus>): MatchDayStatus {
  const next: MatchDayStatus = { ...prev, ...patch };
  if (patch.cannotKeepGoal === true) next.gkOnly = false;
  if (patch.gkOnly === true) {
    if (next.injury !== 'playingHurt') next.gkOnly = false;
    else next.cannotKeepGoal = false;
  }
  return normalizeStatus(next);
}

/** 某个球员是否能踢外场（gkOnly 的人整场固定守门，不踢外场）。 */
export function canPlayOutfield(st: MatchDayStatus): boolean {
  return !st.gkOnly;
}

/** 某个球员是否能进守门顺序（gkOnly 的人固定守门，单独处理；cannotKeepGoal 的人不进轮换）。 */
export function canRotateGoalkeeping(st: MatchDayStatus): boolean {
  return !st.cannotKeepGoal && !st.gkOnly;
}
