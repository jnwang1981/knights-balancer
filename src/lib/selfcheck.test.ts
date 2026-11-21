import { describe, expect, it } from 'vitest';
import { runSelfCheck } from './selfcheck';
import { seedData } from './seed';
import { playersFromRows, templateWorkbook, parseCsv } from './excel';

describe('self-check (deep-copy, never leaks samples into defaults)', () => {
  it('passes on the fake 16 and does not mutate its input', () => {
    const players = seedData().players;
    const before = JSON.stringify(players);
    const res = runSelfCheck(players);
    expect(res.passed).toBe(true);
    expect(JSON.stringify(players)).toBe(before);
    expect(res.checks.length).toBeGreaterThanOrEqual(8);
  });
});

describe('excel template + import', () => {
  it('template workbook has the 17 Chinese headers and a guide sheet', () => {
    const wb = templateWorkbook();
    expect(wb.SheetNames).toContain('球员评分');
    expect(wb.SheetNames).toContain('填写说明');
    const ws = wb.Sheets['球员评分'];
    expect(ws['A1']?.v).toBe('姓名');
    expect(ws['Q1']?.v).toBe('能否承担组织接应（是/否/未知）');
  });
  it('playersFromRows round-trips the seed and rejects bad rows', () => {
    const { players, errors } = playersFromRows([
      { '姓名': '测试甲', '主位置': '中锋', '可兼任位置（多选）': '右边前卫', '技术': 4, '传球': 3.5, '进攻意识': 4, '防守意识': 3, '速度': 4, '无球跑动': 4, '体能': 3.5, '回防补位': 3, '守门': 2, '特点备注': '', '评分日期': '', '评分依据': '', '能否承担后场支点（是/否/未知）': '否', '能否承担组织接应（是/否/未知）': '未知' },
      { '姓名': '测试乙', '主位置': '火星', '可兼任位置（多选）': '', '技术': 4, '传球': 3, '进攻意识': 3, '防守意识': 3, '速度': 3, '无球跑动': 3, '体能': 3, '回防补位': 3, '守门': 3, '特点备注': '', '评分日期': '', '评分依据': '', '能否承担后场支点（是/否/未知）': '否', '能否承担组织接应（是/否/未知）': '否' },
    ]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('火星');
    expect(players).toHaveLength(1);
    expect(players[0].name).toBe('测试甲');
    expect(players[0].familiarity['CF']).toBe('expert');
    expect(players[0].familiarity['RM']).toBe('familiar');
  });
  it('parseCsv handles quotes and commas', () => {
    const rows = parseCsv('姓名,主位置,备注\n"测试,甲",中锋,"有，逗号"\n测试乙,后腰,');
    expect(rows).toHaveLength(2);
    expect(rows[0]['姓名']).toBe('测试,甲');
    expect(rows[0]['备注']).toBe('有，逗号');
  });
});
