import { describe, expect, it } from 'vitest';
import { defaultMatchDayStatus } from './types';
import { effectiveScores } from './matchday';
import { evaluatePartition, groupPlayers } from './grouping';
import { rankByCoverage } from './positioning';
import { seedData } from './seed';
import { buildDisplayMap, displayFor, prepareDisplay, shuffle } from './display';

const rotate = <T,>(arr: readonly T[]): T[] => [...arr.slice(1), arr[0]];

function inputs(gkOnlyIds: string[] = []) {
  return seedData().players.map((p) => ({
    id: p.id,
    scores: effectiveScores(p, defaultMatchDayStatus()),
    canPivot: p.canPivot,
    canOrganize: p.canOrganize,
    gkOnly: gkOnlyIds.includes(p.id),
  }));
}

describe('shuffle (Fisher-Yates)', () => {
  it('is a permutation: same members, new array, input untouched', () => {
    const src = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (let i = 0; i < 20; i++) {
      const out = shuffle(src);
      expect([...out].sort()).toEqual([...src].sort());
      expect(out).not.toBe(src);
    }
    expect(src).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
  it('deterministic with injected random: always j=0 rotates left by one', () => {
    expect(shuffle(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], () => 0))
      .toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h', 'a']);
  });
  it('deterministic with injected random: always j=i leaves order unchanged', () => {
    expect(shuffle(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], () => 0.999999))
      .toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
});

describe('prepareDisplay (random order + coin flip, display only)', () => {
  it('flipped=false: dark=teamA, light=teamB, members unchanged', () => {
    const res = groupPlayers(inputs(), { requirePivot: true, requireOrganize: true });
    const m = res.candidates[0].metrics;
    // random 恒 0.9：抛硬币 ≥0.5 不翻面，洗牌每步 j=i，顺序不变
    const d = prepareDisplay(m, () => 0.9);
    expect(d.flipped).toBe(false);
    expect(d.dark).toEqual(m.teamA);
    expect(d.light).toEqual(m.teamB);
  });
  it('flipped=true: dark=teamB shuffled, light=teamA shuffled', () => {
    const res = groupPlayers(inputs(), { requirePivot: true, requireOrganize: true });
    const m = res.candidates[0].metrics;
    // random 恒 0.1：抛硬币 <0.5 翻面，洗牌每步 j=0，左旋一位
    const d = prepareDisplay(m, () => 0.1);
    expect(d.flipped).toBe(true);
    expect(d.dark).toEqual(rotate(m.teamB));
    expect(d.light).toEqual(rotate(m.teamA));
  });
  it('never changes team membership: dark ∪ light = teamA ∪ teamB, 8 vs 8', () => {
    const res = groupPlayers(inputs(), { requirePivot: true, requireOrganize: true });
    for (const c of res.candidates) {
      const d = prepareDisplay(c.metrics);
      expect(d.dark).toHaveLength(8);
      expect(d.light).toHaveLength(8);
      expect([...d.dark, ...d.light].sort()).toEqual([...c.metrics.teamA, ...c.metrics.teamB].sort());
    }
  });
  it('coin flip really varies: 60 draws show both dark/light assignments', () => {
    const res = groupPlayers(inputs(), { requirePivot: true, requireOrganize: true });
    const m = res.candidates[0].metrics;
    const seen = new Set<boolean>();
    for (let i = 0; i < 60; i++) seen.add(prepareDisplay(m).flipped);
    expect(seen.has(true)).toBe(true);
    expect(seen.has(false)).toBe(true);
  });
  it('display order does not change computation: re-evaluating sorted display teams gives identical deltas', () => {
    const all = inputs();
    const byId = new Map(all.map((p) => [p.id, p]));
    const ids = all.map((p) => p.id).sort();
    const res = groupPlayers(all, { requirePivot: true, requireOrganize: true });
    for (const c of res.candidates.slice(0, 3)) {
      const d = prepareDisplay(c.metrics);
      const re = evaluatePartition([...d.dark].sort(), ids, byId, true, true);
      expect(re.maxDelta).toBeCloseTo(c.metrics.maxDelta, 9);
      expect(re.weighted).toBeCloseTo(c.metrics.weighted, 9);
      expect(re.sumDelta).toBeCloseTo(c.metrics.sumDelta, 9);
    }
  });
});

describe('buildDisplayMap / displayFor (stable per generation)', () => {
  it('one entry per candidate keyed by the stable combination key; displayFor reuses the stored object', () => {
    const res = groupPlayers(inputs(), { requirePivot: true, requireOrganize: true });
    const map = buildDisplayMap(res.candidates);
    expect(Object.keys(map)).toHaveLength(10);
    for (const c of res.candidates) {
      const d = displayFor(c.metrics, map);
      expect(d).toBe(map[c.metrics.sortKey[3]]); // 同一对象：切换查看不重抽
      expect([...d.dark, ...d.light].sort()).toEqual([...c.metrics.teamA, ...c.metrics.teamB].sort());
    }
  });
  it('missing key falls back to the canonical order without drawing randomness', () => {
    const res = groupPlayers(inputs(), { requirePivot: true, requireOrganize: true });
    const m = res.candidates[0].metrics;
    const d = displayFor(m, {});
    expect(d.flipped).toBe(false);
    expect(d.dark).toEqual(m.teamA);
    expect(d.light).toEqual(m.teamB);
  });
});

describe('baseline regression (fake 16, computation untouched by display change)', () => {
  it('enumerates 6435, feasible 4698, ability #1 deltas unchanged', () => {
    const res = groupPlayers(inputs(), { requirePivot: true, requireOrganize: true });
    expect(res.totalEnumerated).toBe(6435);
    expect(res.feasibleCount).toBe(4698);
    expect(res.candidates).toHaveLength(10);
    const top = res.candidates[0].metrics;
    expect(top.maxDelta).toBeCloseTo(0.0625, 9);
    expect(top.weighted).toBeCloseTo(0, 9);
    expect(top.sumDelta).toBeCloseTo(0.1875, 9);
  });
  it('coverage top 3 unchanged: ability ranks 3/5/6, weakest 6/7, uncovered 10', () => {
    const seed = seedData();
    const res = groupPlayers(inputs(), { requirePivot: true, requireOrganize: true });
    const byId = new Map(seed.players.map((p) => [p.id, p]));
    const ranked = rankByCoverage(res.candidates, byId, {});
    expect(ranked.map((r) => r.abilityRank)).toEqual([3, 5, 6]);
    for (const r of ranked) {
      expect(r.weakest).toBe(6);
      expect(r.totalUncovered).toBe(10);
    }
  });
});
