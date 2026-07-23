/* ============================================================================
 *  덕몽어스 · 호스트 로직 시뮬레이션 테스트 (브라우저 없이)
 *    node test/host-sim.mjs
 *  렌더/UI 를 뺀 순수 게임 로직(맵·역할·호스트 상태머신)만 vm 에 올려 검증한다.
 * ==========================================================================*/
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILES = ['10-map.js', '15-roles.js', '20-net.js', '30-audio.js', '40-tasks.js', '50-game.js'];

/* ---- 브라우저 API 최소 스텁 ------------------------------------------------*/
const mem = {};
const stubEl = () => ({ style:{}, className:'', children:[], appendChild(){}, append(){}, addEventListener(){},
                        setAttribute(){}, remove(){}, getContext:() => null, querySelector:() => null });
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, RegExp, Error, Promise, isNaN, parseInt, parseFloat,
  Uint8Array, Int8Array, Infinity, NaN, undefined,
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage:   { getItem: k => mem['l:' + k] ?? null, setItem: (k, v) => { mem['l:' + k] = String(v); } },
  sessionStorage: { getItem: k => mem['s:' + k] ?? null, setItem: (k, v) => { mem['s:' + k] = String(v); } },
  document: { createElement: stubEl, createTextNode: () => ({}), addEventListener(){}, querySelector: () => null },
  navigator: { mediaDevices: null },
  Peer: function Peer() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  devicePixelRatio: 1,
  performance: { now: () => Date.now() },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const src = FILES.map(f => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n');
// 최상위 const 는 전역 객체 프로퍼티가 되지 않으므로 명시적으로 내보낸다
vm.runInContext(src + `
;globalThis.__api = { G, Host, Net, ROLES, roleInfo, isDuck, isGoose, isNeut, COLORS,
  DEFAULT_SETTINGS, TASK_SPOTS, VENTS, ROOMS, EMERGENCY_BTN, SAB_SPOTS, spotById,
  walkablePx, roomNameAt, moveWithCollision, visibilityPolygon, lineBlocked, WALLS, spawnPoints, assignRoles };
`, sandbox);

const A = sandbox.__api;
const { G, Host, Net } = A;

/* ---- 네트워크 캡처 ---------------------------------------------------------*/
const sent = [];
Net.isHost = true; Net.clockOffset = 0; Net.code = 'TEST';
Net.peer = { id: 'hostpeer' };
Net.broadcast = (t, d) => sent.push({ to: '*', t, d });
Net.toPeer = (peer, t, d) => sent.push({ to: peer, t, d });
Net.toHost = () => {};
Net.emit = () => {};

/* ---- 테스트 유틸 -----------------------------------------------------------*/
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra) {
  if (cond) { pass++; results.push(`  ✅ ${name}`); }
  else { fail++; results.push(`  ❌ ${name}${extra !== undefined ? '  →  ' + JSON.stringify(extra) : ''}`); }
}
function section(t) { results.push(`\n▸ ${t}`); }

function reset(n = 5) {
  Host.P = {}; Host.M = null; Host.peerToId = {}; sent.length = 0;
  G.phase = 'lobby'; G.order = []; G.bodies = []; G.sabotage = null; G.doors = {};
  G.result = null; G.taskBar = { done:0, total:0 }; G.round = 1;
  G.settings = JSON.parse(JSON.stringify(A.DEFAULT_SETTINGS));
  const names = ['호스트','파랑','초록','분홍','노랑','보라','하늘','검정'];
  for (let i = 0; i < n; i++) Host.addPlayer('peer' + i, 'uid' + i, names[i], null);
  G.myId = G.order[0]; G.hostId = G.order[0];
  Host.peerToId['self'] = G.order[0];
  return G.order.map(id => Host.P[id]);
}
/** 역할을 강제 지정하고 임무바를 재계산 */
function setRoles(map) {
  for (const [name, role] of Object.entries(map)) {
    const p = Object.values(Host.P).find(q => q.name === name);
    p.role = role;
    p.abilityUses = A.roleInfo(role).uses || 0;
  }
  Host.recalcTaskBar();
}
const byName = n => Object.values(Host.P).find(p => p.name === n);
const put = (p, x, y) => { p.x = x; p.y = y; };

