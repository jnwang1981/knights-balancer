import { useMemo, useRef, useState} from 'react';
import type { AbilityKey, AppData, Familiarity, Fatigue, Injury, MatchDay, MatchRecord, Player, Position, RoleValue, TeamId} from './lib/types';
import {
ABILITY_DESC, ABILITY_KEYS, ABILITY_LABEL, FATIGUE_LABEL, FAMILIARITY_LABEL,
INJURY_LABEL, OUTFIELD_KEYS, POSITION_LABEL, POSITIONS, POSITION_RULE_VERSION,
RULE_VERSION, defaultMatchDayStatus,
} from './lib/types';
import { FAMILIARITY_VALUES, isValidScore, missingOutfield, parseScoreInput} from './lib/validation';
import { applyStatusPatch, effectiveScores} from './lib/matchday';
import { evaluatePartition, groupPlayers, type GroupingInputPlayer, type GroupingResult, type TeamMetrics} from './lib/grouping';
import { buildDisplayMap, displayFor, type DisplayTeams} from './lib/display';
import { evaluateTeamCoverage, rankByCoverage, type CoverageRanked, type TeamCoverage} from './lib/positioning';
import { computeGkRotation, ROLE_STATUS_LABEL} from './lib/gk';
import { computeLeaderboard, lastNMatches, scoreMismatch, validateGoalEvent} from './lib/events';
import { exportJson, parseImport} from './lib/storage';
import { downloadWorkbook, exportRosterXlsx, importRosterFile, templateWorkbook} from './lib/excel';
import { runSelfCheck, type SelfCheckResult} from './lib/selfcheck';
import { useStore} from './lib/useStore';

const fmt = (n: number) => n.toFixed(2);
const uid = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const roleLabel = (v: RoleValue) => (v === 'yes'? '是': v === 'no'? '否': '未知');
const teamLabel = (t: TeamId) => (t === 'dark'? '深黑': '浅蓝');
const cnDate = (iso: string) => {
const [y, m, d] = iso.split('-').map(Number);
if (!y ||!m ||!d) return iso;
return `${y}年${m}月${d}日`;
};

function ScoreInput({ value, onChange}: { value: number | null; onChange: (v: number | null) => void}) {
const [text, setText] = useState(value === null? '': String(value));
const [err, setErr] = useState('');
return (
<span>
<input
className="score-input" value={text} inputMode="decimal" placeholder="空"
onChange={(e) => {
const t = e.target.value; setText(t);
if (t.trim() === '') { setErr(''); onChange(null); return;}
const parsed = parseScoreInput(t);
if (parsed === undefined) setErr('1–5，步长0.5');
else { setErr(''); onChange(parsed);}
}}
/>
{err && <span className="err">{err}</span>}
</span>
);
}

function emptyPlayer(): Player {
const scores = {} as Record<AbilityKey, number | null>;
for (const k of ABILITY_KEYS) scores[k] = null;
const familiarity = {} as Record<Position, Familiarity>;
for (const p of POSITIONS) familiarity[p] = 'unevaluated';
return {
id: uid(), name: '', primaryPosition: null, secondaryPositions: [], familiarity,
scores, notes: '', ratingDate: null, ratingBasis: null,
canPivot: 'unknown', canOrganize: 'unknown', archived: false, baselineTeam: null,
};
}

