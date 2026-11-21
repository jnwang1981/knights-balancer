import { describe, expect, it } from 'vitest';
import { ABILITY_KEYS, POSITIONS } from './types';
import { seedData } from './seed';
import { isValidScore } from './validation';

// 内置 16 名虚构球员的完整名单（白名单）：种子数据必须且只能是这些人。
const FAKE_NAMES = [
  '陈大炮', '赵铁柱', '李二狗', '张阿飞', '王石头', '刘阿坤', '周阿杰', '孙阿明',
  '吴阿豪', '郑阿强', '胡阿亮', '林阿威', '徐阿松', '何阿南', '罗阿北', '高阿东',
];

describe('fake seed data (16 invented players)', () => {
  it('has exactly 16 players, 8 per baseline team', () => {
    const d = seedData();
    expect(d.players).toHaveLength(16);
    expect(d.baseline.dark).toHaveLength(8);
    expect(d.baseline.light).toHaveLength(8);
    expect(new Set(d.players.map((p) => p.id)).size).toBe(16);
  });
  it('contains exactly the 16 invented fake players, nothing else', () => {
    const names = seedData().players.map((p) => p.name).sort();
    expect(names).toEqual([...FAKE_NAMES].sort());
  });
  it('all ratings are valid (1–5, 0.5 steps, none empty in seed)', () => {
    for (const p of seedData().players) {
      for (const k of ABILITY_KEYS) expect(isValidScore(p.scores[k])).toBe(true);
      expect(p.scores.goalkeeping).not.toBeNull();
    }
  });
  it('each baseline team has a confirmed pivot and organizer', () => {
    const d = seedData();
    for (const t of ['dark', 'light'] as const) {
      const team = d.players.filter((p) => p.baselineTeam === t);
      expect(team.some((p) => p.canPivot === 'yes')).toBe(true);
      expect(team.some((p) => p.canOrganize === 'yes')).toBe(true);
    }
  });
  it('familiarity: primary is expert, secondary is familiar, all 8 positions present', () => {
    for (const p of seedData().players) {
      expect(Object.keys(p.familiarity)).toHaveLength(8);
      for (const pos of POSITIONS) expect(p.familiarity[pos]).toBeDefined();
      if (p.primaryPosition) expect(p.familiarity[p.primaryPosition]).toBe('expert');
      for (const s of p.secondaryPositions) expect(p.familiarity[s]).toBe('familiar');
    }
  });
  it('every player is marked as fake sample data', () => {
    for (const p of seedData().players) {
      expect(p.ratingBasis).toBe('示例数据');
      expect(p.notes).toContain('虚构');
    }
  });
});
