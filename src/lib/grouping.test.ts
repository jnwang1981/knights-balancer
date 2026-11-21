import { describe, expect, it } from 'vitest';
import { defaultMatchDayStatus } from './types';
import { effectiveScores } from './matchday';
import { evaluatePartition, groupPlayers } from './grouping';
import { seedData } from './seed';

function inputs(gkOnlyIds: string[] = []) {
  return seedData().players.map((p) => ({
    id: p.id,
    scores: effectiveScores(p, defaultMatchDayStatus()),
    canPivot: p.canPivot,
    canOrganize: p.canOrganize,
    gkOnly: gkOnlyIds.includes(p.id),
  }));
}

describe('grouping v1.6 (fake 16)', () => {
  it('enumerates 6435, has feasible groupings, returns ability top 10 in order', () => {
    const res = groupPlayers(inputs(), { requirePivot: true, requireOrganize: true });
    expect(res.totalEnumerated).toBe(6435);
    expect(res.feasibleCount).toBeGreaterThan(0);
    expect(res.candidates).toHaveLength(10);
    for (let i = 1; i < res.candidates.length; i++) {
      expect(res.candidates[i - 1].metrics.maxDelta).toBeLessThanOrEqual(res.candidates[i].metrics.maxDelta + 1e-9);
    }
  });

  it('one gkOnly player: their team averages over 7, opponent over 8', () => {
    const gkOnlyId = seedData().players[0].id;
    const res = groupPlayers(inputs([gkOnlyId]), { requirePivot: true, requireOrganize: true });
    expect(res.feasibleCount).toBeGreaterThan(0);
    const withGk = res.candidates.find((c) =>
      c.metrics.teamA.includes(gkOnlyId) || c.metrics.teamB.includes(gkOnlyId));
    expect(withGk).toBeDefined();
    if (withGk!.metrics.teamA.includes(gkOnlyId)) {
      expect(withGk!.metrics.outfieldCount.dark).toBe(7);
      expect(withGk!.metrics.outfieldCount.light).toBe(8);
    } else {
      expect(withGk!.metrics.outfieldCount.light).toBe(7);
      expect(withGk!.metrics.outfieldCount.dark).toBe(8);
    }
  });

  it('two gkOnly players on the same team are infeasible', () => {
    const [a, b] = seedData().players.slice(0, 2).map((p) => p.id);
    const res = groupPlayers(inputs([a, b]), { requirePivot: true, requireOrganize: true });
    const bad = res.candidates.some((c) =>
      (c.metrics.teamA.includes(a) && c.metrics.teamA.includes(b)) ||
      (c.metrics.teamB.includes(a) && c.metrics.teamB.includes(b)));
    expect(bad).toBe(false);
    // 且两人分开时仍有可行方案
    expect(res.feasibleCount).toBeGreaterThan(0);
  });

  it('pivot/organizer constraints count only outfield players', () => {
    // 直接测 evaluatePartition：深黑 8 人里唯一的支点郑阿强当固定守门人 → 深黑无外场支点，不可行；
    // 同一套人、郑阿强不固定守门 → 他算支点，可行。
    const seed = seedData();
    const byName = (n: string) => seed.players.find((p) => p.name === n)!;
    const zheng = byName('郑阿强');
    const zhao = byName('赵铁柱');
    const teamA = [zheng, byName('吴阿豪'), byName('胡阿亮'), byName('林阿威'), byName('徐阿松'), byName('何阿南'), byName('罗阿北'), byName('高阿东')].map((p) => p.id);
    const teamB = seed.players.filter((p) => !teamA.includes(p.id)).map((p) => p.id);
    expect(teamB).toContain(zhao.id); // 浅蓝（teamB）有赵铁柱担支点
    const mk = (gkOnly: boolean) => {
      const all = seed.players.map((p) => ({
        id: p.id, scores: effectiveScores(p, defaultMatchDayStatus()),
        canPivot: p.canPivot, canOrganize: p.canOrganize, gkOnly: gkOnly && p.id === zheng.id,
      }));
      return new Map(all.map((p) => [p.id, p]));
    };
    const ids = seed.players.map((p) => p.id).sort();
    const blocked = evaluatePartition([...teamA].sort(), ids, mk(true), true, false);
    expect(blocked.constraintOk).toBe(false);
    expect(blocked.constraintIssues.join('')).toContain('深黑队没有已确认的后场支点');
    const ok = evaluatePartition([...teamA].sort(), ids, mk(false), true, false);
    expect(ok.constraintOk).toBe(true);
  });

  it('odd count and missing scores block grouping', () => {
    const odd = groupPlayers(inputs().slice(0, 15), { requirePivot: true, requireOrganize: true });
    expect(odd.blockedReason).toMatch(/奇数/);
    const broken = inputs();
    broken[0] = { ...broken[0], scores: { ...broken[0].scores, speed: null } };
    const res = groupPlayers(broken, { requirePivot: true, requireOrganize: true });
    expect(res.blockedReason).toMatch(/缺少外场评分/);
  });

  it('a gkOnly player with missing outfield scores does not block grouping', () => {
    const broken = inputs();
    broken[0] = { ...broken[0], scores: { ...broken[0].scores, speed: null }, gkOnly: true };
    const res = groupPlayers(broken, { requirePivot: true, requireOrganize: true });
    expect(res.blockedReason).toBeNull();
    expect(res.feasibleCount).toBeGreaterThan(0);
  });

  it('7-vs-8 average math: evaluatePartition matches hand computation', () => {
    const seed = seedData();
    const gkOnlyId = seed.players[0].id; // 陈大炮，速度 4
    const all = inputs([gkOnlyId]);
    const byId = new Map(all.map((p) => [p.id, p]));
    const ids = all.map((p) => p.id).sort();
    const teamA = [gkOnlyId, ...ids.filter((id) => id !== gkOnlyId).slice(0, 7)].sort();
    const met = evaluatePartition(teamA, ids, byId, false, false);
    // 陈大炮在深黑且不踢外场：深黑外场 7 人；速度和应为其余 7 人速度之和（不含陈大炮的 4）
    const others = seed.players.filter((p) => teamA.includes(p.id) && p.id !== gkOnlyId);
    const sumSpeed = others.reduce((s, p) => s + (p.scores.speed ?? 0) * 2, 0);
    expect(met.averages.dark.speed).toBeCloseTo(sumSpeed / (2 * 7), 9);
    expect(met.outfieldCount.dark).toBe(7);
  });
});
