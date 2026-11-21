import type { GoalEvent, MatchRecord, Player, TeamId } from './types';

export interface EventValidationError { field: string; message: string; }

/** 逐球事件校验：副助攻须有主助攻；同一普通进球三人不能重复；须属于进球方名单；乌龙责任球员须属于对方。 */
export function validateGoalEvent(
  ev: Omit<GoalEvent, 'id'>,
  teams: Record<TeamId, string[]>,
): EventValidationError[] {
  const errs: EventValidationError[] = [];
  if (ev.isOwnGoal) {
    if (ev.ownGoalPlayerId) {
      const opp: TeamId = ev.team === 'dark' ? 'light' : 'dark';
      if (!teams[opp].includes(ev.ownGoalPlayerId)) errs.push({ field: 'ownGoalPlayerId', message: '乌龙责任球员必须属于对方名单' });
    }
    if (ev.scorerId || ev.primaryAssistId || ev.secondaryAssistId) errs.push({ field: 'scorerId', message: '乌龙球不计个人进球或助攻，请勿填写进球者/助攻者' });
    return errs;
  }
  if (!ev.scorerId) errs.push({ field: 'scorerId', message: '请填写进球者' });
  if (ev.secondaryAssistId && !ev.primaryAssistId) errs.push({ field: 'secondaryAssistId', message: '有副助攻时必须有主助攻' });
  const persons = [ev.scorerId, ev.primaryAssistId, ev.secondaryAssistId].filter(Boolean) as string[];
  if (new Set(persons).size !== persons.length) errs.push({ field: 'primaryAssistId', message: '同一进球的进球者、主助攻、副助攻不能重复' });
  for (const id of persons) {
    if (!teams[ev.team].includes(id)) errs.push({ field: 'scorerId', message: `球员 ${id} 不属于进球方名单` });
  }
  return errs;
}

export interface LeaderRow {
  playerId: string; goals: number; primary: number; secondary: number;
  assistPoints: number; total: number;
  outfieldMinutes: number | null;
  matchesWithMinutes: number; matchesPlayed: number;
  per60: number | null;
}

/** 榜单仅从事件计算。分钟：球员参加的每场比赛都有外场分钟才算完整，否则 per60 为 null。 */
export function computeLeaderboard(matches: MatchRecord[], scope: MatchRecord[] | null = null): LeaderRow[] {
  const list = scope ?? matches;
  const map = new Map<string, LeaderRow>();
  const ensure = (id: string): LeaderRow => {
    let r = map.get(id);
    if (!r) { r = { playerId: id, goals: 0, primary: 0, secondary: 0, assistPoints: 0, total: 0, outfieldMinutes: 0, matchesWithMinutes: 0, matchesPlayed: 0, per60: null }; map.set(id, r); }
    return r;
  };
  for (const m of list) {
    const all = [...m.teams.dark, ...m.teams.light];
    for (const id of all) {
      const r = ensure(id); r.matchesPlayed++;
      const min = m.minutes[id]?.outfield;
      if (min !== null && min !== undefined) { r.outfieldMinutes = (r.outfieldMinutes ?? 0) + min; r.matchesWithMinutes++; }
    }
    for (const ev of m.events) {
      if (ev.isOwnGoal) continue;
      if (ev.scorerId) ensure(ev.scorerId).goals++;
      if (ev.primaryAssistId) ensure(ev.primaryAssistId).primary++;
      if (ev.secondaryAssistId) ensure(ev.secondaryAssistId).secondary++;
    }
  }
  for (const r of map.values()) {
    r.assistPoints = r.primary + 0.5 * r.secondary;
    r.total = r.goals + r.assistPoints;
    const complete = r.matchesPlayed > 0 && r.matchesWithMinutes === r.matchesPlayed && (r.outfieldMinutes ?? 0) > 0;
    r.per60 = complete ? ((r.goals + r.primary + 0.5 * r.secondary) / (r.outfieldMinutes as number)) * 60 : null;
    if (!complete) r.outfieldMinutes = r.matchesWithMinutes === r.matchesPlayed ? r.outfieldMinutes : null;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.goals - a.goals || a.playerId.localeCompare(b.playerId));
}

export function eventsScore(match: MatchRecord): { dark: number; light: number } {
  let dark = 0, light = 0;
  for (const ev of match.events) { if (ev.team === 'dark') dark++; else light++; }
  return { dark, light };
}
export function scoreMismatch(match: MatchRecord): string | null {
  if (!match.finalScore) return null;
  const es = eventsScore(match);
  if (es.dark !== match.finalScore.dark || es.light !== match.finalScore.light) {
    return `手填比分 ${match.finalScore.dark}:${match.finalScore.light} 与逐球汇总 ${es.dark}:${es.light} 不一致，请核对（不会自动修改）。`;
  }
  return null;
}
export function lastNMatches(matches: MatchRecord[], n: number): MatchRecord[] {
  return [...matches].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, n);
}
export function playerName(players: Player[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? id;
}
