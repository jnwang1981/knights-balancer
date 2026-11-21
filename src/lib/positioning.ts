import {
  FAMILIARITY_COST, OUTFIELD_SLOTS, POSITION_LABEL, coversSlot,
  type Familiarity, type Player, type Position, type TeamId,
} from './types';
import type { MatchDayStatus } from './types';
import type { TeamMetrics } from './grouping';

export const POSITION_RULE_VERSION = 'pos-v1.6';

export interface SlotAssignment {
  slot: Position;
  playerId: string;
  familiarity: Familiarity;
  covered: boolean;
}
export interface CoverageSlotDetail {
  /** 当值门将（该时段的守门人）。 */
  gkId: string;
  assignment: SlotAssignment[];
  covered: number;
  uncoveredSlots: Position[];
}
export interface TeamCoverage {
  team: TeamId;
  slots: CoverageSlotDetail[];
  /** 最弱时段覆盖：全部时段里最差一个时段的覆盖数。 */
  weakest: number;
  /** 未覆盖总数：全部时段缺口之和。 */
  totalUncovered: number;
}

/**
 * 7 名外场球员对 7 个槽位的完整分配（位掩码 DP，先最大覆盖、再最小总代价）。
 * 不适合（unsuitable）禁止分配；应急/未评估只作未覆盖槽位填充。
 */
export function assignOutfield(
  players: { id: string; familiarity: Record<Position, Familiarity> }[],
  slots: Position[] = OUTFIELD_SLOTS,
): { assignment: SlotAssignment[]; covered: number; totalCost: number } | null {
  const n = slots.length;
  if (players.length !== n) return null;
  // dp[mask] = { covered, cost, prev }，mask 表示已用的球员下标集合；第 popcount(mask) 个槽位待填。
  interface State { covered: number; cost: number; choice: number; prevMask: number }
  const dp = new Map<number, State>();
  dp.set(0, { covered: 0, cost: 0, choice: -1, prevMask: -1 });
  const popcount = (x: number) => { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; };
  for (let mask = 0; mask < (1 << n); mask++) {
    const cur = dp.get(mask);
    if (!cur) continue;
    const slotIdx = popcount(mask);
    if (slotIdx >= n) continue;
    const slot = slots[slotIdx];
    for (let j = 0; j < n; j++) {
      if (mask & (1 << j)) continue;
      const fam = players[j].familiarity[slot];
      const cost = FAMILIARITY_COST[fam];
      if (!Number.isFinite(cost)) continue; // 不适合禁止分配
      const nextMask = mask | (1 << j);
      const cand = { covered: cur.covered + (coversSlot(fam) ? 1 : 0), cost: cur.cost + cost, choice: j, prevMask: mask };
      const prev = dp.get(nextMask);
      if (!prev || cand.covered > prev.covered || (cand.covered === prev.covered && cand.cost < prev.cost)) {
        dp.set(nextMask, cand);
      }
    }
  }
  const full = dp.get((1 << n) - 1);
  if (!full) return null;
  const assignment: SlotAssignment[] = [];
  let mask = (1 << n) - 1;
  const chosen: number[] = new Array(n).fill(-1);
  while (mask !== 0) {
    const st = dp.get(mask)!;
    const slotIdx = popcount(mask) - 1;
    chosen[slotIdx] = st.choice;
    mask = st.prevMask;
  }
  for (let i = 0; i < n; i++) {
    const p = players[chosen[i]];
    const fam = p.familiarity[slots[i]];
    assignment.push({ slot: slots[i], playerId: p.id, familiarity: fam, covered: coversSlot(fam) });
  }
  return { assignment, covered: full.covered, totalCost: full.cost };
}

/** 一队的守门轮换时段：固定守门的人只有 1 个时段（整场都是他）；否则每位能轮守门的人各 1 个时段。 */
export function gkTurns(
  teamIds: string[],
  statuses: Record<string, MatchDayStatus>,
): string[] {
  const gkOnly = teamIds.find((id) => statuses[id]?.gkOnly);
  if (gkOnly) return [gkOnly];
  return teamIds.filter((id) => !statuses[id]?.cannotKeepGoal);
}

/** 一队的全部时段覆盖明细。 */
export function evaluateTeamCoverage(
  team: TeamId,
  teamIds: string[],
  playersById: Map<string, Player>,
  statuses: Record<string, MatchDayStatus>,
): TeamCoverage {
  const turns = gkTurns(teamIds, statuses);
  const slots: CoverageSlotDetail[] = [];
  for (const gkId of turns) {
    const outfield = teamIds.filter((id) => id !== gkId).map((id) => playersById.get(id)!);
    const res = assignOutfield(outfield);
    if (!res) {
      slots.push({ gkId, assignment: [], covered: 0, uncoveredSlots: [...OUTFIELD_SLOTS] });
      continue;
    }
    slots.push({
      gkId,
      assignment: res.assignment,
      covered: res.covered,
      uncoveredSlots: res.assignment.filter((a) => !a.covered).map((a) => a.slot),
    });
  }
  const weakest = slots.length ? Math.min(...slots.map((s) => s.covered)) : 0;
  const totalUncovered = slots.reduce((s, x) => s + (OUTFIELD_SLOTS.length - x.covered), 0);
  return { team, slots, weakest, totalUncovered };
}

export interface CoverageRanked {
  abilityRank: number;
  metrics: TeamMetrics;
  dark: TeamCoverage;
  light: TeamCoverage;
  /** 最弱时段覆盖（两队时段里最差的一个）。 */
  weakest: number;
  /** 未覆盖总数（两队全部时段缺口之和）。 */
  totalUncovered: number;
}

/**
 * 推荐排序：先按能力取前 10 名，再在前 10 里按覆盖排序取前 3 名。
 * 覆盖排序键：最弱时段覆盖（高→低）、未覆盖总数（少→多）、能力排名（前→后）。
 */
export function rankByCoverage(
  abilityTop10: { rank: number; metrics: TeamMetrics }[],
  playersById: Map<string, Player>,
  statuses: Record<string, MatchDayStatus>,
): CoverageRanked[] {
  const ranked: CoverageRanked[] = abilityTop10.map(({ rank, metrics }) => {
    const dark = evaluateTeamCoverage('dark', metrics.teamA, playersById, statuses);
    const light = evaluateTeamCoverage('light', metrics.teamB, playersById, statuses);
    return {
      abilityRank: rank, metrics, dark, light,
      weakest: Math.min(dark.weakest, light.weakest),
      totalUncovered: dark.totalUncovered + light.totalUncovered,
    };
  });
  ranked.sort((a, b) =>
    b.weakest - a.weakest ||
    a.totalUncovered - b.totalUncovered ||
    a.abilityRank - b.abilityRank);
  return ranked.slice(0, 3);
}

export function slotLabel(slot: Position): string { return POSITION_LABEL[slot]; }