/* ══════════════════════════════════════════════════════════════════════════ */
section('맵 · 충돌 · 시야');
{
  ok('스폰 지점이 모두 통행 가능', A.spawnPoints(10).every(s => A.walkablePx(s.x, s.y)));
  ok('임무 지점이 모두 통행 가능',
     A.TASK_SPOTS.every(t => A.walkablePx(t.wx, t.wy)),
     A.TASK_SPOTS.filter(t => !A.walkablePx(t.wx, t.wy)).map(t => t.id));
  ok('벤트가 모두 통행 가능',
     A.VENTS.every(v => A.walkablePx(v.wx, v.wy)),
     A.VENTS.filter(v => !A.walkablePx(v.wx, v.wy)).map(v => v.id));
  ok('사보타주 지점이 모두 통행 가능',
     Object.values(A.SAB_SPOTS).flat().every(s => A.walkablePx(s.wx, s.wy)),
     Object.values(A.SAB_SPOTS).flat().filter(s => !A.walkablePx(s.wx, s.wy)).map(s => s.key + '@' + s.room));
  ok('긴급버튼이 통행 가능', A.walkablePx(A.EMERGENCY_BTN.wx, A.EMERGENCY_BTN.wy));
  ok('벽 선분이 추출됨', A.WALLS.length > 50, A.WALLS.length);
  ok('시야 폴리곤이 생성됨', A.visibilityPolygon(A.EMERGENCY_BTN.wx, A.EMERGENCY_BTN.wy, 330).length > 20);
  // 벽 안으로 못 들어감
  const r = A.moveWithCollision(A.EMERGENCY_BTN.wx, A.EMERGENCY_BTN.wy, 0, -9999);
  ok('벽을 통과하지 못함', A.walkablePx(r.x, r.y));
  // 모든 방이 헛간 앞마당에서 도달 가능한지 (BFS)
  const reach = (() => {
    const T = 32, seen = new Set(), q = [[Math.floor(A.EMERGENCY_BTN.wx/T), Math.floor(A.EMERGENCY_BTN.wy/T)]];
    while (q.length) {
      const [x, y] = q.pop(); const k = x + ',' + y;
      if (seen.has(k) || !A.walkablePx(x*T+16, y*T+16)) continue;
      seen.add(k);
      q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    return seen;
  })();
  const unreachable = A.ROOMS.filter(rm => {
    const cx = Math.floor(rm.x + rm.w/2), cy = Math.floor(rm.y + rm.h/2);
    return !reach.has(cx + ',' + cy);
  }).map(rm => rm.name);
  ok('모든 방이 헛간 앞마당에서 도달 가능', unreachable.length === 0, unreachable);
  const unreachableTask = A.TASK_SPOTS.filter(t => !reach.has(Math.floor(t.wx/32) + ',' + Math.floor(t.wy/32))).map(t => t.id);
  ok('모든 임무 지점 도달 가능', unreachableTask.length === 0, unreachableTask);
}

section('역할 배정');
{
  for (let trial = 0; trial < 200; trial++) {
    reset(8);
    G.settings.duckCount = 2; G.settings.neutralCount = 1;
    const roles = A.assignRoles(G.order, G.settings);
    const ducks = Object.values(roles).filter(A.isDuck).length;
    const neuts = Object.values(roles).filter(A.isNeut).length;
    if (ducks !== 2 || neuts > 1 || Object.keys(roles).length !== 8) {
      ok('역할 배정 인원 구성', false, { ducks, neuts, roles }); break;
    }
  }
  if (fail === 0 || !results.at(-1).includes('역할 배정')) ok('역할 배정 인원 구성 (200회)', true);

  reset(4);
  G.settings.duckCount = 3;           // 4명인데 오리 3 → 과반 방지 클램프 필요
  const roles = A.assignRoles(G.order, G.settings);
  const d = Object.values(roles).filter(A.isDuck).length;
  ok('오리 수가 인원에 맞게 제한됨 (4명→오리 1)', d === 1, d);
}

section('게임 시작 · 임무');
{
  reset(5);
  Host.startGame();
  ok('phase = play', G.phase === 'play');
  ok('전원 역할 배정', G.order.every(id => Host.P[id].role));
  ok('전원 임무 목록 보유', G.order.every(id => Host.P[id].tasks.length > 0));
  ok('임무바 총량 > 0', G.taskBar.total > 0, G.taskBar);
  const fakers = G.order.filter(id => A.roleInfo(Host.P[id].role).fakeTasks);
  const realTotal = G.order.filter(id => !A.roleInfo(Host.P[id].role).fakeTasks)
                           .reduce((a, id) => a + Host.P[id].tasks.reduce((b, t) => b + t.spots.length, 0), 0);
  ok('가짜 임무 역할은 진행바에서 제외', G.taskBar.total === realTotal, { total: G.taskBar.total, realTotal, fakers: fakers.length });
  ok('공통 임무는 전원 동일',
     new Set(G.order.map(id => Host.P[id].tasks[0].spots.join(','))).size === 1);
}

section('살해 판정');
{
  reset(5);
  Host.startGame();
  setRoles({ 호스트:'duck', 파랑:'goose', 초록:'goose', 분홍:'goose', 노랑:'doctor' });
  const k = byName('호스트'), v = byName('파랑');
  k.killCdEnd = 0;

  put(k, 1888, 400); put(v, 1888, 900);          // 500px = 사거리 밖
  Host.onKill(k.id, v.id);
  ok('사거리 밖에서는 살해 불가', v.alive === true);

  put(v, 1888, 450);                              // 50px = 사거리 안
  Host.onKill(k.id, v.id);
  ok('사거리 안에서 살해 성공', v.alive === false);
  ok('시체 생성', G.bodies.length === 1 && G.bodies[0].pid === v.id);
  ok('킬 쿨다운 적용', k.killCdEnd > Date.now());
  ok('kill 이벤트에 범인 정보 없음',
     sent.filter(s => s.t === 'event' && s.d.type === 'kill').every(s => s.d.killer === undefined));

  // 쿨다운 중 재살해 불가
  const v2 = byName('초록'); put(v2, 1888, 450);
  Host.onKill(k.id, v2.id);
  ok('쿨다운 중에는 살해 불가', v2.alive === true);
}

section('의사 방패');
{
  reset(5);
  Host.startGame();
  setRoles({ 호스트:'duck', 파랑:'doctor', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const doc = byName('파랑'), tgt = byName('초록'), k = byName('호스트');
  put(doc, 1888, 400); put(tgt, 1888, 430); put(k, 1888, 430);
  doc.abilityUses = 1;
  Host.onAbility(doc.id, { kind:'shield', target: tgt.id });
  ok('방패 부여됨', tgt.shielded === true);
  k.killCdEnd = 0;
  Host.onKill(k.id, tgt.id);
  ok('방패가 살해를 막음', tgt.alive === true && tgt.shielded === false);
  ok('막혀도 킬 쿨다운은 돎', k.killCdEnd > Date.now());
  k.killCdEnd = 0;
  Host.onKill(k.id, tgt.id);
  ok('방패 소진 후에는 살해됨', tgt.alive === false);
}

section('보안관');
{
  reset(5); Host.startGame();
  setRoles({ 호스트:'sheriff', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const s = byName('호스트'), duck = byName('파랑'), goose = byName('초록');
  s.abilityUses = 1; s.abilityCdEnd = 0;
  put(s, 1888, 400); put(duck, 1888, 430);
  Host.onAbility(s.id, { kind:'shoot', target: duck.id });
  ok('오리를 쏘면 오리가 죽음', duck.alive === false && s.alive === true);

  reset(5); Host.startGame();
  setRoles({ 호스트:'sheriff', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const s2 = byName('호스트'), g2 = byName('초록');
  s2.abilityUses = 1; s2.abilityCdEnd = 0;
  put(s2, 1888, 400); put(g2, 1888, 430);
  Host.onAbility(s2.id, { kind:'shoot', target: g2.id });
  ok('거위를 쏘면 보안관만 죽고 대상은 산다', s2.alive === false && g2.alive === true,
     { sheriff: s2.alive, goose: g2.alive });
}

section('캐나다거위 자폭');
{
  reset(5); Host.startGame();
  setRoles({ 호스트:'canadian', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const c = byName('호스트'), g = byName('초록');
  c.killCdEnd = 0; put(c, 1888, 400); put(g, 1888, 430);
  Host.onKill(c.id, g.id);
  ok('거위를 죽이면 캐나다거위도 죽음', c.alive === false && g.alive === false);
}

section('회의 · 투표 · 추방');
{
  reset(5); Host.startGame();
  setRoles({ 호스트:'goose', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const duck = byName('파랑'), victim = byName('노랑'), reporter = byName('호스트');
  duck.killCdEnd = 0;
  put(duck, 1888, 400); put(victim, 1888, 430);
  Host.onKill(duck.id, victim.id);
  put(reporter, 1888, 440);
  Host.onReport(reporter.id, G.bodies[0].id);
  ok('신고 시 회의 시작', G.phase === 'meeting' && Host.M !== null);
  ok('시체 목록 초기화', G.bodies.length === 0);
  ok('회의 상태는 Host.M 이 권한', Host.M.phase === 'discuss');

  // 투표 단계로
  Host.M.endsAt = Date.now() - 1; Host.tick();
  ok('토론 종료 후 투표 단계', Host.M.phase === 'vote');

  // 마스킹 확인
  const masked = Host.pubMeeting();
  Host.onVote(reporter.id, duck.id);
  const masked2 = Host.pubMeeting();
  ok('투표 중 대상은 가려짐', Object.values(masked2.votes).every(v => v === '__hidden__'), masked2.votes);
  ok('원본 투표는 보존됨', Host.M.votes[reporter.id] === duck.id);

  // 나머지 전원 오리에게 투표 → 자동 개표
  Host.onVote(byName('초록').id, duck.id);
  Host.onVote(byName('분홍').id, duck.id);
  Host.onVote(duck.id, 'skip');
  ok('전원 투표 시 자동 개표', Host.M.tally !== null);
  ok('최다 득표자 추방', Host.M.tally.ejectId === duck.id, Host.M.tally);
  ok('추방자 사망 처리', duck.alive === false);
  ok('phase = eject', G.phase === 'eject');

  const ejEv = sent.filter(s => s.t === 'event' && s.d.type === 'ejectresult').pop();
  ok('직업 공개 ON → role 전송', ejEv.d.role === 'duck');

  Host.resumePlay();
  ok('오리 전멸 → 거위 승리', G.phase === 'over' && G.result.faction === 'goose', G.result);
}

section('추방 직업 비공개 설정');
{
  reset(5); Host.startGame();
  G.settings.confirmEject = false;
  setRoles({ 호스트:'goose', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  Host.startMeeting(byName('호스트').id, null);
  Host.M.phase = 'vote';
  const duck = byName('파랑');
  G.order.forEach(id => Host.onVote(id, duck.id));
  const ev = sent.filter(s => s.t === 'event' && s.d.type === 'ejectresult').pop();
  ok('비공개 설정이면 role 자체를 안 보냄', ev.d.role === null && ev.d.remainDucks === null, ev.d);
}

section('동표 · 스킵');
{
  reset(5); Host.startGame();
  setRoles({ 호스트:'goose', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  Host.startMeeting(byName('호스트').id, null);
  Host.M.phase = 'vote';
  Host.onVote(byName('호스트').id, byName('파랑').id);
  Host.onVote(byName('파랑').id, byName('호스트').id);
  Host.onVote(byName('초록').id, 'skip');
  Host.onVote(byName('분홍').id, 'skip');
  Host.onVote(byName('노랑').id, 'skip');
  ok('스킵 최다면 아무도 추방되지 않음', Host.M.tally.ejectId === null, Host.M.tally);

  reset(4); Host.startGame();
  setRoles({ 호스트:'goose', 파랑:'duck', 초록:'goose', 분홍:'goose' });
  Host.startMeeting(byName('호스트').id, null);
  Host.M.phase = 'vote';
  Host.onVote(byName('호스트').id, byName('파랑').id);
  Host.onVote(byName('초록').id, byName('파랑').id);
  Host.onVote(byName('파랑').id, byName('호스트').id);
  Host.onVote(byName('분홍').id, byName('호스트').id);
  ok('동표면 추방 없음', Host.M.tally.ejectId === null, Host.M.tally);
}

section('정치인 2표');
{
  reset(5); Host.startGame();
  setRoles({ 호스트:'politician', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  Host.startMeeting(byName('호스트').id, null);
  Host.M.phase = 'vote';
  Host.onVote(byName('호스트').id, byName('파랑').id);   // 2표
  Host.onVote(byName('초록').id, byName('호스트').id);   // 1표
  Host.onVote(byName('분홍').id, 'skip');
  Host.onVote(byName('노랑').id, 'skip');
  Host.onVote(byName('파랑').id, 'skip');
  ok('정치인 표가 2로 계산됨', Host.M.tally.counts[byName('파랑').id] === 2, Host.M.tally.counts);
}

section('승리 조건');
{
  // 오리 과반
  reset(4); Host.startGame();
  setRoles({ 호스트:'duck', 파랑:'goose', 초록:'goose', 분홍:'goose' });
  const k = byName('호스트');
  [byName('파랑'), byName('초록')].forEach(v => { k.killCdEnd = 0; put(k, 1888, 400); put(v, 1888, 420); Host.onKill(k.id, v.id); });
  ok('오리 수 == 거위 수 → 오리 승리', G.phase === 'over' && G.result.faction === 'duck', G.result);

  // 임무 완수
  reset(4); Host.startGame();
  setRoles({ 호스트:'goose', 파랑:'goose', 초록:'goose', 분홍:'duck' });
  G.order.forEach(id => { const p = Host.P[id];
    if (A.roleInfo(p.role).fakeTasks) return;
    p.tasks.forEach(t => { while (t.step < t.spots.length) Host.onTaskStep(id, t.tid); }); });
  ok('임무 100% → 거위 승리', G.phase === 'over' && G.result.faction === 'goose', G.result);

  // 독수리 — 오리가 과반에 먼저 도달하지 않도록 7명으로
  reset(7); Host.startGame();
  setRoles({ 호스트:'vulture', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'goose', 보라:'goose', 하늘:'goose' });
  const vul = byName('호스트'); const dk = byName('파랑');
  for (const nm of ['초록','분홍','노랑']) {
    const v = byName(nm); dk.killCdEnd = 0; put(dk, 1888, 400); put(v, 1888, 420);
    Host.onKill(dk.id, v.id);
    const body = G.bodies[G.bodies.length - 1];
    put(vul, body.x, body.y);
    Host.onAbility(vul.id, { kind:'eat' });
  }
  ok('독수리 시체 3구 → 단독 승리',
     G.phase === 'over' && G.result.faction === 'neutral' && G.result.winners.length === 1 && G.result.winners[0] === vul.id,
     G.result && { f: G.result.faction, w: G.result.winners.length, eaten: vul.eaten });

  // 비둘기 — 오리가 없으면 "오리 전멸"로 거위가 먼저 이기므로 오리를 1명 넣는다
  reset(5); Host.startGame();
  setRoles({ 호스트:'pigeon', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const pig = byName('호스트');
  for (const nm of ['파랑','초록','분홍','노랑']) {
    const t = byName(nm); put(pig, 1888, 400); put(t, 1888, 420);
    pig.abilityCdEnd = 0;
    Host.onAbility(pig.id, { kind:'infect', target: t.id });
  }
  ok('비둘기 전원 감염 → 단독 승리',
     G.phase === 'over' && G.result.faction === 'neutral' && G.result.winners[0] === pig.id, G.result);
}

section('사보타주');
{
  reset(5); Host.startGame();
  setRoles({ 호스트:'duck', 파랑:'goose', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const d = byName('호스트'), g = byName('파랑');
  G.sabCdEnd = 0;
  Host.onSabotage(g.id, 'lights');
  ok('거위는 사보타주 불가', G.sabotage === null);
  Host.onSabotage(d.id, 'lights');
  ok('오리가 정전 발동', G.sabotage?.kind === 'lights');
  ok('정전은 제한시간 없음', G.sabotage.endsAt === 0);
  G.sabotage.data.switches.forEach((_, i) => Host.onSabFix(g.id, { kind:'lights', idx:i, val:1 }));
  ok('스위치 전부 올리면 복구', G.sabotage === null);

  G.sabCdEnd = 0;
  Host.onSabotage(d.id, 'reactor');
  ok('물레방아 제한시간 설정됨', G.sabotage?.endsAt > Date.now());
  Host.onSabFix(g.id, { kind:'reactor', idx:0, val:1 });
  ok('한쪽만 잡으면 복구 안 됨', G.sabotage !== null);
  Host.onSabFix(byName('초록').id, { kind:'reactor', idx:1, val:1 });
  ok('양쪽 동시에 잡으면 복구', G.sabotage === null);

  G.sabCdEnd = 0;
  Host.onSabotage(d.id, 'oxygen');
  G.sabotage.endsAt = Date.now() - 1;
  Host.tick();
  ok('산소 제한시간 초과 → 오리 승리', G.phase === 'over' && G.result.faction === 'duck', G.result);
}

section('벤트');
{
  reset(5); Host.startGame();
  setRoles({ 호스트:'duck', 파랑:'goose', 초록:'birdwatcher', 분홍:'goose', 노랑:'goose' });
  const d = byName('호스트'), g = byName('파랑');
  const v0 = A.VENTS[0];
  put(g, v0.wx, v0.wy);
  Host.onVent(g.id, v0.id);
  ok('일반 거위는 벤트 사용 불가', g.ventId === null);

  put(d, v0.wx, v0.wy);
  Host.onVent(d.id, v0.id);
  ok('오리는 벤트 진입 가능', d.ventId === v0.id);
  const same = A.VENTS.filter(v => v.net === v0.net && v.id !== v0.id)[0];
  Host.onVent(d.id, same.id);
  ok('같은 네트워크로 이동 가능', d.ventId === same.id);
  ok('벤트 이동 시 위치도 갱신', d.x === same.wx && d.y === same.wy);
  const other = A.VENTS.find(v => v.net !== v0.net);
  Host.onVent(d.id, other.id);
  ok('다른 네트워크로는 이동 불가', d.ventId === same.id);

  sent.length = 0;
  Host.onVent(d.id, null);
  const ventEv = sent.filter(s => s.t === 'event' && s.d.type === 'vent');
  ok('벤트 이벤트에 사용자 id 없음', ventEv.every(s => s.d.pid === undefined), ventEv.map(s => s.d));
  const alerts = sent.filter(s => s.t === 'ventalert');
  ok('조류관찰자에게만 개별 알림', alerts.length === 1 && alerts[0].to === byName('초록').peerId, alerts);
}

section('탐정 · 장의사');
{
  reset(5); Host.startGame();
  setRoles({ 호스트:'detective', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const det = byName('호스트'), duck = byName('파랑'), v = byName('노랑');
  duck.killCdEnd = 0; put(duck, 1888, 400); put(v, 1888, 420);
  Host.onKill(duck.id, v.id);
  put(det, 1888, 410); det.abilityCdEnd = 0;
  sent.length = 0;
  Host.onAbility(det.id, { kind:'investigate', target: duck.id });
  const log = sent.filter(s => s.t === 'privlog').pop();
  ok('탐정이 살인 사실을 탐지', log && log.d.text.includes('있음'), log?.d.text);
  ok('탐정 결과는 개인 전송', log.to === det.peerId);

  reset(5); Host.startGame();
  setRoles({ 호스트:'mortician', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'engineer' });
  const mor = byName('호스트'), dk = byName('파랑'), vic = byName('노랑');
  dk.killCdEnd = 0; put(dk, 1888, 400); put(vic, 1888, 420);
  Host.onKill(dk.id, vic.id);
  put(mor, G.bodies[0].x, G.bodies[0].y);
  sent.length = 0;
  Host.onAbility(mor.id, { kind:'autopsy', body: G.bodies[0].id });
  const alog = sent.filter(s => s.t === 'privlog').pop();
  ok('장의사가 사망자 직업을 알아냄', alog && alog.d.text.includes('기술자'), alog?.d.text);
}

section('암살자');
{
  reset(5); Host.startGame();
  setRoles({ 호스트:'assassin', 파랑:'detective', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const as = byName('호스트'), t = byName('파랑');
  as.abilityUses = 2;
  Host.startMeeting(as.id, null);
  Host.onAbility(as.id, { kind:'guess', target: t.id, role:'goose' });
  ok('직업을 틀리면 암살자가 죽음', as.alive === false && t.alive === true);

  reset(5); Host.startGame();
  setRoles({ 호스트:'assassin', 파랑:'detective', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const as2 = byName('호스트'), t2 = byName('파랑');
  as2.abilityUses = 2;
  Host.startMeeting(as2.id, null);
  Host.onAbility(as2.id, { kind:'guess', target: t2.id, role:'detective' });
  ok('직업을 맞히면 대상이 죽음', t2.alive === false && as2.alive === true);
}

section('첩자 · 유령 임무');
{
  reset(5); Host.startGame();
  setRoles({ 호스트:'spy', 파랑:'goose', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const spy = byName('호스트');
  const before = G.taskBar.done;
  Host.onTaskStep(spy.id, spy.tasks[0].tid);
  ok('첩자의 임무는 진행바를 실제로 채움', G.taskBar.done === before + 1, { before, after: G.taskBar.done });

  reset(5); Host.startGame();
  setRoles({ 호스트:'duck', 파랑:'goose', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const dk = byName('호스트');
  const before2 = G.taskBar.done;
  Host.onTaskStep(dk.id, dk.tasks[0].tid);
  ok('오리의 가짜 임무는 진행바에 반영 안 됨', G.taskBar.done === before2, { before: before2, after: G.taskBar.done });

  const ghost = byName('파랑');
  dk.killCdEnd = 0; put(dk, 1888, 400); put(ghost, 1888, 420);
  Host.onKill(dk.id, ghost.id);
  const b3 = G.taskBar.done;
  Host.onTaskStep(ghost.id, ghost.tasks[0].tid);
  ok('유령도 임무 수행 가능 (설정 ON)', G.taskBar.done === b3 + 1);
  G.settings.ghostTasks = false;
  const b4 = G.taskBar.done;
  Host.onTaskStep(ghost.id, ghost.tasks[1].tid);
  ok('설정 OFF면 유령 임무 불가', G.taskBar.done === b4);
}

section('재접속 복구');
{
  reset(5); Host.startGame();
  const p = byName('파랑');
  const oldId = p.id, oldRole = p.role;
  p.tasks[0].step = 1;
  Host.onMsg({ t:'hello', uid:'uid1', name:'파랑' }, 'newpeer');
  ok('같은 uid 는 같은 플레이어로 복귀', byName('파랑').id === oldId);
  ok('역할·임무 진행이 보존됨', byName('파랑').role === oldRole && byName('파랑').tasks[0].step === 1);
  ok('peerId 갱신', Host.P[oldId].peerId === 'newpeer' && Host.peerToId['newpeer'] === oldId);
  ok('게임 중 새 uid 는 입장 거부',
     (() => { const n = G.order.length; Host.onMsg({ t:'hello', uid:'stranger', name:'난입' }, 'p9'); return G.order.length === n; })());
}

section('경호원 · 추적자 · 펠리컨');
{
  // 경호원 — 대신 죽고 대상은 산다
  reset(5); Host.startGame();
  setRoles({ 호스트:'bodyguard', 파랑:'goose', 초록:'duck', 분홍:'goose', 노랑:'goose' });
  const bg = byName('호스트'), prot = byName('파랑'), dk = byName('초록');
  bg.abilityUses = 1;
  put(bg, 1888, 400); put(prot, 1888, 430);
  Host.onAbility(bg.id, { kind:'guard', target: prot.id });
  ok('경호 대상 지정됨', bg.guarding === prot.id);
  dk.killCdEnd = 0; put(dk, 1888, 420);
  Host.onKill(dk.id, prot.id);
  ok('경호원이 대신 죽는다', bg.alive === false);
  ok('경호 대상은 살아남는다', prot.alive === true);
  ok('경호는 1회로 소진', bg.guarding === null);
  ok('경호 발동 후에도 킬 쿨다운은 돈다', dk.killCdEnd > Date.now());

  // 경호 소진 후에는 정상 사망
  reset(5); Host.startGame();
  setRoles({ 호스트:'bodyguard', 파랑:'goose', 초록:'duck', 분홍:'goose', 노랑:'goose' });
  const bg2 = byName('호스트'), pr2 = byName('파랑'), dk2 = byName('초록');
  bg2.abilityUses = 0;                          // 이미 다 씀
  put(bg2, 1888, 400); put(pr2, 1888, 430); put(dk2, 1888, 420);
  Host.onAbility(bg2.id, { kind:'guard', target: pr2.id });
  ok('횟수 없으면 경호 지정 불가', bg2.guarding == null);
  dk2.killCdEnd = 0; Host.onKill(dk2.id, pr2.id);
  ok('경호 없으면 정상 사망', pr2.alive === false && bg2.alive === true);

  // 추적자
  reset(5); Host.startGame();
  setRoles({ 호스트:'tracker', 파랑:'duck', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const tr = byName('호스트'), tgt = byName('파랑');
  tr.abilityCdEnd = 0;
  put(tr, 1888, 400); put(tgt, 1888, 450);
  Host.onAbility(tr.id, { kind:'track', target: tgt.id });
  ok('추적 대상 지정', tr.trackTarget === tgt.id && tr.trackEnd > Date.now());
  put(tgt, 300, 1600);                          // 시야 밖으로 멀리 보낸다
  sent.length = 0; Host.sendSnap();
  const snapToTracker = sent.find(s => s.t === 'snap' && s.to === tr.peerId);
  ok('추적자는 시야 밖 대상 좌표를 받는다',
     !!snapToTracker?.d.trk && snapToTracker.d.trk[0] === 300, snapToTracker?.d.trk);
  ok('추적해도 대상이 화면에 그려지진 않음 (스냅샷 목록엔 없음)',
     !snapToTracker.d.p.some(a => a[0] === tgt.id));
  const snapToOther = sent.find(s => s.t === 'snap' && s.to === byName('초록').peerId);
  ok('다른 사람에게는 추적 좌표가 안 감', !snapToOther?.d.trk);
  tr.trackEnd = Date.now() - 1;
  sent.length = 0; Host.sendSnap();
  ok('추적 시간이 끝나면 좌표 전송 중단',
     !sent.find(s => s.t === 'snap' && s.to === tr.peerId)?.d.trk);

  // 펠리컨 — 시체가 남지 않는다
  reset(5); Host.startGame();
  setRoles({ 호스트:'pelican', 파랑:'goose', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const pel = byName('호스트'), v = byName('파랑');
  pel.killCdEnd = 0; put(pel, 1888, 400); put(v, 1888, 430);
  Host.onKill(pel.id, v.id);
  ok('펠리컨에게 죽으면 사망은 한다', v.alive === false);
  ok('펠리컨은 시체를 남기지 않는다', G.bodies.length === 0, G.bodies.length);

  // 일반 오리는 시체를 남긴다 (대조군)
  reset(5); Host.startGame();
  setRoles({ 호스트:'duck', 파랑:'goose', 초록:'goose', 분홍:'goose', 노랑:'goose' });
  const d2 = byName('호스트'), v2 = byName('파랑');
  d2.killCdEnd = 0; put(d2, 1888, 400); put(v2, 1888, 430);
  Host.onKill(d2.id, v2.id);
  ok('일반 오리는 시체를 남긴다', G.bodies.length === 1);
}

section('시야 컬링 (치트 방지)');
{
  reset(5); Host.startGame();
  setRoles({ 호스트:'goose', 파랑:'goose', 초록:'goose', 분홍:'goose', 노랑:'duck' });
  const me = byName('호스트'), near = byName('파랑'), far = byName('초록'), duck = byName('노랑');

  // state 브로드캐스트에 좌표가 없어야 한다
  sent.length = 0; Host.pushState();
  const st = sent.find(s => s.t === 'state');
  ok('state 에 좌표가 들어있지 않음',
     st.d.players.every(p => p.x === undefined && p.y === undefined),
     Object.keys(st.d.players[0]));

  // 같은 방 · 가까움 → 보인다
  put(me, 1888, 400); put(near, 1930, 410);
  ok('가까운 사람은 보인다', Host.visibleTo(me).some(p => p.id === near.id));

  // 멀리 → 안 보인다
  put(far, 300, 1600);
  ok('먼 사람은 스냅샷에서 제외', !Host.visibleTo(me).some(p => p.id === far.id));

  // 벽 너머 → 안 보인다 (헛간 앞마당 좌상단 ↔ 동물병원 복도, 사이에 헛간 앞마당 왼쪽 벽)
  put(me,  49 * 32 + 16,  6 * 32 + 16);
  put(far, 45 * 32 + 16, 12 * 32 + 16);
  const d = Math.hypot(me.x - far.x, me.y - far.y);
  ok('테스트 전제: 시야 반경 안', d < G.settings.visionCrew, Math.round(d));
  ok('테스트 전제: 둘 다 통행 가능 지점',
     A.walkablePx(me.x, me.y) && A.walkablePx(far.x, far.y));
  ok('테스트 전제: 두 점 사이가 벽으로 막힘', A.lineBlocked(me.x, me.y, far.x, far.y));
  ok('벽 뒤 사람은 안 보인다', !Host.visibleTo(me).some(p => p.id === far.id));

  // 자기 자신은 항상 포함
  ok('자기 자신은 항상 포함', Host.visibleTo(me).some(p => p.id === me.id));

  // 벤트 안 사람은 안 보인다
  put(duck, me.x + 30, me.y);
  duck.ventId = 'v1';
  ok('벤트 안은 산 사람에게 안 보임', !Host.visibleTo(me).some(p => p.id === duck.id));
  duck.ventId = null;

  // 유령은 전원 다 보인다
  put(far, 300, 1600);
  me.alive = false;
  ok('유령은 전원이 보인다', Host.visibleTo(me).length === G.order.length, Host.visibleTo(me).length);
  me.alive = true;

  // 죽은 사람은 산 사람에게 안 보인다
  near.alive = false;
  put(near, me.x + 30, me.y);
  ok('유령은 산 사람에게 안 보임', !Host.visibleTo(me).some(p => p.id === near.id));
  near.alive = true;

  // 오리는 시야가 더 넓다
  const g1 = byName('분홍'); g1.role = 'goose';
  put(g1, me.x + G.settings.visionCrew + 100, me.y);
  const duckViewer = duck; duckViewer.role = 'duck';
  put(duckViewer, me.x, me.y);
  ok('오리 시야가 거위보다 넓다', G.settings.visionDuck > G.settings.visionCrew);

  // 사무실 정보는 서버가 계산해 준다
  sent.length = 0;
  Host.onReqInfo(me.id, 'admin');
  const info = sent.find(s => s.t === 'info');
  ok('사무실은 방별 인원수만 응답 (누구인지는 없음)',
     !!info && info.d.kind === 'admin' && typeof info.d.counts === 'object'
     && JSON.stringify(info.d).indexOf('"id"') === -1, info?.d);
  // 통신 두절 중에는 차단
  G.sabotage = { kind:'comms', endsAt:0, data:{ dials:[0,0] } };
  sent.length = 0; Host.onReqInfo(me.id, 'admin');
  ok('방송 두절 시 사무실 차단', sent.find(s => s.t === 'info')?.d.blocked === true);
  G.sabotage = null;
}

section('방장 마이그레이션');
{
  reset(6); Host.startGame();
  setRoles({ 호스트:'duck', 파랑:'detective', 초록:'goose', 분홍:'engineer', 노랑:'vulture', 보라:'goose' });
  const 파랑 = byName('파랑'), 초록 = byName('초록'), 분홍 = byName('분홍');
  // 진행 상태를 만들어 둔다
  파랑.tasks[0].step = 1; Host.recalcTaskBar();
  분홍.abilityUses = 0;
  const dk = byName('호스트'); dk.killCdEnd = 0;
  put(dk, 1888, 400); put(byName('보라'), 1888, 420);
  Host.onKill(dk.id, byName('보라').id);
  G.sabCdEnd = 0; Host.onSabotage(dk.id, 'oxygen');
  const bodyCount = G.bodies.length, taskDone = G.taskBar.done;
  const sabEndsAt = G.sabotage.endsAt, sabCode = G.sabotage.data.code;

  ok('후계자는 방장 다음의 접속자', Host.successorId() === 파랑.id, Host.successorId());

  sent.length = 0;
  Host.pushMigration();
  const mig = sent.find(s => s.t === 'migstate');
  ok('후계자에게만 상태 전송', !!mig && mig.to === 파랑.peerId, sent.map(s => s.t + '→' + s.to));
  ok('후계자 지정이 방송됨', sent.some(s => s.t === 'successor' && s.d.id === 파랑.id));

  /* ── 파랑이 방장을 인계받는다. 파랑의 시계가 3초 빠르다고 가정 ── */
  const snap = JSON.parse(JSON.stringify(mig.d.s));
  const OLD_OFFSET = -3000;                       // 이전방장시각 − 내시각 = -3000 (내 시계가 3초 빠름)
  const newHostId = 파랑.id;
  Host.P = {}; Host.M = null; Host.peerToId = {};  // 새 프로세스라고 가정
  Host.importState(snap, newHostId, OLD_OFFSET);

  ok('전원 역할이 보존됨',
     Host.P[초록.id].role === 'goose' && Host.P[분홍.id].role === 'engineer' && Host.P[newHostId].role === 'detective',
     Object.values(Host.P).map(p => p.name + ':' + p.role));
  ok('임무 진행이 보존됨', Host.P[newHostId].tasks[0].step === 1);
  ok('임무바가 보존됨', G.taskBar.done === taskDone, { now: G.taskBar.done, was: taskDone });
  ok('시체가 보존됨', G.bodies.length === bodyCount);
  ok('사망 상태가 보존됨', Host.P[byName('보라').id].alive === false);
  ok('능력 사용 횟수 보존', Host.P[분홍.id].abilityUses === 0);
  ok('사보타주가 보존됨', G.sabotage?.kind === 'oxygen' && G.sabotage.data.code === sabCode);
  ok('사보타주 마감시각이 내 시계로 보정됨',
     Math.abs(G.sabotage.endsAt - (sabEndsAt - OLD_OFFSET)) < 2,
     { now: G.sabotage.endsAt, expect: sabEndsAt - OLD_OFFSET });
  ok('새 방장이 hostId 로 설정됨', G.hostId === newHostId && G.myId === newHostId);
  ok('새 방장만 접속 상태', Host.P[newHostId].connected === true && Host.P[초록.id].connected === false);
  ok('재접속 유예가 설정됨', Host._graceUntil > Date.now());

  // 유예 중에는 자동 개표가 터지지 않아야 한다
  Host.startMeeting(newHostId, null);
  Host.M.phase = 'vote';
  Host.onVote(newHostId, 'skip');
  ok('유예 중 자동 개표 안 됨 (혼자 남았다고 개표하면 안 됨)', Host.M.tally === null);

  // 다른 사람들이 재접속하면 정상 복귀 (이름은 보내지 않는다 → 기존 이름 유지)
  Host._graceUntil = 0;
  Host.onMsg({ t:'hello', uid: snap.players.find(p => p.id === 초록.id).uid }, 'peerX');
  ok('재접속 시 같은 슬롯 복귀', Host.P[초록.id].connected === true && Host.P[초록.id].role === 'goose');
  ok('재접속해도 닉네임이 유지됨', Host.P[초록.id].name === '초록', Host.P[초록.id].name);

  // 게임이 끝난 뒤에는 마이그레이션 상태를 보내지 않는다
  sent.length = 0;
  G.phase = 'over';
  Host.pushMigration();
  ok('게임 종료 후에는 상태 전송 안 함', !sent.some(s => s.t === 'migstate'));
}

section('닉네임 위생 처리');
{
  reset(1);
  Host.onMsg({ t:'setName', name:'<img src=x onerror=alert(1)>' }, 'self');
  ok('닉네임에서 HTML 특수문자 제거', !/[<>&"'`]/.test(byName2('self') || Host.P[G.myId].name), Host.P[G.myId].name);
  function byName2() { return null; }
}

section('연습용 봇');
{
  reset(1);                                    // 사람 1명 (방장)
  Host.addBot(); Host.addBot(); Host.addBot();
  ok('봇 3명 추가 → 총 4명', G.order.length === 4);
  ok('봇은 connected 상태', G.order.every(id => Host.P[id].connected));
  ok('봇 표시 플래그', G.order.filter(id => Host.P[id].isBot).length === 3);
  ok('봇은 후계자가 될 수 없음', Host.successorId() === null);

  Host.startGame();
  ok('사람 1 + 봇 3으로 게임 시작 가능', G.phase === 'play');

  // 봇 배회 — 목표를 강제로 심어 결정론적으로 검증
  // (실전은 50ms 실시간 틱이지만 테스트는 즉시 60회 호출이라 idle 타이머가 풀리지 않음)
  const bot = G.order.map(id => Host.P[id]).find(p => p.isBot && p.alive);
  const x0 = bot.x, y0 = bot.y;
  bot._bot = { tx: x0 + 300, ty: y0, idleUntil: 0, deadline: 9e15, taskAt: 9e15, voteAt: 0 };
  for (let i = 0; i < 60; i++) Host.botTick();
  ok('봇이 스스로 움직임', Math.hypot(bot.x - x0, bot.y - y0) > 5,
     { moved: Math.round(Math.hypot(bot.x - x0, bot.y - y0)) });
  ok('봇 위치는 항상 통행 가능 지역', A.walkablePx(bot.x, bot.y));

  // 회의 → 봇 자동 투표 → 개표까지
  Host.startMeeting(G.order[0], null);
  Host.M.phase = 'vote';
  Host.onVote(G.order[0], 'skip');             // 사람 투표
  // 봇 투표 지연(8~18초)을 흉내: voteAt 을 과거로 당긴다
  for (const id of G.order) { const p = Host.P[id]; if (p._bot) p._bot.voteAt = 1; }
  for (let i = 0; i < 10 && !Host.M?.tally; i++) Host.botTick();
  ok('봇이 자동 투표 → 개표 완료', G.phase === 'eject' || Host.M?.tally != null || G.phase === 'over',
     { phase: G.phase });

  // 로비 복귀 후 봇 제거
  Host.toLobby();
  Host.removeBots();
  ok('봇 제거 후 사람만 남음', G.order.length === 1 && !Object.values(Host.P).some(p => p.isBot));
}

/* ---- 출력 -----------------------------------------------------------------*/
console.log(results.join('\n'));
console.log(`\n${'─'.repeat(52)}`);
console.log(`  통과 ${pass}  ·  실패 ${fail}`);
console.log(`${'─'.repeat(52)}\n`);
process.exit(fail ? 1 : 0);
