import type { TeamMetrics } from './grouping';

/**
 * 一套分组方案的展示数据：只决定名单在页面上怎么排、哪队叫深黑。
 * 不影响分队本身（谁跟谁一队）、能力 Δ、覆盖、守门轮换——所有计算仍用
 * metrics.teamA/teamB（ID 排序的规范表示），展示层绝不参与计算。
 */
export interface DisplayTeams {
  /** 显示为深黑队的球员 id（已随机打乱）。 */
  dark: string[];
  /** 显示为浅蓝队的球员 id（已随机打乱）。 */
  light: string[];
  /** true = metrics.teamB 显示为深黑、teamA 显示为浅蓝（抛硬币翻过面）。 */
  flipped: boolean;
}

/** Fisher-Yates 洗牌：返回新数组，不改动入参；random 可注入，便于测试。 */
export function shuffle<T>(arr: readonly T[], random: () => number = Math.random): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

/**
 * 生成一套方案的展示数据：每队内部名字单独打乱（Fisher-Yates），两队之间不混；
 * 再抛一次硬币决定哪队显示为深黑、哪队显示为浅蓝。
 * 同一套方案的展示数据生成一次后就存起来复用，切换查看时不再重抽。
 */
export function prepareDisplay(metrics: TeamMetrics, random: () => number = Math.random): DisplayTeams {
  const flipped = random() < 0.5;
  const a = shuffle(metrics.teamA, random);
  const b = shuffle(metrics.teamB, random);
  return flipped ? { dark: b, light: a, flipped } : { dark: a, light: b, flipped };
}

/**
 * 一次生成里全部能力候选的展示数据，按稳定组合键（metrics.sortKey[3]，即
 * 排序后的 teamA id 串，唯一标识一套分队）索引。生成分组时一次性建好，
 * 切换方案只查表，不重新抽。
 */
export function buildDisplayMap(
  candidates: readonly { metrics: TeamMetrics }[],
  random: () => number = Math.random,
): Record<string, DisplayTeams> {
  const map: Record<string, DisplayTeams> = {};
  for (const c of candidates) map[c.metrics.sortKey[3]] = prepareDisplay(c.metrics, random);
  return map;
}

/**
 * 取一套候选的展示数据。查不到时退回规范表示（teamA=深黑、teamB=浅蓝，不打乱），
 * 不现场重抽——保证切换查看时显示顺序不变。
 */
export function displayFor(metrics: TeamMetrics, map: Record<string, DisplayTeams>): DisplayTeams {
  return map[metrics.sortKey[3]] ?? { dark: [...metrics.teamA], light: [...metrics.teamB], flipped: false };
}
