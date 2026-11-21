import { describe, expect, it } from 'vitest';
import { defaultMatchDayStatus, type Familiarity, type Position } from './types';
import { assignOutfield, evaluateTeamCoverage, gkTurns, rankByCoverage } from './positioning';
import { groupPlayers } from './grouping';
import { effectiveScores } from './matchday';
import { seedData } from './seed';

function fam(expert: string[], familiar: string[] = [], emergency: string[] = []): Record<Position, Familiarity> {
  const all: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'LM', 'RM', 'CF'];
  const o = {} as Record<Position, Familiarity>;
  for (const p of all) o[p] = 'unevaluated';
  for (const p of expert) o[p as Position] = 'expert';
  for (const p of familiar) o[p as Position] = 'familiar';
  for (const p of emergency) o[p as Position] = 'emergency';
  return o;
}

describe('assignOutfield DP', () => {
  it('maximizes coverage then minimizes cost', () => {
    const players = [
      { id: 'a', familiarity: fam(['CB'], ['LB']) },
      { id: 'b', familiarity: fam(['LB'], ['RB']) },
      { id: 'c', familiarity: fam(['RB'], ['DM']) },
      { id: 'd', familiarity: fam(['DM'], ['LM']) },
      { id: 'e', familiarity: fam(['LM'], ['RM']) },
      { id: 'f', familiarity: fam(['RM'], ['CF']) },
      { id: 'g', familiarity: fam(['CF'], []) },
    ];
    const res = assignOutfield(players);
    expect(res).not.toBeNull();
    expect(res!.covered).toBe(7);
    expect(res!.totalCost).toBe(0);
  });
  it('emergency/unevaluated fill but never count as coverage; unsuitable is forbidden', () => {
    const players = [
      { id: 'a', familiarity: fam(['CB'], [], ['LB']) },
      { id: 'b', familiarity: fam(['LB'], [], ['RB']) },
      { id: 'c', familiarity: fam(['RB'], [], ['DM']) },
      { id: 'd', familiarity: fam(['DM'], [], ['LM']) },
      { id: 'e', familiarity: fam(['LM'], [], ['RM']) },
      { id: 'f', familiarity: fam(['RM'], [], ['CF']) },
      { id: 'g', familiarity: (() => { const f = fam(['CF']); f.LB = 'unsuitable'; return f; })() },
    ];
    const res = assignOutfield(players);
    expect(res).not.toBeNull();
    // 每人只有擅长 1 个位置且互不相同 → 7 覆盖；应急只在无路可走时填，本例不需要
    expect(res!.covered).toBe(7);
  });
  it('no mirroring: LB expert does not cover RB', () => {
    const players = [
      { id: 'a', familiarity: fam(['LB']) },
      { id: 'b', familiarity: fam(['LB']) },
      { id: 'c', familiarity: fam(['LB']) },
      { id: 'd', familiarity: fam(['LB']) },
      { id: 'e', familiarity: fam(['LB']) },
      { id: 'f', familiarity: fam(['LB']) },
      { id: 'g', familiarity: fam(['LB']) },
    ];
    const res = assignOutfield(players);
    expect(res).not.toBeNull();
    expect(res!.covered).toBe(1); // 只有 LB 槽位有人擅长
    expect(res!.totalCost).toBeGreaterThan(0);
  });
});

describe('coverage ranking (v1.6)', () => {
  it('fake 16: top-3 by coverage ordered weakest desc, uncovered asc', () => {
    const seed = seedData();
    const inputs = seed.players.map((p) => ({
      id: p.id, scores: effectiveScores(p, defaultMatchDayStatus()),
      canPivot: p.canPivot, canOrganize: p.canOrganize, gkOnly: false,
    }));
    const res = groupPlayers(inputs, { requirePivot: true, requireOrganize: true });
    const byId = new Map(seed.players.map((p) => [p.id, p]));
    const ranked = rankByCoverage(res.candidates, byId, {});
    expect(ranked).toHaveLength(3);
    for (let i = 1; i < ranked.length; i++) {
      const a = ranked[i - 1], b = ranked[i];
      expect(a.weakest > b.weakest || (a.weakest === b.weakest && a.totalUncovered <= b.totalUncovered)).toBe(true);
    }
    expect(ranked[0].weakest).toBeGreaterThanOrEqual(5);
  });

  it('gkTurns: gkOnly team has exactly 1 turn; cannotKeepGoal excluded', () => {
    const ids = seedData().players.slice(0, 8).map((p) => p.id);
    expect(gkTurns(ids, {})).toHaveLength(8);
    expect(gkTurns(ids, { [ids[0]]: { ...defaultMatchDayStatus(), cannotKeepGoal: true } })).toHaveLength(7);
    expect(gkTurns(ids, { [ids[0]]: { ...defaultMatchDayStatus(), injury: 'playingHurt', gkOnly: true } })).toEqual([ids[0]]);
  });

  it('evaluateTeamCoverage with gkOnly: 1 slot, coverage on the other 7', () => {
    const seed = seedData();
    const byId = new Map(seed.players.map((p) => [p.id, p]));
    const ids = seed.players.slice(0, 8).map((p) => p.id);
    const cov = evaluateTeamCoverage('dark', ids, byId, { [ids[0]]: { ...defaultMatchDayStatus(), injury: 'playingHurt', gkOnly: true } });
    expect(cov.slots).toHaveLength(1);
    expect(cov.slots[0].gkId).toBe(ids[0]);
    expect(cov.slots[0].assignment.every((a) => a.playerId !== ids[0])).toBe(true);
    expect(cov.weakest).toBe(cov.slots[0].covered);
  });
});
