import { OUTFIELD_KEYS, type AbilityKey, type MatchDayStatus, type Player, type TeamId } from './types';
import { effectiveScores } from './matchday';

export interface GkSlot {
  index: number;
  durationMinutes: number;
  gk: Record<TeamId, { playerId: string; gkScore: number | null }>;
  /** 外场平均分差（两队各去掉当值门将后，按当场有效评分）。 */
  outfieldDeltas: Record<AbilityKey, number>;
  maxOutfieldDelta: number;
  maxOutfieldKey: AbilityKey;
  roleCoverage: Record<TeamId, { pivot: 'covered' | 'unconfirmed' | 'none-confirmed'; organize: 'covered' | 'unconfirmed' | 'none-confirmed' }>;
}
function roleStatus(ids: string[], byId: Map<string, Player>, field: 'canPivot' | 'canOrganize'): 'covered' | 'unconfirmed' | 'none-confirmed' {
  if (ids.some((id) => byId.get(id)?.[field] === 'yes')) return 'covered';
  if (ids.some((id) => byId.get(id)?.[field] === 'unknown')) return 'unconfirmed';
  return 'none-confirmed';
}
export const ROLE_STATUS_LABEL = { covered: '已确认覆盖', unconfirmed: '未能确认覆盖', 'none-confirmed': '已确认无人覆盖' } as const;

/**
 * 守门轮换展示：每队 8 个时段、时长相等。
 * - 有因伤只能守门的人：该队 8 个时段都是他守门。
 * - 否则按该队能轮守门的人循环（勾了「因伤不能守门」的不进轮换），排满 8 个时段。
 * 门将分不与外场分相加。
 */
export function computeGkRotation(
  teams: Record<TeamId, string[]>,
  players: Player[],
  statuses: Record<string, MatchDayStatus>,
  durationMinutes: number,
): GkSlot[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const m = teams.dark.length;
  const slotDur = durationMinutes / m;
  const orderFor = (t: TeamId): string[] => {
    const ids = teams[t];
    const fixed = ids.find((id) => statuses[id]?.gkOnly);
    if (fixed) return Array(m).fill(fixed);
    const eligible = ids.filter((id) => !statuses[id]?.cannotKeepGoal);
    if (eligible.length === 0) return Array(m).fill(ids[0]);
    const out: string[] = [];
    for (let i = 0; i < m; i++) out.push(eligible[i % eligible.length]);
    return out;
  };
  const orders: Record<TeamId, string[]> = { dark: orderFor('dark'), light: orderFor('light') };
  const slots: GkSlot[] = [];
  for (let i = 0; i < m; i++) {
    const gkIds: Record<TeamId, string> = { dark: orders.dark[i], light: orders.light[i] };
    const outfield: Record<TeamId, string[]> = {
      dark: teams.dark.filter((id) => id !== gkIds.dark),
      light: teams.light.filter((id) => id !== gkIds.light),
    };
    const deltas = {} as Record<AbilityKey, number>;
    const avgs: Record<TeamId, Record<AbilityKey, number>> = { dark: {} as Record<AbilityKey, number>, light: {} as Record<AbilityKey, number> };
    for (const k of OUTFIELD_KEYS) {
      for (const t of ['dark', 'light'] as TeamId[]) {
        const vals = outfield[t].map((id) => {
          const p = byId.get(id)!;
          return effectiveScores(p, statuses[id] ?? { fatigue: 'normal', injury: 'none', cannotKeepGoal: false, gkOnly: false, note: '' })[k];
        });
        const nums = vals.filter((v): v is number => v !== null);
        avgs[t][k] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : NaN;
      }
      deltas[k] = Math.abs(avgs.dark[k] - avgs.light[k]);
    }
    const maxKey = OUTFIELD_KEYS.reduce((a, b) => (deltas[b] > deltas[a] ? b : a));
    slots.push({
      index: i, durationMinutes: slotDur,
      gk: {
        dark: { playerId: gkIds.dark, gkScore: byId.get(gkIds.dark)?.scores.goalkeeping ?? null },
        light: { playerId: gkIds.light, gkScore: byId.get(gkIds.light)?.scores.goalkeeping ?? null },
      },
      outfieldDeltas: deltas, maxOutfieldDelta: deltas[maxKey], maxOutfieldKey: maxKey,
      roleCoverage: {
        dark: { pivot: roleStatus(outfield.dark, byId, 'canPivot'), organize: roleStatus(outfield.dark, byId, 'canOrganize') },
        light: { pivot: roleStatus(outfield.light, byId, 'canPivot'), organize: roleStatus(outfield.light, byId, 'canOrganize') },
      },
    });
  }
  return slots;
}
