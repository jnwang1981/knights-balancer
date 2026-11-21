import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('App smoke (v1.6)', () => {
  it('loads with v1.6 header and 16 fake players, no console errors', async () => {
    const errors: unknown[] = [];
    const spy = console.error.bind(console);
    console.error = (...args: unknown[]) => { errors.push(args); spy(...args); };
    try {
      localStorage.clear();
      const { unmount } = render(<App />);
      expect(screen.getByText(/版本 v1\.6/)).toBeTruthy();
      expect(screen.getByText(/pos-v1\.6/)).toBeTruthy();
      expect(document.body.textContent).not.toContain('试行规则');
      // 球员档案默认显示 16 名示例球员
      expect(screen.getByText('陈大炮')).toBeTruthy();
      expect(screen.getByText('高阿东')).toBeTruthy();
      unmount();
    } finally {
      console.error = spy;
    }
    expect(errors).toEqual([]);
  });

  it('match tab defaults: everyone 正常 / 无伤病, both checkboxes unchecked', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: '本场分组' }));
    // 找到第一位球员（陈大炮）的两个下拉与两个勾选
    const fatigueSelects = screen.getAllByLabelText('当天状态');
    const injurySelects = screen.getAllByLabelText('伤病');
    expect(fatigueSelects.length).toBe(16);
    expect(injurySelects.length).toBe(16);
    for (const s of fatigueSelects) expect((s as HTMLSelectElement).value).toBe('normal');
    for (const s of injurySelects) expect((s as HTMLSelectElement).value).toBe('none');
    const cannotBoxes = screen.getAllByLabelText(/因伤不能守门/);
    const onlyBoxes = screen.getAllByLabelText(/因伤只能守门/);
    expect(cannotBoxes).toHaveLength(16);
    expect(onlyBoxes).toHaveLength(16);
    for (const b of cannotBoxes) expect((b as HTMLInputElement).checked).toBe(false);
    for (const b of onlyBoxes) {
      expect((b as HTMLInputElement).checked).toBe(false);
      expect((b as HTMLInputElement).disabled).toBe(true); // 无伤病时只能守门不可勾
    }
    for (const b of cannotBoxes) expect((b as HTMLInputElement).disabled).toBe(false); // 不能守门任何时候都能勾
    unmount();
  });

  it('generating a grouping shows 3 recommended schemes', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: '本场分组' }));
    await user.click(screen.getByRole('button', { name: '生成分组' }));
    expect(await screen.findByText(/推荐方案/)).toBeTruthy();
    expect(screen.getByText(/枚举总数 6435/)).toBeTruthy();
    unmount();
  });

  it('switching recommended schemes keeps each scheme display order stable', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: '本场分组' }));
    await user.click(screen.getByRole('button', { name: '生成分组' }));
    await screen.findByText(/推荐方案/);
    const notice = () => document.querySelector('pre.notice')?.textContent ?? '';
    const first = notice(); // 默认选中覆盖第 1 名
    expect(first).toContain('深黑队');
    expect(first).toContain('浅蓝队');
    await user.click(screen.getByRole('button', { name: /推荐 2/ }));
    const second = notice();
    expect(second).not.toBe(first); // 不同方案，名单不同
    await user.click(screen.getByRole('button', { name: /推荐 1/ }));
    // 切回推荐 1：公告文本与第一次完全一致（显示顺序生成时已定死，不重抽）
    expect(notice()).toBe(first);
    unmount();
  });
});