export default function App() {
const { data, update, resetToSeed, saveError, corruptMsg} = useStore();
const [tab, setTab] = useState<'players' | 'match' | 'matches' | 'board' | 'backup'>('players');
const players = data.players;
const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
const nameOf = (id: string) => byId.get(id)?.name?? id;
const [editing, setEditing] = useState<Player | null>(null);
const [showArchived, setShowArchived] = useState(false);

const savePlayer = (p: Player) => {
if (!p.name.trim()) { alert('请填写姓名'); return;}
for (const k of ABILITY_KEYS) if (!isValidScore(p.scores[k])) { alert(`${ABILITY_LABEL[k]} 评分非法`); return;}
// 熟悉度归一化：主位置=擅长，兼任=熟悉（教练在熟悉度栏里逐格改的优先保留擅长）。
const familiarity = {...p.familiarity};
if (p.primaryPosition) familiarity[p.primaryPosition] = 'expert';
for (const s of p.secondaryPositions) if (familiarity[s] === 'unevaluated') familiarity[s] = 'familiar';
const saved = {...p, familiarity};
update((d) => {
const exists = d.players.some((x) => x.id === saved.id);
const list = exists? d.players.map((x) => (x.id === saved.id? saved: x)): [...d.players, saved];
const baseline = {...d.baseline};
if (saved.baselineTeam) {
baseline.dark = baseline.dark.filter((id) => id!== saved.id);
baseline.light = baseline.light.filter((id) => id!== saved.id);
baseline[saved.baselineTeam] = [...baseline[saved.baselineTeam], saved.id];
}
return {...d, players: list, baseline};
});
setEditing(null);
};

const activePlayers = players.filter((p) =>!p.archived);
const [selected, setSelected] = useState<Set<string>>(() => new Set([...data.baseline.dark,...data.baseline.light]));

// ---- 当天状态与伤病：只在页面内存里（React state），永不进 localStorage、不进比赛快照 ----
const [matchDay, setMatchDay] = useState<MatchDay>(() => ({ matchNumber: 1, matchDate: todayStr(), statuses: {}}));
const [venue, setVenue] = useState('室内足球场');
const [matchTime, setMatchTime] = useState('20:10–22:10');
const [address, setAddress] = useState('');
const [duration, setDuration] = useState(120);
const [reqPivot, setReqPivot] = useState(true);
const [reqOrg, setReqOrg] = useState(true);
const [calculating, setCalculating] = useState(false);
const [result, setResult] = useState<GroupingResult | null>(null);
const [coverageRanked, setCoverageRanked] = useState<CoverageRanked[] | null>(null);
const [covIdx, setCovIdx] = useState(0);
// 展示数据：一次生成里每套候选的随机显示顺序 + 黑/浅蓝抛硬币结果（按稳定组合键索引）。
// 只影响名单怎么显示，计算一律用 metrics.teamA/teamB（ID 排序的规范表示）。
const [displayMap, setDisplayMap] = useState<Record<string, DisplayTeams>>({});
const [manualTeams, setManualTeams] = useState<Record<TeamId, string[]> | null>(null);
const [swapA, setSwapA] = useState('');
const [swapB, setSwapB] = useState('');
const [manualReason, setManualReason] = useState('');
const [announceCopied, setAnnounceCopied] = useState(false);
const [matchChangedNote, setMatchChangedNote] = useState('');

const statusOf = (id: string) => matchDay.statuses[id]?? defaultMatchDayStatus();
const setStatus = (id: string, patch: Partial<Parameters<typeof applyStatusPatch>[1]>) => {
setMatchDay((prev) => ({
...prev,
statuses: {...prev.statuses, [id]: applyStatusPatch(prev.statuses[id]?? defaultMatchDayStatus(), patch)},
}));
};
const changeMatch = (patch: Partial<Pick<MatchDay, 'matchNumber' | 'matchDate'>>) => {
setMatchDay((prev) => ({...prev,...patch, statuses: {}}));
setResult(null); setCoverageRanked(null); setManualTeams(null); setCovIdx(0); setDisplayMap({});
setMatchChangedNote('场次或日期已更换，当天状态已清空，请重新填写。');
};

const selectedList = useMemo(() => activePlayers.filter((p) => selected.has(p.id)), [activePlayers, selected]);
const toInput = (p: Player): GroupingInputPlayer => {
const st = statusOf(p.id);
return { id: p.id, scores: effectiveScores(p, st), canPivot: p.canPivot, canOrganize: p.canOrganize, gkOnly: st.gkOnly};
};

const currentTeams: Record<TeamId, string[]> | null = manualTeams;
const missingSelected = useMemo(
() => selectedList.filter((p) =>!statusOf(p.id).gkOnly && missingOutfield(p).length > 0),
// eslint-disable-next-line react-hooks/exhaustive-deps
[selectedList, matchDay],
);
const currentMetrics: TeamMetrics | null = useMemo(() => {
if (!currentTeams || missingSelected.length > 0) return null;
const inputs = selectedList.map(toInput);
const map = new Map(inputs.map((x) => [x.id, x]));
const ids = [...currentTeams.dark,...currentTeams.light].sort();
try { return evaluatePartition([...currentTeams.dark].sort(), ids, map, reqPivot, reqOrg);}
catch { return null;}
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [currentTeams, selectedList, matchDay, reqPivot, reqOrg, missingSelected]);
const currentCoverage: { dark: TeamCoverage; light: TeamCoverage} | null = useMemo(() => {
if (!currentTeams) return null;
// 覆盖按规范表示算：先把显示顺序排回 ID 序，守门轮换顺序与改动前一致。
return {
dark: evaluateTeamCoverage('dark', [...currentTeams.dark].sort(), byId, matchDay.statuses),
light: evaluateTeamCoverage('light', [...currentTeams.light].sort(), byId, matchDay.statuses),
};
}, [currentTeams, byId, matchDay]);

const runGrouping = () => {
const inputs = selectedList.map(toInput);
setCalculating(true);
try {
const res = groupPlayers(inputs, { requirePivot: reqPivot, requireOrganize: reqOrg});
setResult(res);
if (res.candidates.length) {
const ranked = rankByCoverage(res.candidates, byId, matchDay.statuses);
setCoverageRanked(ranked);
setCovIdx(0);
// 生成那一刻定死每套候选的显示顺序与黑/浅蓝归属，之后切换查看只查表、不重抽。
const dm = buildDisplayMap(res.candidates);
setDisplayMap(dm);
const top = ranked[0];
const disp = displayFor(top.metrics, dm);
setManualTeams({ dark: [...disp.dark], light: [...disp.light]});
setManualReason('');
} else { setCoverageRanked([]); setManualTeams(null); setDisplayMap({});}
} finally { setCalculating(false);}
};
const pickCoverage = (i: number) => {
if (!coverageRanked) return;
const c = coverageRanked[i];
setCovIdx(i);
const disp = displayFor(c.metrics, displayMap);
setManualTeams({ dark: [...disp.dark], light: [...disp.light]});
};
const pickAbility = (rank: number) => {
if (!result) return;
const c = result.candidates.find((x) => x.rank === rank);
if (!c) return;
setCovIdx(-1);
const disp = displayFor(c.metrics, displayMap);
setManualTeams({ dark: [...disp.dark], light: [...disp.light]});
};
const doSwap = () => {
if (!currentTeams ||!swapA ||!swapB) return;
const dark = currentTeams.dark.includes(swapA)
? currentTeams.dark.map((id) => (id === swapA? swapB: id))
: currentTeams.dark.map((id) => (id === swapB? swapA: id));
const light = currentTeams.light.includes(swapA)
? currentTeams.light.map((id) => (id === swapA? swapB: id))
: currentTeams.light.map((id) => (id === swapB? swapA: id));
setManualTeams({ dark, light});
if (!manualReason) setManualReason('手动换人调整');
setSwapA(''); setSwapB('');
};

const baselineComparable = useMemo(() => {
const sel = new Set(selectedList.map((p) => p.id));
const base = new Set([...data.baseline.dark,...data.baseline.light]);
if (sel.size!== base.size || sel.size === 0) return false;
for (const id of sel) if (!base.has(id)) return false;
return true;
}, [selectedList, data.baseline]);
const baselineMetrics: TeamMetrics | null = useMemo(() => {
if (!baselineComparable || missingSelected.length > 0) return null;
const inputs = selectedList.map(toInput);
const map = new Map(inputs.map((x) => [x.id, x]));
const ids = selectedList.map((p) => p.id).sort();
try { return evaluatePartition([...data.baseline.dark].sort(), ids, map, reqPivot, reqOrg);}
catch { return null;}
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [baselineComparable, selectedList, matchDay, data.baseline, reqPivot, reqOrg, missingSelected]);

const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
const selectedMatch = data.matches.find((m) => m.id === selectedMatchId)?? null;
const confirmMatch = () => {
if (!currentTeams) return;
// 快照只冻结名单、当时评分与规则版本；当天状态/伤病永不写进快照。
const snapPlayers: MatchRecord['snapshot']['players'] = {};
for (const p of selectedList) snapPlayers[p.id] = { name: p.name, scores: {...p.scores}, primaryPosition: p.primaryPosition};
const rec: MatchRecord = {
id: `m-${Date.now().toString(36)}`, date: matchDay.matchDate, durationMinutes: duration,
teams: { dark: [...currentTeams.dark], light: [...currentTeams.light]},
snapshot: { players: snapPlayers, ruleVersion: RULE_VERSION, manualReason},
finalScore: null, shots: { dark: null, light: null}, balanceFeeling: null, abnormal: '', notes: '',
minutes: {}, events: [],
};
update((d) => ({...d, matches: [rec,...d.matches]}));
setTab('matches');
setSelectedMatchId(rec.id);
alert('已保存比赛快照（名单、当时评分、规则版本已冻结；当天状态未保存）。去“比赛记录”里补比分和逐球。');
};

const noticeText = useMemo(() => {
if (!currentTeams) return '';
const lines: string[] = [];
lines.push(`⚽️ 骑士足球队 第${matchDay.matchNumber}场分组`);
lines.push(`📅 ${cnDate(matchDay.matchDate)}`);
lines.push(`⏰ ${matchTime}`);
lines.push(`🏟️ ${venue}`);
if (address.trim()) lines.push(`📍 ${address.trim()}`);
lines.push('');
lines.push('注意事项：');
lines.push('⚽️ 请提前 15 分钟到场热身');
lines.push('⏰ 迟到请提前在群里说一声');
lines.push('🪖 请穿室内足球鞋，勿穿钉鞋');
lines.push('🎮 友谊第一，控制动作幅度');
lines.push('🧤 守门员请自带手套');
lines.push('');
lines.push('迟到发红包');
lines.push('无故缺席停赛一场');
lines.push('暴力行为取消资格');
lines.push('');
for (const t of ['dark', 'light'] as TeamId[]) {
lines.push(`${teamLabel(t)}队（${currentTeams[t].length} 人）：`);
currentTeams[t].forEach((id, i) => {
const p = byId.get(id)!;
const st = statusOf(id);
lines.push(`${i + 1}. ${p.name}${p.primaryPosition? `（${POSITION_LABEL[p.primaryPosition]}）`: ''}${st.gkOnly? '': ''}`);
});
lines.push('');
}
return lines.join('\n');
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [currentTeams, matchDay, venue, matchTime, address, byId]);
const copyAnnouncement = async () => {
if (!noticeText) return;
try { await navigator.clipboard.writeText(noticeText); setAnnounceCopied(true); setTimeout(() => setAnnounceCopied(false), 2000);}
catch { alert(noticeText);}
};

const [evForm, setEvForm] = useState({ team: 'dark' as TeamId, scorerId: '', primaryAssistId: '', secondaryAssistId: '', isOwnGoal: false, ownGoalPlayerId: ''});
const updateMatch = (id: string, fn: (m: MatchRecord) => MatchRecord) => {
update((d) => ({...d, matches: d.matches.map((m) => (m.id === id? fn(m): m))}));
};
const [partnerForm, setPartnerForm] = useState({ a: '', b: '', type: '', note: ''});
const fileRef = useRef<HTMLInputElement>(null);
const rosterFileRef = useRef<HTMLInputElement>(null);
const [importPreview, setImportPreview] = useState<AppData | null>(null);
const [importErrors, setImportErrors] = useState<string[]>([]);
const [rosterPreview, setRosterPreview] = useState<Player[] | null>(null);
const [rosterErrors, setRosterErrors] = useState<string[]>([]);
const [selfCheck, setSelfCheck] = useState<SelfCheckResult | null>(null);

const doExport = () => {
const blob = new Blob([exportJson(data)], { type: 'application/json'});
const a = document.createElement('a');
a.href = URL.createObjectURL(blob); a.download = `骑士足球队备份-${todayStr()}.json`; a.click(); URL.revokeObjectURL(a.href);
};
const onImportFile = async (f: File) => {
const text = await f.text();
const { data: parsed, errors} = parseImport(text);
setImportErrors(errors); setImportPreview(parsed);
if (errors.length) alert(`导入校验失败，未改变原数据：\n${errors.slice(0, 5).join('\n')}`);
};
const onRosterFile = async (f: File) => {
const { players: parsed, errors} = await importRosterFile(f);
setRosterErrors(errors); setRosterPreview(errors.length? null: parsed);
if (errors.length) alert(`花名册导入校验失败，未改变原数据：\n${errors.slice(0, 5).join('\n')}`);
};

const boardAll = useMemo(() => computeLeaderboard(data.matches), [data.matches]);
const boardLast5 = useMemo(() => computeLeaderboard(data.matches, lastNMatches(data.matches, 5)), [data.matches]);

const gkSlots = useMemo(() => {
if (!currentTeams) return null;
const known = new Set(selectedList.map((p) => p.id));
if ([...currentTeams.dark,...currentTeams.light].some((id) =>!known.has(id))) return null;
// 守门轮换按规范表示算：先把显示顺序排回 ID 序，轮换顺序与改动前一致。
const sortedTeams = { dark: [...currentTeams.dark].sort(), light: [...currentTeams.light].sort() };
try { return computeGkRotation(sortedTeams, selectedList, matchDay.statuses, duration);}
catch { return null;}
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [currentTeams, selectedList, matchDay, duration]);

const missingList = result?.missing?? [];
const specialNotes = selectedList.filter((p) => {
const st = statusOf(p.id);
return (st.note?? '').trim() || st.fatigue!== 'normal' || st.injury!== 'none' || st.cannotKeepGoal || st.gkOnly;
});
const cannotKeepGoalPlayers = selectedList.filter((p) => statusOf(p.id).cannotKeepGoal);

return (
<div className="app">
<header>
<h1>骑士足球队智能分组</h1>
<p className="sub">版本 v1.6 · 位置规则 {POSITION_RULE_VERSION} · 只作分组参考，不输出预测胜率或“绝对公平”结论</p>
<p className="sub">内置 16 名示例球员（虚构数据）：首次使用可直接分组；用自己的真实花名册请去「数据备份」用 Excel 模板导入。</p>
{corruptMsg && <p className="warn">本地数据损坏提示：{corruptMsg}（原数据未被清空；可从备份导入恢复。）</p>}
{saveError && <p className="warn">保存失败：{saveError}</p>}
</header>
<nav className="tabs">
{([['players', '球员档案'], ['match', '本场分组'], ['matches', '比赛记录'], ['board', '榜单与参考'], ['backup', '数据备份']] as const).map(([k, label]) => (
<button key={k} className={tab === k? 'active': ''} onClick={() => setTab(k)}>{label}</button>
))}
</nav>

{tab === 'players' && (
<section>
<div className="row">
<button onClick={() => setEditing(emptyPlayer())}>＋新增球员</button>
<label><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> 显示已归档</label>
<span className="muted">共 {players.filter((p) => showArchived ||!p.archived).length} 人（在册 {activePlayers.length} 人）· 不设个人综合实力排名</span>
</div>
<div className="table-wrap"><table>
<thead><tr><th>姓名</th><th>主位置</th><th>兼任</th>{ABILITY_KEYS.map((k) => <th key={k}>{ABILITY_LABEL[k]}</th>)}<th>支点</th><th>组织</th><th>操作</th></tr></thead>
<tbody>
{players.filter((p) => showArchived ||!p.archived).map((p) => (
<tr key={p.id} className={p.archived? 'archived': ''}>
<td><strong>{p.name}</strong>{p.archived? '（已归档）': ''}<br /><span className="muted">{p.notes || ''}</span></td>
<td>{p.primaryPosition? POSITION_LABEL[p.primaryPosition]: '—'}</td>
<td>{p.secondaryPositions.map((x) => POSITION_LABEL[x]).join('、') || '—'}</td>
{ABILITY_KEYS.map((k) => <td key={k}>{p.scores[k]?? '—'}</td>)}
<td>{roleLabel(p.canPivot)}</td><td>{roleLabel(p.canOrganize)}</td>
<td><button onClick={() => setEditing({...p, scores: {...p.scores}, secondaryPositions: [...p.secondaryPositions], familiarity: {...p.familiarity}})}>编辑</button></td>
</tr>
))}
</tbody>
</table></div>
<p className="muted">评分说明：技术（停球/控球/盘带/突破/射门，不重复评价传球）· 传球（准确性/力度/受压出球）· 进攻意识（决策/空间/时机）· 防守意识（威胁判断/站位/盯人/封堵）· 速度（启动/加速/冲刺）· 无球跑动（接应/前插/拉开/牵制）· 体能（持续/反复冲刺/恢复/后半场强度）· 回防补位（回追/补位主动性与稳定性）· 守门（站位/扑救/出球）。空值就是空，不补 0 也不补 3。</p>
{editing && (
<div className="card"><h3>{players.some((p) => p.id === editing.id)? '编辑球员': '新增球员'}</h3>
<div className="form-grid">
<label>姓名<input value={editing.name} onChange={(e) => setEditing({...editing, name: e.target.value})} /></label>
<label>主位置<select value={editing.primaryPosition?? ''} onChange={(e) => setEditing({...editing, primaryPosition: (e.target.value || null) as Position | null})}><option value="">—</option>{POSITIONS.map((x) => <option key={x} value={x}>{POSITION_LABEL[x]}</option>)}</select></label>
<label>基线队<select value={editing.baselineTeam?? ''} onChange={(e) => setEditing({...editing, baselineTeam: (e.target.value || null) as TeamId | null})}><option value="">—</option><option value="dark">深黑</option><option value="light">浅蓝</option></select></label>
<label>评分日期<input type="date" value={editing.ratingDate?? ''} onChange={(e) => setEditing({...editing, ratingDate: e.target.value || null})} /></label>
<label>评分依据<input value={editing.ratingBasis?? ''} onChange={(e) => setEditing({...editing, ratingBasis: e.target.value || null})} placeholder="如：教练评分" /></label>
<label>能否承担后场支点<select value={editing.canPivot} onChange={(e) => setEditing({...editing, canPivot: e.target.value as RoleValue})}><option value="yes">是</option><option value="no">否</option><option value="unknown">未知</option></select></label>
<label>能否承担组织接应<select value={editing.canOrganize} onChange={(e) => setEditing({...editing, canOrganize: e.target.value as RoleValue})}><option value="yes">是</option><option value="no">否</option><option value="unknown">未知</option></select></label>
</div>
<h4>兼任位置（多选）</h4>
<div className="row">
{POSITIONS.filter((x) => x!== editing.primaryPosition).map((x) => (
<label key={x}><input type="checkbox" checked={editing.secondaryPositions.includes(x)} onChange={(e) => {
const s = e.target.checked? [...editing.secondaryPositions, x]: editing.secondaryPositions.filter((y) => y!== x);
setEditing({...editing, secondaryPositions: s});
}} /> {POSITION_LABEL[x]}</label>
))}
</div>
<h4>位置熟悉度（保存时主位置自动记为擅长、兼任自动记为熟悉）</h4>
<div className="form-grid">
{POSITIONS.map((pos) => (
<label key={pos}>{POSITION_LABEL[pos]}
<select value={editing.familiarity[pos]} onChange={(e) => setEditing({...editing, familiarity: {...editing.familiarity, [pos]: e.target.value as Familiarity}})}>
{FAMILIARITY_VALUES.map((f) => <option key={f} value={f}>{FAMILIARITY_LABEL[f]}</option>)}
</select>
</label>
))}
</div>
<p className="muted">覆盖只算擅长/熟悉；应急、未评估只作未覆盖槽位填充；不适合禁止分配；无左右镜像。</p>
<h4>九项能力（1–5，步长 0.5，留空即可）</h4>
<div className="form-grid">
{ABILITY_KEYS.map((k) => (
<label key={k} title={ABILITY_DESC[k]}>{ABILITY_LABEL[k]}<ScoreInput value={editing.scores[k]} onChange={(v) => setEditing({...editing, scores: {...editing.scores, [k]: v}})} /></label>
))}
</div>
<label className="block">特点备注<textarea value={editing.notes} onChange={(e) => setEditing({...editing, notes: e.target.value})} /></label>
<div className="row">
<button onClick={() => savePlayer(editing)}>保存</button>
<button onClick={() => setEditing(null)}>取消</button>
{players.some((p) => p.id === editing.id) && (
<button onClick={() => { update((d) => ({...d, players: d.players.map((x) => (x.id === editing.id? {...x, archived:!x.archived}: x))})); setEditing(null);}}>
{editing.archived? '取消归档': '归档（保留历史比赛资料）'}
</button>
)}
</div>
</div>
)}
</section>
)}

      {tab === 'match' && (
        <section>
          <div className="card"><h3>本场设置</h3>
            <div className="form-grid">
              <label>场次<input type="number" min={1} value={matchDay.matchNumber} onChange={(e) => changeMatch({ matchNumber: Number(e.target.value) || 1 })} /></label>
              <label>比赛日期<input type="date" value={matchDay.matchDate} onChange={(e) => changeMatch({ matchDate: e.target.value })} /></label>
              <label>时长（分钟）<input type="number" min={30} max={240} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 120)} /></label>
              <label>场馆<input value={venue} onChange={(e) => setVenue(e.target.value)} /></label>
              <label>时间<input value={matchTime} onChange={(e) => setMatchTime(e.target.value)} /></label>
              <label>地址<input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="可空" /></label>
              <label><input type="checkbox" checked={reqPivot} onChange={(e) => setReqPivot(e.target.checked)} /> 硬约束：每队至少一名已确认后场支点</label>
              <label><input type="checkbox" checked={reqOrg} onChange={(e) => setReqOrg(e.target.checked)} /> 硬约束：每队至少一名已确认组织接应者</label>
            </div>
            <p className="muted">硬约束默认开启；没有可行方案时不会自动放宽，需教练明确关闭约束后重算。场次或日期一换，当天状态全部清空，需重新填写。支点/接应只算能踢外场的人（因伤只能守门的人不算）。</p>
            {matchChangedNote && <p className="warn">{matchChangedNote}</p>}
            <h4>出勤（{selected.size} 人）</h4>
            <div className="attend-grid">
              {activePlayers.map((p) => {
                const miss = missingOutfield(p);
                const st = statusOf(p.id);
                const eff = effectiveScores(p, st);
                const gkOnlyDisabled = st.injury !== 'playingHurt';
                return (
                  <div key={p.id} className={`attend ${selected.has(p.id) ? 'on' : ''}`}>
                    <label><input type="checkbox" checked={selected.has(p.id)} onChange={(e) => { const s = new Set(selected); e.target.checked ? s.add(p.id) : s.delete(p.id); setSelected(s); }} /> <strong>{p.name}</strong> <span className="muted">{p.primaryPosition ? POSITION_LABEL[p.primaryPosition] : ''}</span></label>
                    {selected.has(p.id) && <>
                      <label>当天状态
                        <select value={st.fatigue} onChange={(e) => setStatus(p.id, { fatigue: e.target.value as Fatigue })}>
                          {(Object.keys(FATIGUE_LABEL) as Fatigue[]).map((f) => <option key={f} value={f}>{FATIGUE_LABEL[f]}{f === 'slightly' ? '（体能-0.5）' : f === 'clearly' ? '（体能-1）' : f === 'unknown' ? '（待确认，不扣分）' : ''}</option>)}
                        </select>
                      </label>
                      <label>伤病
                        <select value={st.injury} onChange={(e) => setStatus(p.id, { injury: e.target.value as Injury })}>
                          {(Object.keys(INJURY_LABEL) as Injury[]).map((v) => <option key={v} value={v}>{INJURY_LABEL[v]}{v === 'minor' ? '（速度-0.5、体能-0.5）' : v === 'playingHurt' ? '（速度-1、体能-1、无球-0.5、回防-0.5）' : ''}</option>)}
                        </select>
                      </label>
                      <label><input type="checkbox" checked={st.cannotKeepGoal} onChange={(e) => setStatus(p.id, { cannotKeepGoal: e.target.checked })} /> 因伤不能守门{st.gkOnly ? '（与“只能守门”二选一）' : ''}</label>
                      <label><input type="checkbox" checked={st.gkOnly} disabled={gkOnlyDisabled} onChange={(e) => setStatus(p.id, { gkOnly: e.target.checked })} /> 因伤只能守门{gkOnlyDisabled ? '（只有带伤上场才能勾）' : '（整场固定守门，不踢外场）'}</label>
                      <input placeholder="活动限制 / 迟到 / 提前离场" value={st.note} onChange={(e) => setStatus(p.id, { note: e.target.value })} />
                      {(st.fatigue !== 'normal' || st.injury !== 'none') && <span className="muted">本场有效评分：{OUTFIELD_KEYS.map((k) => `${ABILITY_LABEL[k]}${eff[k] ?? '空'}`).join('、')}</span>}
                      {st.fatigue === 'unknown' && <span className="muted">体能待确认</span>}
                      {st.gkOnly && <span className="warn">整场固定守门，不踢外场；外场评分不计入本队平均（本队按 7 人算）。</span>}
                      {st.cannotKeepGoal && <span className="muted">不进守门轮换，外场照常。</span>}
                    </>}
                    {miss.length > 0 && !st.gkOnly && <span className="err">缺评分：{miss.map((k) => ABILITY_LABEL[k]).join('、')}</span>}
                  </div>
                );
              })}
            </div>
            <div className="row">
              <button onClick={() => setSelected(new Set(activePlayers.map((p) => p.id)))}>全选在册</button>
              <button onClick={() => setSelected(new Set())}>清空</button>
              <button onClick={() => { const b = new Set([...data.baseline.dark, ...data.baseline.light].filter((id) => byId.get(id) && !byId.get(id)!.archived)); setSelected(b); }}>按基线全选</button>
            </div>
            <p className="muted">当天状态与伤病只在当天页面内存里，刷新或关闭页面就丢掉，场次或日期一换就清空，每周手动重新输入；不保存在任何地方。扣分幅度是试行参数，没有比赛数据支持。</p>
          </div>
          <div className="row">
            <button disabled={calculating || selected.size === 0} onClick={runGrouping}>{calculating ? '计算中…' : '生成分组'}</button>
            {selected.size > 0 && selected.size % 2 !== 0 && <span className="warn">奇数人数（{selected.size} 人）：请先调整出勤名单，不会偷偷排除一个人。</span>}
            {selected.size > 0 && (selected.size < 8 || selected.size > 20) && <span className="warn">自动分组支持 8–20 人，当前 {selected.size} 人。</span>}
          </div>
          {calculating && <p>正在枚举全部等人数分组…（16 人为 6435 种）</p>}
          {result && (
            <div className="card">
              <p>算法版本 {result.algorithmVersion} · 枚举总数 {result.totalEnumerated} · 可行方案 {result.feasibleCount} · 约束：支点 {result.constraints.requirePivot ? '开' : '关'} / 组织 {result.constraints.requireOrganize ? '开' : '关'}</p>
              {result.blockedReason && <p className="warn">{result.blockedReason}</p>}
              {missingList.length > 0 && <div className="warn"><strong>以下球员缺外场评分，已阻止数值推荐：</strong><ul>{missingList.map((m) => <li key={m.playerId}>{nameOf(m.playerId)}：缺 {m.missingKeys.map((k) => ABILITY_LABEL[k]).join('、')}</li>)}</ul></div>}
              {coverageRanked && coverageRanked.length > 0 && (
                <div>
                  <h4>推荐方案（能力前 10 名里按覆盖排前 3，默认选中覆盖第 1 名）</h4>
                  {coverageRanked.map((c, i) => (
                    <button key={i} className={covIdx === i ? 'active' : ''} onClick={() => pickCoverage(i)}>
                      推荐 {i + 1}（能力第 {c.abilityRank} 名 · 最弱时段覆盖 {c.weakest}/7 · 未覆盖总数 {c.totalUncovered} · 最大差距 {fmt(c.metrics.maxDelta)}）
                    </button>
                  ))}
                </div>
              )}
              {result.candidates.length > 0 && (
                <div>
                  <h4>能力前 10 名对照表（按覆盖排序）</h4>
                  <div className="table-wrap"><table>
                    <thead><tr><th>能力排名</th><th>深黑队</th><th>浅蓝队</th><th>最大差距</th><th>最弱时段覆盖</th><th>未覆盖总数</th><th></th></tr></thead>
                    <tbody>
                      {[...result.candidates].map((c) => {
                        const cov = coverageRanked?.find((x) => x.abilityRank === c.rank);
                        // 对照表按每套候选的展示数据渲染（随机顺序 + 抛硬币后的黑/浅蓝归属），与点开的效果一致；
                        // 行顺序仍按能力排名。
                        const disp = displayFor(c.metrics, displayMap);
                        const darkSet = manualTeams ? [...manualTeams.dark].sort().join(',') : '';
                        const isCurrent = manualTeams && (darkSet === [...c.metrics.teamA].sort().join(',') || darkSet === [...c.metrics.teamB].sort().join(','));
                        return (
                          <tr key={c.rank} className={isCurrent ? 'max-row' : ''}>
                            <td>第 {c.rank} 名</td>
                            <td>{disp.dark.map(nameOf).join('、')}</td>
                            <td>{disp.light.map(nameOf).join('、')}</td>
                            <td>{fmt(c.metrics.maxDelta)}</td>
                            <td>{cov ? `${cov.weakest}/7` : '—'}</td>
                            <td>{cov ? cov.totalUncovered : '—'}</td>
                            <td><button onClick={() => pickAbility(c.rank)}>选这套</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table></div>
                </div>
              )}
            </div>
          )}
          {currentTeams && currentMetrics && currentCoverage && (
            <div className="card"><h3>当前查看的方案</h3>
              <p>最大差距 {fmt(currentMetrics.maxDelta)}（{ABILITY_LABEL[currentMetrics.maxDeltaKey]}）· 体能+无球+回防差距和 {fmt(currentMetrics.weighted)} · 八项差距和 {fmt(currentMetrics.sumDelta)}{currentMetrics.outfieldCount.dark !== currentMetrics.outfieldCount.light ? ` · 外场人数 深黑 ${currentMetrics.outfieldCount.dark} 人 / 浅蓝 ${currentMetrics.outfieldCount.light} 人（有因伤固定守门的人）` : ''} · 守门比较 {currentMetrics.gkComplete ? '完整' : '不完整（有人缺守门评分）'}</p>
              {!currentMetrics.constraintOk && <p className="warn">约束未满足：{currentMetrics.constraintIssues.join('；')}</p>}
              <div className="table-wrap"><table>
                <thead><tr><th>项目</th><th>深黑平均</th><th>浅蓝平均</th><th>差值 Δ</th></tr></thead>
                <tbody>{OUTFIELD_KEYS.map((k) => (
                  <tr key={k} className={k === currentMetrics.maxDeltaKey ? 'max-row' : ''}><td>{ABILITY_LABEL[k]}</td><td>{fmt(currentMetrics.averages.dark[k])}</td><td>{fmt(currentMetrics.averages.light[k])}</td><td>{fmt(currentMetrics.deltas[k].n / currentMetrics.deltas[k].d)}</td></tr>
                ))}</tbody>
              </table></div>
              <div className="two-col">
                {(['dark', 'light'] as TeamId[]).map((t) => (
                  <div key={t}><h4>{teamLabel(t)}队（{currentTeams[t].length} 人）</h4><ul>
                    {currentTeams[t].map((id) => {
                      const p = byId.get(id)!; const st = statusOf(id);
                      return (
                        <li key={id}>{p.name} · {p.primaryPosition ? POSITION_LABEL[p.primaryPosition] : '位置未填'} · 支点{roleLabel(p.canPivot)} / 组织{roleLabel(p.canOrganize)}
                          {st.fatigue !== 'normal' && ` · 当天：${FATIGUE_LABEL[st.fatigue]}`}
                          {st.injury !== 'none' && ` · ${INJURY_LABEL[st.injury]}`}
                          {st.cannotKeepGoal && ' · 因伤不能守门'}
                          {st.gkOnly && ' · 因伤只能守门（固定守门）'}
                          {st.note && ` · ${st.note}`}
                        </li>);
                    })}
                  </ul></div>
                ))}
              </div>
              {specialNotes.length > 0 && <p className="warn">特殊提示：{specialNotes.map((p) => { const st = statusOf(p.id); return `${p.name}：${FATIGUE_LABEL[st.fatigue]}${st.injury !== 'none' ? '、' + INJURY_LABEL[st.injury] : ''}${st.cannotKeepGoal ? '、因伤不能守门' : ''}${st.gkOnly ? '、因伤只能守门' : ''}${st.note ? '，' + st.note : ''}`; }).join('；')}</p>}
              <h4>手动换人（选两队各一人，立即重算）</h4>
              <div className="row">
                <select value={swapA} onChange={(e) => setSwapA(e.target.value)}><option value="">深黑队员</option>{currentTeams.dark.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}</select>
                <select value={swapB} onChange={(e) => setSwapB(e.target.value)}><option value="">浅蓝队员</option>{currentTeams.light.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}</select>
                <button disabled={!swapA || !swapB} onClick={doSwap}>交换</button>
                <label>手动修改理由<input value={manualReason} onChange={(e) => setManualReason(e.target.value)} placeholder="保存快照时一并记录" /></label>
              </div>
              {baselineMetrics && <p>与基线分组比较：基线最大差距 {fmt(baselineMetrics.maxDelta)}（{ABILITY_LABEL[baselineMetrics.maxDeltaKey]}），当前方案 {fmt(currentMetrics.maxDelta)}。{currentMetrics.maxDelta <= baselineMetrics.maxDelta ? '当前方案不差于基线。' : '当前方案最大差距大于基线。'}</p>}
              {!baselineComparable && <p className="muted">基线不完整或与出勤名单不一致，不计算虚假对比。</p>}
              <h4>位置覆盖明细（3-3-1，覆盖只算擅长/熟悉）</h4>
              {(['dark', 'light'] as TeamId[]).map((t) => {
                const cov = currentCoverage[t];
                return (
                  <div key={t} className="card">
                    <h4>{teamLabel(t)}队：最弱时段覆盖 {cov.weakest}/7 · 未覆盖总数 {cov.totalUncovered} · 共 {cov.slots.length} 个守门时段</h4>
                    {cov.slots.map((s, i) => (
                      <p key={i}>时段 {i + 1}（门将：{nameOf(s.gkId)}）：覆盖 {s.covered}/7{s.uncoveredSlots.length > 0 ? `，未覆盖：${s.uncoveredSlots.map((x) => POSITION_LABEL[x]).join('、')}（由${s.assignment.filter((a) => !a.covered).map((a) => `${nameOf(a.playerId)}·${FAMILIARITY_LABEL[a.familiarity]}`).join('、')}顶上）` : '，全覆盖'}</p>
                    ))}
                  </div>
                );
              })}
              <h4>轮流守门（每队 8 个时段、时长相等；可调整顺序）</h4>
              <p className="muted">每时段 {gkSlots && gkSlots[0] ? fmt(gkSlots[0].durationMinutes) : '—'} 分钟 · 门将分不与外场分相加 · 勾了「因伤不能守门」的不进轮换；「因伤只能守门」的人整场固定守门</p>
              {(['dark', 'light'] as TeamId[]).map((t) => {
                const fixed = currentTeams[t].find((id) => statusOf(id).gkOnly);
                // 守门顺序按 ID 序排（与改动前一致），不受名单随机显示顺序影响。
                const order = fixed ? [fixed] : [...currentTeams[t]].sort().filter((id) => !statusOf(id).cannotKeepGoal);
                return (
                  <div key={t}><strong>{teamLabel(t)}队守门顺序：</strong>
                    {fixed ? <span className="chip">{nameOf(fixed)}（整场固定守门）</span> : order.map((id, i) => <span key={id} className="chip">{i + 1}.{nameOf(id)}</span>)}
                    {cannotKeepGoalPlayers.filter((p) => currentTeams[t].includes(p.id)).map((p) => <span key={p.id} className="chip">{p.name}（不守门）</span>)}
                  </div>
                );
              })}
              <div className="table-wrap"><table>
                <thead><tr><th>时段</th><th>深黑门将</th><th>浅蓝门将</th><th>外场最大差距</th><th>深黑角色</th><th>浅蓝角色</th></tr></thead>
                <tbody>{gkSlots?.map((s) => (
                  <tr key={s.index}><td>第 {s.index + 1} 段（{fmt(s.durationMinutes)} 分钟）</td>
                    <td>{nameOf(s.gk.dark.playerId)}（{s.gk.dark.gkScore ?? '未知'}）</td>
                    <td>{nameOf(s.gk.light.playerId)}（{s.gk.light.gkScore ?? '未知'}）</td>
                    <td>{fmt(s.maxOutfieldDelta)}（{ABILITY_LABEL[s.maxOutfieldKey]}）</td>
                    <td>支点：{ROLE_STATUS_LABEL[s.roleCoverage.dark.pivot]}；组织：{ROLE_STATUS_LABEL[s.roleCoverage.dark.organize]}</td>
                    <td>支点：{ROLE_STATUS_LABEL[s.roleCoverage.light.pivot]}；组织：{ROLE_STATUS_LABEL[s.roleCoverage.light.organize]}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <h4>群公告</h4>
              <pre className="notice">{noticeText}</pre>
              <div className="row">
                <button onClick={copyAnnouncement}>复制群公告</button>
                {announceCopied && <span>已复制</span>}
                <button onClick={confirmMatch}>确认方案并保存比赛快照</button>
              </div>
              <p className="muted">群公告只出名单和预计位置，不公开能力分与负面评价。比赛快照不保存当天状态。</p>
            </div>
          )}
          {currentTeams && !currentMetrics && missingSelected.length > 0 && (
            <p className="warn">有出场球员缺少外场评分（{missingSelected.map((p) => p.name).join('、')}），请补评分后再生成分组。</p>
          )}
        </section>
      )}

      {tab === 'matches' && (
        <section>
          <h3>比赛记录（{data.matches.length} 场）</h3>
          <p className="muted">历史比赛使用当时快照，不随当前球员档案变化。榜单总分不另存，只从逐球事件推导。</p>
          <div className="row">{data.matches.map((m) => (
            <button key={m.id} className={selectedMatchId === m.id ? 'active' : ''} onClick={() => setSelectedMatchId(m.id)}>{m.date}（{m.finalScore ? `${m.finalScore.dark}:${m.finalScore.light}` : '未填比分'}）</button>
          ))}</div>
          {!selectedMatch && <p>请先在“本场分组”确认方案保存快照，或选择一场已有比赛。</p>}
          {selectedMatch && (() => {
            const m = selectedMatch;
            const mismatch = scoreMismatch(m);
            const roster = [...m.teams.dark, ...m.teams.light];
            const snapName = (id: string) => m.snapshot.players[id]?.name ?? nameOf(id);
            return (
              <div className="card">
                <h3>{m.date} · 深黑 {m.teams.dark.map(snapName).join('、')} vs 浅蓝 {m.teams.light.map(snapName).join('、')}</h3>
                <p className="muted">规则版本 {m.snapshot.ruleVersion} · 时长 {m.durationMinutes} 分钟 · 手动修改理由：{m.snapshot.manualReason || '无'}</p>
                {mismatch && <p className="warn">{mismatch}</p>}
                <div className="form-grid">
                  <label>最终比分（深黑）<input type="number" min={0} value={m.finalScore?.dark ?? ''} onChange={(e) => updateMatch(m.id, (x) => ({ ...x, finalScore: { dark: Number(e.target.value) || 0, light: x.finalScore?.light ?? 0 } }))} /></label>
                  <label>最终比分（浅蓝）<input type="number" min={0} value={m.finalScore?.light ?? ''} onChange={(e) => updateMatch(m.id, (x) => ({ ...x, finalScore: { dark: x.finalScore?.dark ?? 0, light: Number(e.target.value) || 0 } }))} /></label>
                  <label>射门（深黑，可空）<input type="number" min={0} value={m.shots.dark ?? ''} onChange={(e) => updateMatch(m.id, (x) => ({ ...x, shots: { ...x.shots, dark: e.target.value === '' ? null : Number(e.target.value) } }))} /></label>
                  <label>射门（浅蓝，可空）<input type="number" min={0} value={m.shots.light ?? ''} onChange={(e) => updateMatch(m.id, (x) => ({ ...x, shots: { ...x.shots, light: e.target.value === '' ? null : Number(e.target.value) } }))} /></label>
                  <label>平衡感受 1–5<input type="number" min={1} max={5} value={m.balanceFeeling ?? ''} onChange={(e) => updateMatch(m.id, (x) => ({ ...x, balanceFeeling: e.target.value === '' ? null : Number(e.target.value) }))} /></label>
                </div>
                <label className="block">异常情况<textarea value={m.abnormal} onChange={(e) => updateMatch(m.id, (x) => ({ ...x, abnormal: e.target.value }))} /></label>
                <label className="block">赛后备注<textarea value={m.notes} onChange={(e) => updateMatch(m.id, (x) => ({ ...x, notes: e.target.value }))} /></label>
                <h4>逐球记录（事件编号自动生成）</h4>
                <div className="table-wrap"><table><thead><tr><th>#</th><th>进球方</th><th>进球者</th><th>主助攻</th><th>副助攻</th><th>乌龙</th><th></th></tr></thead>
                  <tbody>{m.events.map((ev) => (
                    <tr key={ev.id}><td>{ev.id}</td><td>{teamLabel(ev.team)}</td>
                      <td>{ev.isOwnGoal ? `乌龙（${ev.ownGoalPlayerId ? snapName(ev.ownGoalPlayerId) : '责任人未填'}）` : ev.scorerId ? snapName(ev.scorerId) : '—'}</td>
                      <td>{ev.primaryAssistId ? snapName(ev.primaryAssistId) : '—'}</td>
                      <td>{ev.secondaryAssistId ? snapName(ev.secondaryAssistId) : '—'}</td>
                      <td>{ev.isOwnGoal ? '是' : '否'}</td>
                      <td><button onClick={() => updateMatch(m.id, (x) => ({ ...x, events: x.events.filter((e) => e.id !== ev.id) }))}>删除</button></td></tr>
                  ))}</tbody></table></div>
                <div className="form-grid">
                  <label>进球方<select value={evForm.team} onChange={(e) => setEvForm({ ...evForm, team: e.target.value as TeamId })}><option value="dark">深黑</option><option value="light">浅蓝</option></select></label>
                  <label><input type="checkbox" checked={evForm.isOwnGoal} onChange={(e) => setEvForm({ ...evForm, isOwnGoal: e.target.checked })} /> 乌龙球</label>
                  {!evForm.isOwnGoal && <>
                    <label>进球者<select value={evForm.scorerId} onChange={(e) => setEvForm({ ...evForm, scorerId: e.target.value })}><option value="">—</option>{m.teams[evForm.team].map((id) => <option key={id} value={id}>{snapName(id)}</option>)}</select></label>
                    <label>主助攻（可空）<select value={evForm.primaryAssistId} onChange={(e) => setEvForm({ ...evForm, primaryAssistId: e.target.value })}><option value="">—</option>{m.teams[evForm.team].map((id) => <option key={id} value={id}>{snapName(id)}</option>)}</select></label>
                    <label>副助攻（须有主助攻）<select value={evForm.secondaryAssistId} onChange={(e) => setEvForm({ ...evForm, secondaryAssistId: e.target.value })}><option value="">—</option>{m.teams[evForm.team].map((id) => <option key={id} value={id}>{snapName(id)}</option>)}</select></label>
                  </>}
                  {evForm.isOwnGoal && <label>乌龙责任球员（对方名单，可空）<select value={evForm.ownGoalPlayerId} onChange={(e) => setEvForm({ ...evForm, ownGoalPlayerId: e.target.value })}><option value="">—</option>{m.teams[evForm.team === 'dark' ? 'light' : 'dark'].map((id) => <option key={id} value={id}>{snapName(id)}</option>)}</select></label>}
                </div>
                <button onClick={() => {
                  const ev = { team: evForm.team, scorerId: evForm.scorerId || null, primaryAssistId: evForm.primaryAssistId || null, secondaryAssistId: evForm.secondaryAssistId || null, isOwnGoal: evForm.isOwnGoal, ownGoalPlayerId: evForm.ownGoalPlayerId || null };
                  const errs = validateGoalEvent(ev, m.teams);
                  if (errs.length) { alert(errs.map((e) => e.message).join('\n')); return; }
                  updateMatch(m.id, (x) => ({ ...x, events: [...x.events, { ...ev, id: x.events.length + 1 }] }));
                  setEvForm({ team: 'dark', scorerId: '', primaryAssistId: '', secondaryAssistId: '', isOwnGoal: false, ownGoalPlayerId: '' });
                }}>添加进球事件</button>
                <h4>分钟（可留空；勾选“估算”请注明）</h4>
                <div className="table-wrap"><table><thead><tr><th>球员</th><th>外场分钟</th><th>守门分钟</th><th>估算</th></tr></thead>
                  <tbody>{roster.map((id) => { const mm = m.minutes[id] ?? { outfield: null, gk: null, estimated: false }; return (
                    <tr key={id}><td>{snapName(id)}</td>
                      <td><input type="number" min={0} value={mm.outfield ?? ''} onChange={(e) => updateMatch(m.id, (x) => ({ ...x, minutes: { ...x.minutes, [id]: { ...mm, outfield: e.target.value === '' ? null : Number(e.target.value) } } }))} /></td>
                      <td><input type="number" min={0} value={mm.gk ?? ''} onChange={(e) => updateMatch(m.id, (x) => ({ ...x, minutes: { ...x.minutes, [id]: { ...mm, gk: e.target.value === '' ? null : Number(e.target.value) } } }))} /></td>
                      <td><input type="checkbox" checked={mm.estimated} onChange={(e) => updateMatch(m.id, (x) => ({ ...x, minutes: { ...x.minutes, [id]: { ...mm, estimated: e.target.checked } } }))} /></td>
                    </tr>); })}</tbody></table></div>
                <button onClick={() => { if (confirm('确定删除这场比赛记录吗？')) update((d) => ({ ...d, matches: d.matches.filter((x) => x.id !== m.id) })); setSelectedMatchId(null); }}>删除本场比赛</button>
              </div>
            );
          })()}
        </section>
      )}

      {tab === 'board' && (
        <section>
          <h3>累计榜（仅从逐球事件计算：进球 +1，主助攻 +1，副助攻 +0.5）</h3>
          <p className="muted">近期产出只作参考，不自动加入分组评分；没有记录的比赛不能推定产出为 0。分钟不完整时不显示每小时产出。</p>
          {([['累计', boardAll], ['最近 5 场', boardLast5]] as const).map(([label, rows]) => (
            <div key={label} className="card"><h4>{label}</h4>
              {rows.length === 0 ? <p>暂无记录。</p> : (
                <div className="table-wrap"><table><thead><tr><th>球员</th><th>进球</th><th>主助攻</th><th>副助攻</th><th>助攻积分</th><th>合计</th><th>每 60 分钟产出</th><th>样本</th></tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.playerId}><td>{nameOf(r.playerId)}</td><td>{r.goals}</td><td>{r.primary}</td><td>{r.secondary}</td><td>{r.assistPoints}</td><td><strong>{r.total}</strong></td>
                      <td>{r.per60 !== null ? fmt(r.per60) : '分钟不完整，不计算'}</td>
                      <td>{r.matchesPlayed} 场 / {r.outfieldMinutes !== null ? `${r.outfieldMinutes} 分钟` : '分钟不完整'}</td></tr>
                  ))}</tbody></table></div>
              )}
            </div>
          ))}
          <div className="card"><h3>搭档配合备注（初版不设默契加分，不按助攻次数自动判定默契）</h3>
            <div className="form-grid">
              <label>球员 A<select value={partnerForm.a} onChange={(e) => setPartnerForm({ ...partnerForm, a: e.target.value })}><option value="">—</option>{activePlayers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>球员 B<select value={partnerForm.b} onChange={(e) => setPartnerForm({ ...partnerForm, b: e.target.value })}><option value="">—</option>{activePlayers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>配合类型<input value={partnerForm.type} onChange={(e) => setPartnerForm({ ...partnerForm, type: e.target.value })} placeholder="如：边路套边 / 中路撞墙" /></label>
              <label>备注<input value={partnerForm.note} onChange={(e) => setPartnerForm({ ...partnerForm, note: e.target.value })} /></label>
            </div>
            <button disabled={!partnerForm.a || !partnerForm.b || partnerForm.a === partnerForm.b} onClick={() => {
              update((d) => ({ ...d, partnerships: [...d.partnerships, { id: uid(), playerAId: partnerForm.a, playerBId: partnerForm.b, type: partnerForm.type, evidenceMatches: [], note: partnerForm.note }] }));
              setPartnerForm({ a: '', b: '', type: '', note: '' });
            }}>保存搭档备注</button>
            <ul>{data.partnerships.map((p) => <li key={p.id}>{nameOf(p.playerAId)} × {nameOf(p.playerBId)} · {p.type} · {p.note}</li>)}</ul>
          </div>
        </section>
      )}

      {tab === 'backup' && (
        <section>
          <div className="card"><h3>数据备份</h3>
            <p>统一数据结构 schemaVersion 1，球员用稳定 ID 关联，显示名不是关联键。数据保存在本机浏览器 localStorage。当天状态与伤病不参与备份（只在当天页面内存里）。</p>
            <div className="row"><button onClick={doExport}>导出备份 JSON</button>
              <button onClick={() => fileRef.current?.click()}>导入 JSON（整体替换，需预览确认）</button>
              <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ''; }} />
            </div>
            {importErrors.length > 0 && <div className="warn"><strong>导入校验失败，原数据未变：</strong><ul>{importErrors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {importPreview && importErrors.length === 0 && (
              <div className="card"><h4>导入预览（整体替换）</h4>
                <p>球员 {importPreview.players.length} 人 · 比赛 {importPreview.matches.length} 场 · 搭档备注 {importPreview.partnerships.length} 条 · schemaVersion {importPreview.schemaVersion}</p>
                <p>球员：{importPreview.players.map((p) => p.name).join('、')}</p>
                <button onClick={() => { update(() => importPreview); setImportPreview(null); alert('已整体替换为导入的数据。'); }}>确认替换</button>
                <button onClick={() => setImportPreview(null)}>取消</button>
              </div>
            )}
          </div>
          <div className="card"><h3>花名册 Excel 导入 / 导出</h3>
            <p>按仓库里 <code>templates/球员评分模板.csv</code> 的表头填表，上传后整体替换花名册（比赛记录与搭档备注保留）。主位置=擅长、兼任=熟悉，其余默认未评估。</p>
            <div className="row">
              <button onClick={() => downloadWorkbook(templateWorkbook(), '球员评分模板.xlsx')}>下载 Excel 模板</button>
              <button onClick={() => exportRosterXlsx(data.players, `球员评分-${todayStr()}.xlsx`)}>导出当前花名册 Excel</button>
              <button onClick={() => rosterFileRef.current?.click()}>导入花名册（.xlsx / .csv）</button>
              <input ref={rosterFileRef} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onRosterFile(f); e.target.value = ''; }} />
            </div>
            {rosterErrors.length > 0 && <div className="warn"><strong>花名册导入校验失败，原数据未变：</strong><ul>{rosterErrors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {rosterPreview && rosterErrors.length === 0 && (
              <div className="card"><h4>花名册导入预览（整体替换花名册）</h4>
                <p>球员 {rosterPreview.length} 人：{rosterPreview.map((p) => p.name).join('、')}</p>
                <p className="warn">注意：导入后基线分组按导入顺序前一半深黑、后一半浅蓝；请在「球员档案」里核对基线队。</p>
                <button onClick={() => {
                  update((d) => {
                    const half = Math.ceil(rosterPreview.length / 2);
                    const baseline = { dark: rosterPreview.slice(0, half).map((p) => p.id), light: rosterPreview.slice(half).map((p) => p.id) };
                    const players = rosterPreview.map((p, i) => ({ ...p, baselineTeam: (i < half ? 'dark' : 'light') as TeamId }));
                    return { ...d, players, baseline };
                  });
                  setRosterPreview(null);
                  setSelected(new Set());
                  alert('花名册已替换。');
                }}>确认替换</button>
                <button onClick={() => setRosterPreview(null)}>取消</button>
              </div>
            )}
          </div>
          <div className="card"><h3>恢复示例数据</h3>
            <p>恢复到内置的 16 名虚构示例球员（会清空你导入的真实花名册与比赛记录，请先导出备份）。</p>
            <button onClick={() => { if (confirm('确定恢复示例数据吗？当前花名册与比赛记录将被清空。')) { resetToSeed(); setSelected(new Set()); alert('已恢复示例数据。'); } }}>恢复示例数据</button>
          </div>
          <div className="card"><h3>页面自检</h3>
            <p>自检只读当前球员数据、在深拷贝上运算，不会改动任何数据，也不会把样本状态写进页面默认值（2026-11-20 曾因此出过样本状态变成默认值的 bug）。</p>
            <button onClick={() => setSelfCheck(runSelfCheck(data.players))}>运行自检</button>
            {selfCheck && (
              <div>
                <p><strong>{selfCheck.passed ? '全部通过' : '有未通过项'}</strong>（{selfCheck.checks.filter((c) => c.ok).length}/{selfCheck.checks.length}）</p>
                <ul>{selfCheck.checks.map((c, i) => <li key={i}>{c.ok ? '✅' : '❌'} {c.name}：{c.detail}</li>)}</ul>
              </div>
            )}
          </div>
          <div className="card"><h3>算法与边界说明（v1.6）</h3>
            <ul>
              <li>位置版：阵型 3-3-1，7 个外场槽位与 Excel 位置一对一；覆盖只算擅长/熟悉，应急（代价 3）与未评估（代价 4）只填充不算覆盖，不适合禁止分配；无左右镜像。</li>
              <li>分组：枚举全部等人数分组（固定首人在 A 队去重），按（最大 Δ、体能+无球+回防 Δ 和、八项 Δ 和、稳定 ID 组合键）字典序排序，评分整数化（×2）避免浮点误差；先按能力取前 10 名，再按覆盖（最弱时段覆盖高→低、未覆盖总数少→多、能力排名前→后）取前 3 名推荐，默认选中覆盖第 1 名。</li>
              <li>输出名单：两队内部名字每次生成时随机排列（Fisher-Yates 洗牌）、黑/浅蓝归属抛硬币决定；只影响展示，分队、能力、覆盖、守门轮换不变；同一套方案在方案卡片、群公告、复制文本里顺序一致，重新生成才重新抽；比赛快照按当时的顺序与归属保存。</li>
              <li>硬约束默认开启，无可行方案时不自动放宽；奇数人数、缺评分时阻止数值推荐。支点/接应只算能踢外场的人。</li>
              <li>当天状态与伤病只调这一场有效评分：疲劳只扣体能（稍疲劳 -0.5，明显疲劳 -1，未知不扣）；轻伤速度体能各 -0.5；带伤上场速度体能各 -1、无球回防各 -0.5；叠加、每项最低 1 分、空仍为空、守门不受影响。扣分幅度是试行参数，没有比赛数据支持。</li>
              <li>「因伤不能守门」任何时候都能勾，不扣分，只不进守门轮换，改伤病不自动取消。「因伤只能守门」只有带伤上场才能勾，二选一，伤病改回自动取消；勾了的人整场固定守门，外场评分不计入本队平均（本队按 7 人算），一队最多一个。</li>
              <li>当天状态与伤病不保存在任何地方：只在当天页面内存里，刷新或关闭页面就丢掉，场次或日期一换就清空，比赛快照也不保存。</li>
              <li>守门轮换在能力分组之后核查，门将分不与外场分相加；缺守门评分显示未知。</li>
              <li>尚未经比赛验证的假设：八项等权、疲劳与伤病扣分幅度、角色约束的必要性均为试行设定，需用多场实际比分与平衡感受回测后再调。</li>
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
