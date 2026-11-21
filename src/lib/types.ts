// 数据模型与规则集中定义。评分一律用 number|null，空值永不自动补 0 或 3。
// 版本 v1.6（位置规则 pos-v1.6）：位置规则不再带“试行”字样。
// 扣分幅度仍是试行参数，没有比赛数据支持（见 matchday.ts 注释）。

export type AbilityKey =
  | 'technique' | 'passing' | 'attackAwareness' | 'defenseAwareness'
  | 'speed' | 'offBall' | 'stamina' | 'covering' | 'goalkeeping';

export const ABILITY_KEYS: AbilityKey[] = [
  'technique','passing','attackAwareness','defenseAwareness','speed',
  'offBall','stamina','covering','goalkeeping',
];
export const OUTFIELD_KEYS: AbilityKey[] = [
  'technique','passing','attackAwareness','defenseAwareness','speed',
  'offBall','stamina','covering',
];
export const ABILITY_LABEL: Record<AbilityKey, string> = {
  technique: '技术', passing: '传球', attackAwareness: '进攻意识',
  defenseAwareness: '防守意识', speed: '速度', offBall: '无球跑动',
  stamina: '体能', covering: '回防补位', goalkeeping: '守门',
};
export const ABILITY_DESC: Record<AbilityKey, string> = {
  technique: '停球、控球、盘带、突破及射门执行质量，不重复评价传球。',
  passing: '准确性、力度和受压出球质量。',
  attackAwareness: '进攻决策、空间判断和行动时机。',
  defenseAwareness: '威胁判断、站位、盯人和封堵线路。',
  speed: '启动、加速、冲刺。',
  offBall: '实际接应、前插、拉开空间和牵制。',
  stamina: '持续运动、反复冲刺、恢复及后半场保持强度。',
  covering: '回追和补位的主动性及执行稳定性。',
  goalkeeping: '站位、扑救和出球。',
};

// ---- 位置（八人制只用这 8 个） ----
export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'DM' | 'LM' | 'RM' | 'CF';
export const POSITIONS: Position[] = ['GK','CB','LB','RB','DM','LM','RM','CF'];
export const POSITION_LABEL: Record<Position, string> = {
  GK: '守门员', CB: '中后卫', LB: '左边后卫', RB: '右边后卫',
  DM: '后腰', LM: '左边前卫', RM: '右边前卫', CF: '中锋',
};
/** 阵型 3-3-1 的 7 个外场槽位，与 Excel 位置一对一。守门员是第 8 个位置，只用于轮换。 */
export const OUTFIELD_SLOTS: Position[] = ['LB','CB','RB','LM','DM','RM','CF'];

/** 位置熟悉度：只有擅长/熟悉算覆盖；应急、未评估只作填充；不适合禁止分配。无左右镜像。 */
export type Familiarity = 'expert' | 'familiar' | 'emergency' | 'unevaluated' | 'unsuitable';
export const FAMILIARITY_LABEL: Record<Familiarity, string> = {
  expert: '擅长', familiar: '熟悉', emergency: '应急', unevaluated: '未评估', unsuitable: '不适合',
};
/** 分配代价：擅长 0、熟悉 1、应急 3、未评估 4、不适合禁止。 */
export const FAMILIARITY_COST: Record<Familiarity, number> = {
  expert: 0, familiar: 1, emergency: 3, unevaluated: 4, unsuitable: Infinity,
};
export function coversSlot(f: Familiarity): boolean {
  return f === 'expert' || f === 'familiar';
}

export type RoleValue = 'yes' | 'no' | 'unknown';
export type TeamId = 'dark' | 'light';

