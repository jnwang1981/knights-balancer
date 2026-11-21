import { useCallback, useEffect, useState } from 'react';
import type { AppData } from './types';
import { STORAGE_KEY } from './types';
import { seedData } from './seed';
import { loadStored, saveStored } from './storage';

/** localStorage 持久化：首次启动写入 16 名虚构示例球员，之后绝不覆盖已保存数据。 */
export function useStore() {
  const [data, setData] = useState<AppData>(() => {
    const { data: stored, corrupted } = loadStored();
    if (stored) return stored;
    if (corrupted) {
      sessionStorage.setItem('knights-corrupt', corrupted);
      return seedData();
    }
    return seedData();
  });
  const [corruptMsg, setCorruptMsg] = useState<string | null>(() => sessionStorage.getItem('knights-corrupt'));
  const [saveError, setSaveError] = useState<string | null>(null);

  // 首次写入种子（仅当本地无数据时）
  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      const r = saveStored(data);
      if (!r.ok) setSaveError(r.error ?? '保存失败');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((fn: (d: AppData) => AppData) => {
    setData((prev) => {
      const next = fn(prev);
      const r = saveStored(next);
      if (!r.ok) setSaveError(r.error ?? '保存失败（存储空间不足或被禁用）');
      else setSaveError(null);
      return next;
    });
  }, []);

  const resetToSeed = useCallback(() => {
    const fresh = seedData();
    const r = saveStored(fresh);
    if (!r.ok) setSaveError(r.error ?? '保存失败');
    setData(fresh);
  }, []);

  return { data, update, resetToSeed, saveError, corruptMsg, setCorruptMsg };
}
