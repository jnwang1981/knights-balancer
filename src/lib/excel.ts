import * as XLSX from 'xlsx';
import {
  ABILITY_KEYS, FAMILIARITY_LABEL, POSITION_LABEL, POSITIONS,
  type AbilityKey, type Familiarity, type Player, type Position, type RoleValue,
} from './types';
import { scoreError } from './validation';

// ---- Excel 模板（与 templates/球员评分模板.csv 同款表头） ----
export const TEMPLATE_HEADERS = [
  '姓名', '主位置', '可兼任位置（多选）',
  '技术', '传球', '进攻意识', '防守意识', '速度', '无球跑动', '体能', '回防补位', '守门',
  '特点备注', '评分日期', '评分依据',
  '能否承担后场支点（是/否/未知）', '能否承担组织接应（是/否/未知）',
] as const;

const LABEL_TO_POSITION = new Map<string, Position>(POSITIONS.map((p) => [POSITION_LABEL[p], p]));
const ABILITY_HEADER: Record<string, AbilityKey> = {
  '技术': 'technique', '传球': 'passing', '进攻意识': 'attackAwareness',
  '防守意识': 'defenseAwareness', '速度': 'speed', '无球跑动': 'offBall',
  '体能': 'stamina', '回防补位': 'covering', '守门': 'goalkeeping',
};

