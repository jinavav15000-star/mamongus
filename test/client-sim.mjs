/* ============================================================================
 *  덕몽어스 · 클라이언트 로직 테스트 (브라우저 없이)
 *    node test/client-sim.mjs
 *  음성 없이 플레이하기 위한 핵심 기능 — 동선 자동기록 · 퀵챗 · 상호작용 판정
 * ==========================================================================*/
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILES = fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js')).sort();

/* ---- DOM 스텁 (로드 시점에 죽지 않을 만큼만) -------------------------------*/
const mem = {};
function stubEl() {
  const e = {
    style: {}, className: '', id: '', innerHTML: '', textContent: '', value: '',
    scrollTop: 0, scrollHeight: 0, clientHeight: 0, clientWidth: 100, offsetHeight: 10, offsetWidth: 10,
    children: [], dataset: {}, disabled: false,
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; },
    append(...c) { this.children.push(...c); },
    insertBefore(c) { this.children.unshift(c); return c; },
    removeChild(){}, remove(){}, addEventListener(){}, removeEventListener(){},
    setAttribute(k, v) { this[k] = v; }, getAttribute(){ return null; },
    querySelector: () => stubEl(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left:0, top:0, right:100, bottom:100, width:100, height:100 }),
    getContext: () => ctx2d(), focus(){}, setPointerCapture(){}, releasePointerCapture(){},
  };
  return e;
}
/** 캔버스 2D 컨텍스트 스텁 — 미니게임/렌더러가 실제로 그려도 죽지 않게 */
function ctx2d() {
  const noop = () => {};
  const c = {
    canvas: { width: 100, height: 100 },
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1,
    globalCompositeOperation: '', textAlign: '', textBaseline: '', lineCap: '',
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop, setTransform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, ellipse: noop,
    rect: noop, fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop,
    clearRect: noop, fillText: noop, strokeText: noop, drawImage: noop, setLineDash: noop,
    measureText: () => ({ width: 10 }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    getImageData: () => ({ data: [0, 0, 0, 0] }), putImageData: noop,
  };
  return c;
}
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, Set, Map, RegExp, Error, Promise,
  isNaN, parseInt, parseFloat, Uint8Array, Int8Array, Infinity, NaN, undefined,
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage:   { getItem: k => mem['l:' + k] ?? null, setItem: (k, v) => { mem['l:' + k] = String(v); } },
  sessionStorage: { getItem: k => mem['s:' + k] ?? null, setItem: (k, v) => { mem['s:' + k] = String(v); } },
  document: {
    createElement: stubEl, createElementNS: stubEl, createTextNode: t => ({ text: t }),
    addEventListener(){}, querySelector: () => stubEl(), querySelectorAll: () => [],
    getElementById: () => null, elementFromPoint: () => null, activeElement: null,
  },
  navigator: { mediaDevices: null, clipboard: null },
  Peer: function Peer() {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  devicePixelRatio: 1, performance: { now: () => Date.now() },
  location: { hash: '', origin: 'http://x', pathname: '/' },
  history: { replaceState(){} },
  addEventListener(){}, removeEventListener(){},
  AudioContext: function(){ return { state:'running', currentTime:0, destination:{},
    createGain:()=>({gain:{value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}),
    createOscillator:()=>({type:'',frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},start(){},stop(){}}),
    createBuffer:()=>({getChannelData:()=>new Float32Array(10)}),
    createBufferSource:()=>({buffer:null,connect(){},start(){}}),
    createBiquadFilter:()=>({type:'',frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}),
    sampleRate:44100, resume(){}, close(){} }; },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const src = FILES.map(f => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n');
vm.runInContext(src + `
;globalThis.__api = { G, Host, Net, Game, UI, Meeting, Trail, QUICK, ROLES, roleInfo,
  TASK_SPOTS, VENTS, ROOMS, EMERGENCY_BTN, ADMIN_TABLE, VITALS_PANEL, CAMERA_PANEL,
  SAB_SPOTS, spotById, roomNameAt, DEFAULT_SETTINGS, MiniGames, COLORS, Render, ABILITY_LABEL };
`, sandbox);

const A = sandbox.__api;
const { G, Game, Meeting, Trail, Net } = A;

let pass = 0, fail = 0; const out = [];
const ok = (n, c, e) => { if (c) { pass++; out.push(`  ✅ ${n}`); } else { fail++; out.push(`  ❌ ${n}${e !== undefined ? '  →  ' + JSON.stringify(e) : ''}`); } };
const section = t => out.push(`\n▸ ${t}`);

/* 네트워크 캡처 */
const sent = [];
Net.clockOffset = 0; Net.isHost = false;
Net.toHost = (t, d) => sent.push({ t, d });

/* 기본 상태 세팅 */
function setup() {
  sent.length = 0;
  G.settings = JSON.parse(JSON.stringify(A.DEFAULT_SETTINGS));
  G.myId = 'me'; G.ghost = false; G.sabotage = null; G.bodies = []; G.doors = {};
  G.myRole = 'goose'; G.myTasks = []; G.privateLog = []; G.abilityUses = 0;
  G.abilityCdEnd = 0; G.killCdEnd = 0; G.mySample = null; G.dragging = null;
  G.order = ['me', 'p2', 'p3'];
  G.players = {
    me: { id:'me', name:'나',   color:'red',   alive:true, x: A.EMERGENCY_BTN.wx, y: A.EMERGENCY_BTN.wy },
    p2: { id:'p2', name:'파랑', color:'blue',  alive:true, x: A.EMERGENCY_BTN.wx + 60, y: A.EMERGENCY_BTN.wy },
    p3: { id:'p3', name:'초록', color:'green', alive:true, x: 200, y: 200 },
  };
  G.me = G.players.me;
  return G.players;
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('로드 · 모듈 무결성');
{
  ok('모든 모듈이 오류 없이 로드됨', !!(G && Game && Meeting && Trail && A.UI && A.Render));
  const kinds = new Set(A.TASK_SPOTS.map(t => t.kind));
  const missing = [...kinds].filter(k => !A.MiniGames[k]);
  ok('모든 임무 종류에 미니게임이 구현됨', missing.length === 0, missing);
  ok('미니게임 18종', Object.keys(A.MiniGames).length === 18, Object.keys(A.MiniGames).length);
  const noBuild = Object.entries(A.MiniGames).filter(([, m]) => typeof m.build !== 'function').map(([k]) => k);
  ok('미니게임 전부 build 구현', noBuild.length === 0, noBuild);
  ok('색상 16개 · 중복 없음',
     A.COLORS.length === 16 && new Set(A.COLORS.map(c => c.id)).size === 16);
  ok('직업 22종 정의', Object.keys(A.ROLES).length === 22, Object.keys(A.ROLES).length);
  const abilities = [...new Set(Object.values(A.ROLES).map(r => r.ability).filter(Boolean))];
  const missingLabel = abilities.filter(a => !A.ABILITY_LABEL[a]);
  ok('모든 능력에 버튼 라벨 존재', missingLabel.length === 0, missingLabel);
  const noHandler = abilities.filter(a => {
    const st = (() => { try { return Game.abilityState({ alive:true, x:0, y:0 }, { ability:a }); } catch { return null; } })();
    return !st || st.label === '능력';          // default 분기로 떨어지면 미구현
  });
  ok('모든 능력에 활성조건 구현', noHandler.length === 0, noHandler);
  const noDesc = Object.entries(A.ROLES).filter(([, r]) => !r.desc || !r.name).map(([k]) => k);
  ok('모든 직업에 이름·설명 존재', noDesc.length === 0, noDesc);
}

section('동선 자동 기록 (음성 없이 알리바이)');
{
  setup();
  Trail.reset();
  const me = G.me;
  // 카페테리아 → 관리실 → 창고 순서로 이동한 것처럼
  const spots = [
    { name:'카페테리아', x: A.EMERGENCY_BTN.wx, y: A.EMERGENCY_BTN.wy },
    { name:'관리실',     x: A.ADMIN_TABLE.wx,   y: A.ADMIN_TABLE.wy },
    { name:'전기실',     x: A.VITALS_PANEL.wx,  y: A.VITALS_PANEL.wy },
  ];
  for (const s of spots) { me.x = s.x; me.y = s.y; Trail.track(me, []); }
  ok('방을 옮길 때마다 기록됨', Trail.log.length === 3, Trail.log);
  ok('기록된 방 이름이 정확', Trail.log.map(e => e.room).join(',') === '카페테리아,관리실,전기실', Trail.log.map(e => e.room));
  // 같은 방에 머무르면 중복 기록 안 함
  Trail.track(me, []); Trail.track(me, []);
  ok('같은 방 재기록 안 함', Trail.log.length === 3);
  const txt = Trail.myPath();
  ok('동선 문자열 생성', txt.includes('카페테리아') && txt.includes('전기실') && txt.startsWith('📍'), txt);
  ok('시각 형식 mm:ss', /\d\d:\d\d/.test(txt), txt);

  // 목격 기록
  Trail.seen = {};
  me.x = A.ADMIN_TABLE.wx; me.y = A.ADMIN_TABLE.wy;
  G.players.p2.x = A.ADMIN_TABLE.wx + 20; G.players.p2.y = A.ADMIN_TABLE.wy;
  Trail.track(me, [G.players.p2]);
  ok('목격한 사람이 기록됨', !!Trail.seen.p2);
  ok('목격 장소가 정확', Trail.seen.p2.room === '관리실', Trail.seen.p2);
  ok('목격 문자열 생성', Trail.seenText('p2').includes('관리실'), Trail.seenText('p2'));
  ok('못 본 사람은 "못 봄"', Trail.seenText('p3').includes('못 봄'), Trail.seenText('p3'));
  // 40개 초과 시 오래된 것 버림
  Trail.reset();
  for (let i = 0; i < 100; i++) {
    me.x = i % 2 ? A.ADMIN_TABLE.wx : A.EMERGENCY_BTN.wx;
    me.y = i % 2 ? A.ADMIN_TABLE.wy : A.EMERGENCY_BTN.wy;
    Trail.track(me, []);
  }
  ok('동선 기록 상한 유지', Trail.log.length <= 40, Trail.log.length);
}

section('퀵챗 (타이핑 없이 문장 완성)');
{
  setup();
  const cats = A.QUICK.map(q => q.cat);
  ok('퀵챗 카테고리 6개', A.QUICK.length === 6, cats);
  const total = A.QUICK.reduce((a, q) => a + q.items.length, 0);
  ok('퀵챗 문장 45개 이상', total >= 45, total);
  // 플레이스홀더 선언 검증
  const bad = [];
  A.QUICK.forEach(g => g.items.forEach(it => {
    const holders = [...(it.t.match(/\{(\w)\}/g) || [])].map(s => s[1]);
    const declared = it.n || [];
    if (holders.length !== declared.length || holders.some(hh => !declared.includes(hh))) bad.push(it.t);
  }));
  ok('플레이스홀더와 n 선언이 일치', bad.length === 0, bad);

  // 실제 채우기 흐름: "{p} {r}에서 봤어"
  const item = A.QUICK.flatMap(g => g.items).find(it => it.t === '{p} {r}에서 봤어');
  ok('색+방 2단계 문장 존재', !!item);
  Meeting.pending = { tpl: item.t, need: [...item.n], vals: {} };
  sent.length = 0;
  Meeting.fill('p', '파랑');
  ok('첫 칸 채운 뒤엔 아직 전송 안 함', sent.length === 0 && Meeting.pending !== null);
  Meeting.fill('r', '전기실');
  ok('두 칸 다 채우면 전송됨', sent.length === 1, sent);
  ok('완성된 문장이 정확', sent[0]?.d.text === '파랑 전기실에서 봤어', sent[0]?.d.text);
  ok('전송 후 pending 해제', Meeting.pending === null);

  // 플레이스홀더 없는 문장은 즉시 전송
  sent.length = 0;
  Meeting.send('스킵하자');
  ok('일반 문장 즉시 전송', sent.length === 1 && sent[0].d.text === '스킵하자');
  sent.length = 0;
  Meeting.send('   ');
  ok('빈 문자열은 전송 안 함', sent.length === 0);
}

section('시야 계산');
{
  setup();
  G.myRole = 'goose';
  ok('거위 기본 시야', Game.visionR() === G.settings.visionCrew);
  G.myRole = 'duck';
  ok('오리는 더 넓은 시야', Game.visionR() === G.settings.visionDuck);
  G.myRole = 'goose'; G.sabotage = { kind:'lights' };
  ok('정전 시 거위 시야 축소', Game.visionR() === G.settings.visionDark);
  G.myRole = 'duck';
  ok('정전이어도 오리 시야는 그대로', Game.visionR() === G.settings.visionDuck);
  G.sabotage = null;
  G.me.alive = false;
  ok('유령은 전체 시야', Game.visionR() === 900);
}

section('상호작용 대상 판정');
{
  const P = setup();
  // 긴급버튼 위
  P.me.x = A.EMERGENCY_BTN.wx; P.me.y = A.EMERGENCY_BTN.wy;
  ok('긴급버튼 근처 → 긴급회의', Game.findUseTarget(P.me)?.kind === 'emergency');
  // 죽으면 긴급회의 불가
  P.me.alive = false;
  ok('유령은 긴급회의 대상 아님', Game.findUseTarget(P.me)?.kind !== 'emergency');
  P.me.alive = true;

  // 임무가 있으면 임무 우선
  const spot = A.TASK_SPOTS.find(t => t.kind === 'wiring');
  G.myTasks = [{ tid:'t1', name:'배선 연결', spots:[spot.id], step:0 }];
  P.me.x = spot.wx; P.me.y = spot.wy;
  const tt = Game.findUseTarget(P.me);
  ok('임무 지점 근처 → 임무', tt?.kind === 'task' && tt.data.sp.id === spot.id, tt?.kind);
  // 완료한 임무는 대상 아님
  G.myTasks[0].step = 1;
  ok('완료한 임무는 무시', Game.findUseTarget(P.me)?.kind !== 'task');

  // 사보타주가 임무보다 우선
  G.myTasks[0].step = 0;
  const sab = A.SAB_SPOTS.lights[0];
  G.sabotage = { kind:'lights', endsAt:0, data:{ switches:[0,0,0,0,0] } };
  P.me.x = sab.wx; P.me.y = sab.wy;
  ok('사보타주 지점 → 수리', Game.findUseTarget(P.me)?.kind === 'repair');
  G.sabotage = null;

  // 패널
  P.me.x = A.ADMIN_TABLE.wx; P.me.y = A.ADMIN_TABLE.wy;
  ok('관리실 테이블 → 관리실', Game.findUseTarget(P.me)?.kind === 'admin');
  P.me.x = A.VITALS_PANEL.wx; P.me.y = A.VITALS_PANEL.wy;
  ok('생체신호 패널 인식', Game.findUseTarget(P.me)?.kind === 'vitals');
  P.me.x = A.CAMERA_PANEL.wx; P.me.y = A.CAMERA_PANEL.wy;
  ok('감시 카메라 패널 인식', Game.findUseTarget(P.me)?.kind === 'cams');

  // 아무것도 없는 곳
  P.me.x = A.EMERGENCY_BTN.wx + 600; P.me.y = A.EMERGENCY_BTN.wy;
  G.myTasks = [];
  ok('빈 공간에서는 대상 없음', Game.findUseTarget(P.me) === null);
}

section('가장 가까운 대상 탐색');
{
  const P = setup();
  P.me.x = 1000; P.me.y = 1000;
  P.p2.x = 1050; P.p2.y = 1000;      // 50
  P.p3.x = 1200; P.p3.y = 1000;      // 200
  ok('사거리 안에서 가장 가까운 사람', Game.nearestPlayer(P.me, 300)?.id === 'p2');
  ok('사거리 밖이면 null', Game.nearestPlayer(P.me, 30) === null);
  P.p2.alive = false;
  ok('죽은 사람은 대상 아님', Game.nearestPlayer(P.me, 300)?.id === 'p3');
  P.p2.alive = true; P.p2.ventId = 'v1';
  ok('벤트 안에 있는 사람은 대상 아님', Game.nearestPlayer(P.me, 300)?.id === 'p3');
}

section('능력 버튼 활성 조건');
{
  const P = setup();
  P.me.x = 1000; P.me.y = 1000; P.p2.x = 1060; P.p2.y = 1000; P.p3.x = 5000; P.p3.y = 5000;

  G.myRole = 'detective'; G.abilityCdEnd = 0;
  ok('탐정 — 근처에 사람 있으면 활성', Game.abilityState(P.me, A.roleInfo('detective')).ok === true);
  G.abilityCdEnd = Date.now() + 10000;
  ok('탐정 — 쿨다운 중이면 비활성', Game.abilityState(P.me, A.roleInfo('detective')).ok === false);

  G.myRole = 'mortician'; G.abilityCdEnd = 0;
  ok('장의사 — 시체 없으면 비활성', Game.abilityState(P.me, A.roleInfo('mortician')).ok === false);
  G.bodies = [{ id:'b1', x:1010, y:1000 }];
  ok('장의사 — 시체 옆이면 활성', Game.abilityState(P.me, A.roleInfo('mortician')).ok === true);

  G.myRole = 'vulture'; G.eaten = 1;
  const vs = Game.abilityState(P.me, A.roleInfo('vulture'));
  ok('독수리 — 진행 상황 표시', vs.ok === true && vs.label === '먹기 1/3', vs);

  G.myRole = 'doctor'; G.abilityUses = 1;
  ok('의사 — 사용 횟수 남으면 활성', Game.abilityState(P.me, A.roleInfo('doctor')).ok === true);
  G.abilityUses = 0;
  ok('의사 — 횟수 소진 시 비활성', Game.abilityState(P.me, A.roleInfo('doctor')).ok === false);

  G.myRole = 'morphling'; G.abilityCdEnd = 0; G.mySample = null;
  ok('변신술사 — 샘플 없으면 "샘플"', Game.abilityState(P.me, A.roleInfo('morphling')).label === '샘플');
  G.mySample = 'p2';
  ok('변신술사 — 샘플 있으면 "변신"', Game.abilityState(P.me, A.roleInfo('morphling')).label === '변신');

  G.myRole = 'engineer'; G.abilityUses = 1; G.sabotage = null;
  ok('기술자 — 사보타주 없으면 비활성', Game.abilityState(P.me, A.roleInfo('engineer')).ok === false);
  G.sabotage = { kind:'lights' };
  ok('기술자 — 사보타주 중이면 활성', Game.abilityState(P.me, A.roleInfo('engineer')).ok === true);
  G.sabotage = { kind:'doors' };
  ok('기술자 — 문 잠금은 원격수리 불가', Game.abilityState(P.me, A.roleInfo('engineer')).ok === false);

  P.me.alive = false;
  ok('유령은 모든 능력 비활성', Game.abilityState(P.me, A.roleInfo('detective')).ok === false);
}

section('내 임무 위치 표시');
{
  setup();
  const s1 = A.TASK_SPOTS.find(t => t.kind === 'card');
  const s2 = A.TASK_SPOTS.find(t => t.kind === 'align');
  G.myTasks = [
    { tid:'a', name:'A', spots:[s1.id, s2.id], step:0 },
    { tid:'b', name:'B', spots:[s2.id], step:1 },      // 완료
  ];
  const spots = Game.myTaskSpots();
  ok('미완료 임무의 현재 단계만 표시', spots.length === 1 && spots[0].id === s1.id, spots.map(s => s.id));
  G.myTasks[0].step = 1;
  ok('단계가 진행되면 다음 지점으로', Game.myTaskSpots()[0].id === s2.id);
}

section('미니게임 18종 실제 실행 (크래시 검사)');
{
  const UI = A.UI;
  for (const [kind, mg] of Object.entries(A.MiniGames)) {
    let err = null, completed = false;
    try {
      const rootEl = sandbox.document.createElement('div');
      mg.build(rootEl, { up: false, step: 0 }, () => { completed = true; });
      if (rootEl._cleanup) rootEl._cleanup();      // rAF/타이머 정리도 함께 검사
    } catch (e) { err = String(e); }
    ok(`${kind} — build 실행 가능`, err === null, err);
  }
}

section('화면 전환 · 회의 UI 코드 경로');
{
  const UI = A.UI, P = setup();
  UI.modalStack.length = 0;
  UI.screen = 'game';
  let err = null;

  // 역할 수신 → 버튼/칩/임무목록 생성
  try {
    Game.onPrivate({ role:'detective', tasks:[{ tid:'t', name:'배선 연결', spots:[A.TASK_SPOTS[0].id], step:0 }],
      killCdEnd:0, abilityCdEnd:0, abilityUses:0, emergencyLeft:1, shielded:false, infected:false,
      eaten:0, ducks:[], ghost:false, sample:null, dragging:null });
  } catch (e) { err = String(e); }
  ok('onPrivate → 행동버튼·역할칩·임무목록 생성', err === null, err);
  ok('직업이 반영됨', G.myRole === 'detective');

  // 오리 역할이면 사보타주/벤트/킬 버튼까지
  err = null;
  try {
    Game.onPrivate({ role:'morphling', tasks:[], killCdEnd:0, abilityCdEnd:0, abilityUses:0,
      emergencyLeft:1, shielded:false, infected:false, eaten:0, ducks:['me','p2'], ghost:false,
      sample:'p2', dragging:null });
  } catch (e) { err = String(e); }
  ok('오리 역할 버튼 구성 가능', err === null, err);
  ok('동료 오리 정보 수신', G.ducksKnown.length === 2);
  ok('샘플 상태가 호스트 값으로 설정', G.mySample === 'p2');

  // 회의 상태 수신 → 회의 화면 전환
  const meetingMsg = {
    t:'state', phase:'meeting', round:1, order:G.order, settings:G.settings, hostId:'me',
    taskBar:{done:0,total:10}, bodies:[], sabotage:null, doors:{}, result:null, sabCdEnd:0,
    players: Object.values(G.players).map(p => ({ id:p.id, name:p.name, color:p.color, alive:true, connected:true, x:p.x, y:p.y, dir:1, ventId:null })),
    meeting: { caller:'me', body:{ pid:'p2', room:'전기실', color:'blue' }, phase:'discuss',
               endsAt: Date.now() + 60000, votes:{}, tally:null, reported:[] },
  };
  err = null;
  try { Game.onState(meetingMsg); } catch (e) { err = String(e); }
  ok('회의 상태 수신 시 예외 없음', err === null, err);
  ok('회의 화면으로 전환됨 (호스트 포함)', UI.screen === 'meeting', UI.screen);

  // 이미 회의 중이면 open 대신 render
  err = null;
  try { Game.onState(meetingMsg); } catch (e) { err = String(e); }
  ok('회의 중 재수신 시 render 경로', err === null && UI.screen === 'meeting', err);

  // 투표 단계 + 마스킹된 투표
  err = null;
  try {
    Game.onState({ ...meetingMsg, meeting: { ...meetingMsg.meeting, phase:'vote',
      votes: { me:'__hidden__', p2:'__hidden__' } } });
  } catch (e) { err = String(e); }
  ok('마스킹된 투표 렌더 가능', err === null, err);

  // 개표 결과 공개
  err = null;
  try {
    Game.onState({ ...meetingMsg, meeting: { ...meetingMsg.meeting, phase:'vote',
      votes: { me:'p2', p2:'skip' }, tally:{ counts:{p2:1}, skip:1, ejectId:'p2' } } });
  } catch (e) { err = String(e); }
  ok('개표 결과 렌더 가능', err === null, err);

  // 추방 연출
  err = null;
  try { Game.onEvent({ type:'ejectresult', ejectId:'p2', role:'duck', confirm:true, remainDucks:0, tally:{ skip:0 } }); }
  catch (e) { err = String(e); }
  ok('추방 연출 실행 가능', err === null && UI.screen === 'eject', err || UI.screen);

  err = null;
  try { Game.onEvent({ type:'ejectresult', ejectId:null, role:null, confirm:false, remainDucks:null, tally:{ skip:2 } }); }
  catch (e) { err = String(e); }
  ok('추방 없음 연출 실행 가능', err === null, err);

  // 결과 화면
  err = null;
  try {
    Game.onEvent({ type:'over', result:{ faction:'goose', reason:'테스트', winners:['me'], duration:125,
      roster: Object.values(G.players).map(p => ({ id:p.id, name:p.name, color:p.color, role:'goose', alive:true })) } });
  } catch (e) { err = String(e); }
  ok('결과 화면 실행 가능', err === null && UI.screen === 'result', err || UI.screen);

  // 게임 화면 복귀
  err = null;
  try { Game.onEvent({ type:'resume' }); } catch (e) { err = String(e); }
  ok('라운드 재개 시 게임 화면 복귀', err === null && UI.screen === 'game', err || UI.screen);
}

section('사보타주 알림 · 이벤트 처리');
{
  const P = setup();
  const cases = [
    ['sabotage', { type:'sabotage', kind:'lights' }],
    ['sabotage', { type:'sabotage', kind:'reactor' }],
    ['sabfixed', { type:'sabfixed' }],
    ['doors',    { type:'doors', room:'cafe' }],
    ['kill',     { type:'kill', victim:'p2', at:{x:100,y:100} }],
    ['kill(나)', { type:'kill', victim:'me',  at:{x:100,y:100} }],
    ['vent',     { type:'vent', in:true, room:'전기실', at:{x:100,y:100} }],
    ['meeting',  { type:'meeting', caller:'me', body:null }],
    ['votestart',{ type:'votestart' }],
    ['shieldblock', { type:'shieldblock', at:{x:1,y:1} }],
    ['tolobby',  { type:'tolobby' }],
  ];
  for (const [name, ev] of cases) {
    let err = null;
    try { Game.onEvent(ev); } catch (e) { err = String(e); }
    ok(`${name} 이벤트 처리`, err === null, err);
  }
  // 개인 메시지
  for (const [name, msg] of [
    ['ventalert',  { t:'ventalert', room:'창고' }],
    ['visualtask', { t:'visualtask', pid:'p2', kind:'asteroid' }],
    ['toast',      { t:'toast', text:'테스트' }],
    ['privlog',    { t:'privlog', text:'🔎 결과' }],
    ['msg',        { t:'msg', from:'p2', name:'파랑', color:'blue', text:'안녕', channel:'all' }],
  ]) {
    let err = null;
    try { Game.onServer(msg); } catch (e) { err = String(e); }
    ok(`${name} 메시지 처리`, err === null, err);
  }
  ok('privlog 가 개인 기록에 쌓임', G.privateLog.length === 1, G.privateLog);
}

section('렌더러 실행');
{
  const P = setup();
  let err = null;
  try {
    A.Render.cv = sandbox.document.createElement('canvas');
    A.Render.g = ctx2d();
    A.Render.W = 800; A.Render.H = 600; A.Render.scale = 1;
    A.Render.mapCv = { width: 100, height: 100 };
    G.myRole = 'goose'; G.myTasks = [];
    Game.render(P.me);
  } catch (e) { err = String(e); }
  ok('게임 프레임 렌더 가능 (거위 시야)', err === null, err);

  err = null;
  try { G.ghost = true; Game.render(P.me); } catch (e) { err = String(e); }
  ok('유령 시야 렌더 가능', err === null, err);
  G.ghost = false;

  err = null;
  try {
    G.bodies = [{ id:'b', pid:'p2', color:'blue', x:P.me.x + 20, y:P.me.y, room:'카페테리아', t:Date.now() }];
    G.doors = { cafe: Date.now() + 5000 };
    G.sabotage = { kind:'reactor', endsAt: Date.now() + 10000, data:{ hold:{} } };
    Game.render(P.me);
  } catch (e) { err = String(e); }
  ok('시체·잠긴문·사보타주 포함 렌더 가능', err === null, err);

  err = null;
  try {
    const cv = sandbox.document.createElement('canvas');
    A.Render.drawMinimap(cv, { sabotage: G.sabotage }, {
      me: P.me, tasks: [], admin: true, adminPlayers: Object.values(G.players),
      camRooms: ['upeng'], showAll: Object.values(G.players),
    });
  } catch (e) { err = String(e); }
  ok('미니맵 렌더 가능 (관리실·카메라 모드)', err === null, err);
}

/* ---- 출력 -----------------------------------------------------------------*/
console.log(out.join('\n'));
console.log(`\n${'─'.repeat(52)}`);
console.log(`  통과 ${pass}  ·  실패 ${fail}`);
console.log(`${'─'.repeat(52)}\n`);
process.exit(fail ? 1 : 0);
