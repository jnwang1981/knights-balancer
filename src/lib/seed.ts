import type { AbilityKey, AppData, Familiarity, Player, Position, RoleValue, TeamId } from './types';
import { ABILITY_KEYS, POSITIONS } from './types';

// 内置示例数据：16 名虚构球员（姓名、评分、位置均为编造的占位数据，与任何真实球员无关）。
// 首次启动即用这套数据，方便直接体验分组；用自己的真实花名册时请用「数据备份」里的 Excel 导入替换。
type ScoreTuple = [number, number, number, number, number, number, number, number, number];

function blankFamiliarity(): Record<Position, Familiarity> {
  const o = {} as Record<Position, Familiarity>;
  for (const p of POSITIONS) o[p] = 'unevaluated';
  return o;
}

function mk(
  id: string, name: string, team: TeamId,
  primary: Position, secondary: Position[],
  scores: ScoreTuple,
  canPivot: RoleValue, canOrganize: RoleValue,
  emergency: Position[] = [],
  notes = '示例数据（虚构）',
): Player {
  const s = {} as Record<AbilityKey, number | null>;
  ABILITY_KEYS.forEach((k, i) => { s[k] = scores[i]; });
  const familiarity = blankFamiliarity();
  familiarity[primary] = 'expert';
  for (const p of secondary) familiarity[p] = 'familiar';
  for (const p of emergency) if (familiarity[p] === 'unevaluated') familiarity[p] = 'emergency';
  return {
    id, name, primaryPosition: primary, secondaryPositions: secondary,
    familiarity, scores: s, notes, ratingDate: null, ratingBasis: '示例数据',
    canPivot, canOrganize, archived: false, baselineTeam: team,
  };
}

export function seedData(): AppData {
  const players: Player[] = [
    // 深黑（8 人）
    mk('p-chen-dapao', '陈大炮', 'dark', 'CF', ['RM'], [4, 3.5, 4.5, 2.5, 4, 4.5, 3.5, 2.5, 2], 'no', 'unknown'),
    mk('p-zhao-tiezhu', '赵铁柱', 'dark', 'CB', ['DM'], [3, 3.5, 2.5, 4.5, 2.5, 3, 3.5, 4, 3], 'yes', 'no'),
    mk('p-li-ergou', '李二狗', 'dark', 'RB', ['RM', 'CB'], [3.5, 3, 3, 3.5, 4, 3.5, 4, 3.5, 2.5], 'no', 'unknown'),
    mk('p-zhang-afei', '张阿飞', 'dark', 'RM', ['CF'], [3.5, 4, 3.5, 3, 4.5, 4, 3.5, 3, 2], 'no', 'unknown'),
    mk('p-wang-shitou', '王石头', 'dark', 'DM', ['CB'], [3, 4, 3, 4, 3, 3.5, 4, 4.5, 2.5], 'yes', 'yes', ['LB']),
    mk('p-liu-akun', '刘阿坤', 'dark', 'LM', ['RM'], [3.5, 4.5, 3.5, 3, 4, 4, 3.5, 3, 2], 'unknown', 'yes'),
    mk('p-zhou-ajie', '周阿杰', 'dark', 'LB', ['CB'], [3, 3.5, 2.5, 4, 3.5, 3, 4, 4, 3], 'no', 'no', ['RM']),
    mk('p-sun-aming', '孙阿明', 'dark', 'GK', ['CB'], [2.5, 3, 2, 3, 3, 2.5, 3.5, 3, 4.5], 'no', 'unknown'),
    // 浅蓝（8 人）
    mk('p-wu-ahao', '吴阿豪', 'light', 'CF', ['LM'], [4.5, 3, 4, 2.5, 4, 4, 3.5, 2.5, 2], 'no', 'unknown'),
    mk('p-zheng-aqiang', '郑阿强', 'light', 'CB', ['DM'], [3, 3, 2.5, 4, 3, 3.5, 4, 4, 3.5], 'yes', 'no'),
    mk('p-hu-aliang', '胡阿亮', 'light', 'LM', ['RM', 'CF'], [4, 4, 4, 3, 3.5, 4, 3.5, 3, 2.5], 'unknown', 'yes', ['RB']),
    mk('p-lin-awei', '林阿威', 'light', 'DM', ['CB'], [3.5, 4, 3, 3.5, 3.5, 3.5, 3.5, 4, 2.5], 'no', 'yes'),
    mk('p-xu-asong', '徐阿松', 'light', 'RB', ['LB'], [3, 3.5, 3, 3.5, 4, 3, 4, 3.5, 3], 'no', 'unknown', ['DM']),
    mk('p-he-anan', '何阿南', 'light', 'RM', ['CF'], [3.5, 3.5, 3.5, 3, 4, 3.5, 3.5, 3, 2], 'no', 'unknown'),
    mk('p-luo-abei', '罗阿北', 'light', 'LB', ['CB'], [3, 3, 2.5, 3.5, 3.5, 3, 3.5, 3.5, 3], 'unknown', 'no'),
    mk('p-gao-adong', '高阿东', 'light', 'GK', ['CB'], [2.5, 2.5, 2, 3, 2.5, 2.5, 3, 3, 4], 'no', 'unknown'),
  ];
  return {
    schemaVersion: 1,
    players,
    baseline: {
      dark: players.filter((p) => p.baselineTeam === 'dark').map((p) => p.id),
      light: players.filter((p) => p.baselineTeam === 'light').map((p) => p.id),
    },
    matches: [],
    partnerships: [],
  };
}
