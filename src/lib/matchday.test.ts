import { describe, expect, it } from 'vitest';
import type { MatchDayStatus, Player } from './types';
import { defaultMatchDayStatus } from './types';
import { applyStatusPatch, effectiveScores, normalizeStatus } from './matchday';
import { seedData } from './seed';

const base = (): MatchDayStatus => defaultMatchDayStatus();
const player = (): Player => seedData().players[0]; // 陈大炮：速度 4、体能 3.5、无球 4.5、回防 2.5、守门 2

describe('matchday deductions (v1.5 table)', () => {
  it('normal + no injury = unchanged', () => {
    const eff = effectiveScores(player(), base());
    expect(eff.speed).toBe(4);
    expect(eff.stamina).toBe(3.5);
    expect(eff.goalkeeping).toBe(2);
  });
  it('slightly fatigued: stamina −0.5 only', () => {
    const eff = effectiveScores(player(), { ...base(), fatigue: 'slightly' });
    expect(eff.stamina).toBe(3);
    expect(eff.speed).toBe(4);
  });
  it('clearly fatigued + playing hurt stack: stamina −2, speed −1, offBall/covering −0.5, GK untouched', () => {
    const eff = effectiveScores(player(), { ...base(), fatigue: 'clearly', injury: 'playingHurt' });
    expect(eff.stamina).toBe(1.5);
    expect(eff.speed).toBe(3);
    expect(eff.offBall).toBe(4);
    expect(eff.covering).toBe(2);
    expect(eff.goalkeeping).toBe(2);
  });
  it('minor injury: speed/stamina −0.5', () => {
    const eff = effectiveScores(player(), { ...base(), injury: 'minor' });
    expect(eff.speed).toBe(3.5);
    expect(eff.stamina).toBe(3);
    expect(eff.offBall).toBe(4.5);
  });
  it('unknown fatigue does not deduct', () => {
    const eff = effectiveScores(player(), { ...base(), fatigue: 'unknown' });
    expect(eff.stamina).toBe(3.5);
  });
  it('floor is 1 per item', () => {
    const p = player();
    p.scores.stamina = 1.5; p.scores.speed = 1;
    const eff = effectiveScores(p, { ...base(), fatigue: 'clearly', injury: 'playingHurt' });
    expect(eff.stamina).toBe(1);
    expect(eff.speed).toBe(1);
  });
  it('empty stays empty', () => {
    const p = player();
    p.scores.speed = null; p.scores.stamina = null;
    const eff = effectiveScores(p, { ...base(), fatigue: 'clearly', injury: 'playingHurt' });
    expect(eff.speed).toBeNull();
    expect(eff.stamina).toBeNull();
  });
});

describe('v1.6 goalkeeper checkboxes', () => {
  it('cannotKeepGoal can be checked with no injury and survives injury changes', () => {
    let s = applyStatusPatch(base(), { cannotKeepGoal: true });
    expect(s.cannotKeepGoal).toBe(true);
    s = applyStatusPatch(s, { injury: 'minor' });
    expect(s.cannotKeepGoal).toBe(true);
    s = applyStatusPatch(s, { injury: 'none' });
    expect(s.cannotKeepGoal).toBe(true);
  });
  it('gkOnly only when playing hurt; mutual exclusion; auto-clear on injury change', () => {
    // 无伤病时勾不上
    expect(applyStatusPatch(base(), { gkOnly: true }).gkOnly).toBe(false);
    // 带伤上场勾上
    let s = applyStatusPatch(base(), { injury: 'playingHurt', gkOnly: true });
    expect(s.gkOnly).toBe(true);
    expect(s.cannotKeepGoal).toBe(false);
    // 勾 cannotKeepGoal 取消 gkOnly
    s = applyStatusPatch(s, { cannotKeepGoal: true });
    expect(s.cannotKeepGoal).toBe(true);
    expect(s.gkOnly).toBe(false);
    // 再勾 gkOnly 取消 cannotKeepGoal
    s = applyStatusPatch(s, { gkOnly: true });
    expect(s.gkOnly).toBe(true);
    expect(s.cannotKeepGoal).toBe(false);
    // 伤病改回轻伤自动取消
    s = applyStatusPatch(s, { injury: 'minor' });
    expect(s.gkOnly).toBe(false);
  });
  it('normalizeStatus clears gkOnly when injury leaves playing hurt', () => {
    const s = normalizeStatus({ ...base(), injury: 'minor', gkOnly: true });
    expect(s.gkOnly).toBe(false);
  });
  it('defaults are normal / no injury / both unchecked', () => {
    const d = defaultMatchDayStatus();
    expect(d).toEqual({ fatigue: 'normal', injury: 'none', cannotKeepGoal: false, gkOnly: false, note: '' });
  });
});