// ---- 当天状态与伤病（v1.5 引入，v1.6 沿用；全部只在当天页面内存里，永不保存） ----
export type Fatigue = 'normal' | 'slightly' | 'clearly' | 'unknown';
export const FATIGUE_LABEL: Record<Fatigue, string> = {
  normal: '正常', slightly: '稍疲劳', clearly: '明显疲劳', unknown: '未知',
};
export type Injury = 'none' | 'minor' | 'playingHurt';
export const INJURY_LABEL: Record<Injury, string> = {
  none: '无伤病', minor: '轻伤', playingHurt: '带伤上场',
};

export interface Player {
  id: string;
  name: string;
  primaryPosition: Position | null;
  secondaryPositions: Position[];
  /** 8 个位置的熟悉度（主位置=擅长、兼任=熟悉，其余默认未评估；教练可逐格改）。 */
  familiarity: Record<Position, Familiarity>;
  scores: Record<AbilityKey, number | null>;
  notes: string;
  ratingDate: string | null; // YYYY-MM-DD
  ratingBasis: string | null;
  canPivot: RoleValue;
  canOrganize: RoleValue;
  archived: boolean;
  baselineTeam: TeamId | null;
}

/** 当天状态：只在当天页面内存里（React state），不进 localStorage、不进比赛快照。 */
export interface MatchDayStatus {
  fatigue: Fatigue;
  injury: Injury;
  /** 因伤不能守门：任何时候都能勾（包括无伤病），不扣分，只不进守门顺序；改伤病不自动取消。 */
  cannotKeepGoal: boolean;
  /** 因伤只能守门：只有伤病=带伤上场才能勾；与 cannotKeepGoal 二选一；伤病改回轻伤/无伤病自动取消。 */
  gkOnly: boolean;
  note: string; // 活动限制 / 迟到 / 提前离场
}
export function defaultMatchDayStatus(): MatchDayStatus {
  return { fatigue: 'normal', injury: 'none', cannotKeepGoal: false, gkOnly: false, note: '' };
}
export interface MatchDay {
  matchNumber: number;
  matchDate: string;
  statuses: Record<string, MatchDayStatus>;
}
export function defaultMatchDay(): MatchDay {
  return { matchNumber: 1, matchDate: '', statuses: {} };
}

export interface Partnership {
  id: string;
  playerAId: string;
  playerBId: string;
  type: string;
  evidenceMatches: string[]; // 比赛 id
  note: string;
}

export type GoalEvent = {
  id: number; // 场内自动编号，从 1 开始
  team: TeamId; // 受益队（进球方）
  scorerId: string | null;
  primaryAssistId: string | null;
  secondaryAssistId: string | null;
  isOwnGoal: boolean;
  ownGoalPlayerId: string | null; // 乌龙责任球员，须属于对方
};

export interface MatchMinutes { outfield: number | null; gk: number | null; estimated: boolean; }

export interface MatchRecord {
  id: string;
  date: string;
  durationMinutes: number;
  teams: Record<TeamId, string[]>; // 球员 id
  // 快照：保存时冻结的名单、评分与规则版本，后续改评分不影响。
  // 注意：当天状态/伤病永不写进快照（v1.6 不存规则）。
  snapshot: {
    players: Record<string, { name: string; scores: Record<AbilityKey, number | null>; primaryPosition: Position | null }>;
    ruleVersion: string;
    manualReason: string;
  };
  finalScore: { dark: number; light: number } | null;
  shots: { dark: number | null; light: number | null };
  balanceFeeling: number | null; // 1-5
  abnormal: string;
  notes: string;
  minutes: Record<string, MatchMinutes>;
  events: GoalEvent[];
}

export interface AppData {
  schemaVersion: 1;
  players: Player[];
  baseline: Record<TeamId, string[]>;
  matches: MatchRecord[];
  partnerships: Partnership[];
}

export const SCHEMA_VERSION = 1 as const;
export const RULE_VERSION = 'v1.6';
export const POSITION_RULE_VERSION = 'pos-v1.6';
export const STORAGE_KEY = 'knights-balancer-v16';
export const DEMO_KEY = 'knights-balancer-demo';