function parseRole(v: unknown): RoleValue | null {
  const s = String(v ?? '').trim();
  if (s === '是') return 'yes';
  if (s === '否') return 'no';
  if (s === '未知' || s === '') return 'unknown';
  return null;
}
function parseScoreCell(v: unknown): number | null | undefined {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return undefined;
  return scoreError(n) ? undefined : n;
}
function parsePositionsCell(v: unknown): Position[] | null {
  const s = String(v ?? '').trim();
  if (!s) return [];
  const out: Position[] = [];
  for (const part of s.split(/[,，、]/)) {
    const t = part.trim();
    if (!t) continue;
    const p = LABEL_TO_POSITION.get(t);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

/** 把表格行（表头→值）转成球员花名册；失败返回错误列表，绝不产生半成品。 */
export function playersFromRows(rows: Record<string, unknown>[]): { players: Player[]; errors: string[] } {
  const players: Player[] = [];
  const errors: string[] = [];
  const seenNames = new Set<string>();
  rows.forEach((row, idx) => {
    const line = idx + 2; // 第 1 行是表头
    const name = String(row['姓名'] ?? '').trim();
    if (!name) {
      if (Object.values(row).some((v) => String(v ?? '').trim() !== '')) errors.push(`第 ${line} 行：姓名缺失`);
      return; // 全空行跳过
    }
    if (seenNames.has(name)) { errors.push(`第 ${line} 行：姓名 ${name} 重复`); return; }
    seenNames.add(name);
    const primaryRaw = String(row['主位置'] ?? '').trim();
    let primary: Position | null = null;
    if (primaryRaw) {
      const p = LABEL_TO_POSITION.get(primaryRaw);
      if (!p) { errors.push(`第 ${line} 行：主位置“${primaryRaw}”不在 8 个位置里`); return; }
      primary = p;
    }
    const secondary = parsePositionsCell(row['可兼任位置（多选）']);
    if (secondary === null) { errors.push(`第 ${line} 行：兼任位置里有不在 8 个位置里的值`); return; }
    const scores = {} as Record<AbilityKey, number | null>;
    for (const k of ABILITY_KEYS) {
      const header = Object.keys(ABILITY_HEADER).find((h) => ABILITY_HEADER[h] === k)!;
      const v = parseScoreCell(row[header]);
      if (v === undefined) { errors.push(`第 ${line} 行：${header}评分非法（须 1–5、步长 0.5，或留空）`); return; }
      scores[k] = v;
    }
    const pivot = parseRole(row['能否承担后场支点（是/否/未知）']);
    const organize = parseRole(row['能否承担组织接应（是/否/未知）']);
    if (pivot === null) { errors.push(`第 ${line} 行：后场支点须填 是/否/未知`); return; }
    if (organize === null) { errors.push(`第 ${line} 行：组织接应须填 是/否/未知`); return; }
    const familiarity = {} as Record<Position, Familiarity>;
    for (const p of POSITIONS) familiarity[p] = 'unevaluated';
    if (primary) familiarity[primary] = 'expert';
    for (const p of secondary) if (familiarity[p] === 'unevaluated') familiarity[p] = 'familiar';
    players.push({
      id: `p-import-${line}-${name}`,
      name, primaryPosition: primary, secondaryPositions: secondary,
      familiarity, scores,
      notes: String(row['特点备注'] ?? '').trim(),
      ratingDate: String(row['评分日期'] ?? '').trim() || null,
      ratingBasis: String(row['评分依据'] ?? '').trim() || null,
      canPivot: pivot, canOrganize: organize,
      archived: false, baselineTeam: null,
    });
  });
  return { players, errors };
}

/** 球员花名册 → 模板行。 */
export function rowsFromPlayers(players: Player[]): Record<string, unknown>[] {
  return players.map((p) => {
    const row: Record<string, unknown> = {
      '姓名': p.name,
      '主位置': p.primaryPosition ? POSITION_LABEL[p.primaryPosition] : '',
      '可兼任位置（多选）': p.secondaryPositions.map((x) => POSITION_LABEL[x]).join('、'),
      '特点备注': p.notes,
      '评分日期': p.ratingDate ?? '',
      '评分依据': p.ratingBasis ?? '',
      '能否承担后场支点（是/否/未知）': p.canPivot === 'yes' ? '是' : p.canPivot === 'no' ? '否' : '未知',
      '能否承担组织接应（是/否/未知）': p.canOrganize === 'yes' ? '是' : p.canOrganize === 'no' ? '否' : '未知',
    };
    for (const k of ABILITY_KEYS) {
      const header = Object.keys(ABILITY_HEADER).find((h) => ABILITY_HEADER[h] === k)!;
      row[header] = p.scores[k] ?? '';
    }
    return row;
  });
}

export function templateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([], { header: [...TEMPLATE_HEADERS] });
  XLSX.utils.book_append_sheet(wb, ws, '球员评分');
  const guide = [
    ['填写说明'],
    ['1. 每行一位球员，姓名必填、不可重复。'],
    ['2. 主位置填 8 个位置之一：守门员、中后卫、左边后卫、右边后卫、后腰、左边前卫、右边前卫、中锋。'],
    ['3. 兼任位置填多个用顿号分隔，如：右边前卫、中锋。'],
    ['4. 九项评分填 1–5、步长 0.5，或留空（空就是空，不补 0 也不补 3）。'],
    ['5. 支点/接应填 是、否、未知。'],
    ['6. 位置熟悉度默认：主位置=擅长，兼任=熟悉，其余=未评估；想细调可在应用「球员档案」里逐格改。'],
    ['7. 熟悉度说明：擅长/熟悉算覆盖；应急、未评估只作填充；不适合禁止分配。'],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(guide);
  XLSX.utils.book_append_sheet(wb, ws2, '填写说明');
  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string): void {
  XLSX.writeFile(wb, filename);
}

export function exportRosterXlsx(players: Player[], filename: string): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rowsFromPlayers(players), { header: [...TEMPLATE_HEADERS] });
  XLSX.utils.book_append_sheet(wb, ws, '球员评分');
  downloadWorkbook(wb, filename);
}

/** 解析 CSV 文本（支持引号与逗号），返回行对象数组。 */
export function parseCsv(text: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = '', inQuotes = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { cur.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      cur.push(field); field = '';
      if (cur.some((v) => v.trim() !== '')) rows.push(cur);
      cur = [];
    } else field += ch;
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, unknown> = {};
    headers.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}

/** 导入花名册文件（.xlsx 或 .csv）。 */
export async function importRosterFile(file: File): Promise<{ players: Player[]; errors: string[] }> {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.csv')) {
      const text = await file.text();
      return playersFromRows(parseCsv(text));
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    return playersFromRows(rows);
  } catch (e) {
    return { players: [], errors: [`文件解析失败：${e instanceof Error ? e.message : String(e)}`] };
  }
}

export { FAMILIARITY_LABEL };
