/* ============================================================================
 *  마몽어스 · 색상 & 직업(역할) 정의
 * ==========================================================================*/
const COLORS = [
  { id:'red',    name:'빨강',   hex:'#e64b4b', dark:'#a32b2b' },
  { id:'blue',   name:'파랑',   hex:'#3a6fe0', dark:'#22449a' },
  { id:'green',  name:'초록',   hex:'#2ea44f', dark:'#1a6b32' },
  { id:'pink',   name:'분홍',   hex:'#f06fbc', dark:'#b03d84' },
  { id:'orange', name:'주황',   hex:'#f28c28', dark:'#b35f10' },
  { id:'yellow', name:'노랑',   hex:'#f2d43d', dark:'#b39a12' },
  { id:'black',  name:'검정',   hex:'#4a4f5c', dark:'#25272e' },
  { id:'white',  name:'하양',   hex:'#e8ecf5', dark:'#a5abb8' },
  { id:'purple', name:'보라',   hex:'#8a4fd6', dark:'#5b2f94' },
  { id:'brown',  name:'갈색',   hex:'#8a5a34', dark:'#5c3a1f' },
  { id:'cyan',   name:'하늘',   hex:'#43d8e8', dark:'#1d95a3' },
  { id:'lime',   name:'연두',   hex:'#8ee640', dark:'#5ba31f' },
  { id:'maroon', name:'자주',   hex:'#8e2f4a', dark:'#5e1a2d' },
  { id:'rose',   name:'로즈',   hex:'#f7b2c4', dark:'#c07e90' },
  { id:'tan',    name:'베이지', hex:'#d8c49a', dark:'#a08d68' },
  { id:'coral',  name:'코랄',   hex:'#ff7f6e', dark:'#c04f40' },
];
const colorOf = id => COLORS.find(c => c.id === id) || COLORS[0];

/** 한글 마지막 글자에 받침이 있는지 — 조사(이었/였, 을/를 …) 선택용 */
const hasJong = s => {
  if (!s) return false;
  const c = s.charCodeAt(s.length - 1);
  return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0;
};

const F = { GOOSE:'goose', DUCK:'duck', NEUT:'neutral' };
const FACTION_LABEL = { goose:'양', duck:'늑대', neutral:'중립' };
const FACTION_COLOR = { goose:'#5fd0ff', duck:'#ff5f6d', neutral:'#c99bff' };

/* ---------------------------------------------------------------------------
 *  직업 정의
 *   canKill    : 킬 버튼 사용
 *   canVent    : 벤트 사용
 *   fakeTasks  : 임무가 진행바에 반영되지 않음
 *   counts     : 임무가 진행바에 반영됨 (양 기본 true)
 *   ability    : 특수 능력 키 (UI 버튼 생성)
 * -------------------------------------------------------------------------*/
const ROLES = {
  /* ── 양 진영 ───────────────────────────────────────────────── */
  goose: {
    name:'양', faction:F.GOOSE, icon:'🐑', tier:0,
    desc:'임무를 완수하고 양 무리에 숨어든 늑대를 색출하세요.',
    tip:'죽으면 유령이 되어도 임무는 계속할 수 있어요.',
  },
  detective: {
    name:'탐정', faction:F.GOOSE, icon:'🔎', tier:1, ability:'investigate', cd:45,
    desc:'살아있는 플레이어를 조사해 이번 라운드에 살인을 했는지 알아냅니다.',
    tip:'조사 결과는 회의에서 증거가 됩니다. 다만 조사하는 모습을 들키면 표적이 돼요.',
  },
  mortician: {
    name:'장의사', faction:F.GOOSE, icon:'⚰️', tier:1, ability:'autopsy', cd:0,
    desc:'시체를 부검해 사망자의 직업과 사망 경과 시간을 알아냅니다.',
    tip:'"몇 초 전에 죽었다"는 정보는 알리바이를 무너뜨리는 결정타예요.',
  },
  engineer: {
    name:'기술자', faction:F.GOOSE, icon:'🔧', tier:1, canVent:true, ability:'remotefix', uses:1,
    desc:'벤트를 사용할 수 있고, 사보타주를 라운드당 1회 원격 수리합니다.',
    tip:'벤트를 타다 들키면 늑대로 몰립니다. 미리 커밍아웃해 두세요.',
  },
  medium: {
    name:'영매', faction:F.GOOSE, icon:'🔮', tier:1,
    desc:'유령들의 대화를 들을 수 있습니다.',
    tip:'죽은 사람이 본 것을 대신 전할 수 있지만, 늑대가 노리는 1순위입니다.',
  },
  sheriff: {
    name:'보안관', faction:F.GOOSE, icon:'⭐', tier:2, ability:'shoot', uses:1, cd:25,
    desc:'플레이어 1명을 사살합니다. 늑대/중립킬러면 처치, 양이면 자신이 죽습니다.',
    tip:'확신 없이 쏘면 양 2명이 사라집니다. 신중하게.',
  },
  birdwatcher: {
    name:'감시견', faction:F.GOOSE, icon:'🐕', tier:1,
    desc:'맵 어디서든 벤트가 사용되면 그 위치를 알림으로 받습니다.',
    tip:'알림이 뜬 방을 즉시 채팅에 남겨두면 나중에 강력한 증거가 됩니다.',
  },
  politician: {
    name:'정치인', faction:F.GOOSE, icon:'🗳️', tier:1, votes:2,
    desc:'투표권이 2표입니다.',
    tip:'커밍아웃하면 표를 몰아줄 수 있지만 바로 암살당할 수 있어요.',
  },
  doctor: {
    name:'수의사', faction:F.GOOSE, icon:'🩺', tier:2, ability:'shield', uses:1,
    desc:'플레이어 1명에게 방패를 부여합니다. 살해 시도 1회를 막습니다.',
    tip:'방패가 발동하면 공격자의 킬 쿨다운만 돌아갑니다. 누가 노렸는지 추리하세요.',
  },
  tracker: {
    name:'추적자', faction:F.GOOSE, icon:'📡', tier:2, ability:'track', cd:40,
    desc:'플레이어 1명을 지목하면 15초간 그 사람의 방향이 화살표로 표시됩니다.',
    tip:'"지금 빨강 발전기실에 있어" 같은 확인 가능한 정보는 회의에서 가장 강력합니다.',
  },
  bodyguard: {
    name:'경호원', faction:F.GOOSE, icon:'🛡️', tier:2, ability:'guard', uses:1,
    desc:'플레이어 1명을 경호합니다. 그 사람이 살해당할 때 대신 죽고 살려냅니다.',
    tip:'경호가 발동하면 전원에게 알려집니다. 누구를 노렸는지가 그대로 드러나요.',
  },
  canadian: {
    name:'숫양', faction:F.GOOSE, icon:'🐏', tier:2, canKill:true, cdMul:1.4,
    desc:'박치기로 살해할 수 있습니다. 하지만 양을 죽이면 자신도 함께 죽습니다.',
    tip:'양 진영이지만 시체를 만들 수 있어 오해받기 쉽습니다.',
  },

  /* ── 늑대 진영 ───────────────────────────────────────────────── */
  duck: {
    name:'늑대', faction:F.DUCK, icon:'🐺', tier:0, canKill:true, canVent:true, fakeTasks:true,
    desc:'양의 탈을 쓰고 숨어드세요. 벤트와 사보타주로 양을 사냥합니다.',
    tip:'임무하는 척 서 있는 시간도 알리바이가 됩니다.',
  },
  assassin: {
    name:'암살자', faction:F.DUCK, icon:'🗡️', tier:2, canKill:true, canVent:true, fakeTasks:true,
    ability:'guess', uses:2,
    desc:'회의 중 상대의 직업을 맞히면 즉사시킵니다. 틀리면 자신이 죽습니다.',
    tip:'커밍아웃한 특수 직업이 1순위 먹잇감입니다.',
  },
  professional: {
    name:'저격수', faction:F.DUCK, icon:'🎯', tier:2, canKill:true, canVent:true, fakeTasks:true,
    killRangeMul:3.2, cdMul:1.5,
    desc:'멀리서 살해할 수 있습니다. 대신 킬 쿨다운이 깁니다.',
    tip:'오솔길 끝에서 노리면 목격당할 확률이 크게 줄어듭니다.',
  },
  morphling: {
    name:'변신술사', faction:F.DUCK, icon:'🎭', tier:2, canKill:true, canVent:true, fakeTasks:true,
    ability:'morph', cd:25,
    desc:'다른 양의 털을 얻어 15초간 그 사람의 모습으로 변신합니다.',
    tip:'변신한 채로 목격당하면 무고한 양이 처형됩니다.',
  },
  undertaker: {
    name:'매장인', faction:F.DUCK, icon:'🪦', tier:2, canKill:true, canVent:true, fakeTasks:true,
    ability:'drag',
    desc:'시체를 끌고 이동해 다른 곳에 버릴 수 있습니다.',
    tip:'시체를 벤트 근처나 사각지대로 옮기면 발각이 크게 늦어집니다.',
  },
  pelican: {
    name:'구렁이', faction:F.DUCK, icon:'🐍', tier:3, canKill:true, canVent:true, fakeTasks:true,
    cdMul:1.25, noBody:true,
    desc:'통째로 삼켜버립니다. 시체가 전혀 남지 않아 아무도 신고할 수 없습니다.',
    tip:'사람이 조용히 사라지므로 발각이 늦습니다. 대신 생체신호로 사망은 드러납니다.',
  },
  spy: {
    name:'첩자', faction:F.DUCK, icon:'🕵️', tier:1, canKill:true, canVent:true,
    desc:'가짜 임무가 실제 임무 진행바를 채웁니다. 양들을 착각하게 만드세요.',
    tip:'진행바를 일부러 올려 "임무 다 끝났다"고 방심시키세요.',
  },

  /* ── 중립 ────────────────────────────────────────────────────── */
  vulture: {
    name:'독수리', faction:F.NEUT, icon:'🦅', tier:2, canVent:true, fakeTasks:true,
    ability:'eat', winNeed:3,
    desc:'시체 3구를 먹으면 즉시 단독 승리합니다.',
    tip:'시체가 나오길 기다리세요. 아무도 당신을 막을 이유가 없습니다.',
  },
  pigeon: {
    name:'모기', faction:F.NEUT, icon:'🦟', tier:2, fakeTasks:true, ability:'infect', cd:20,
    desc:'플레이어를 물어 감염시킵니다. 살아있는 전원을 감염시키면 단독 승리합니다.',
    tip:'감염 사실은 본인만 압니다. 조용히 모두에게 다가가세요.',
  },
  falcon: {
    name:'곰', faction:F.NEUT, icon:'🐻', tier:3, canKill:true, canVent:true, fakeTasks:true, cdMul:1.15,
    desc:'중립 킬러. 마지막까지 홀로 살아남으면 단독 승리합니다.',
    tip:'양과 늑대를 서로 싸우게 만드는 것이 최선의 전략입니다.',
  },
};

const roleInfo = id => ROLES[id] || ROLES.goose;
const isKiller = id => !!roleInfo(id).canKill;
const isDuck   = id => roleInfo(id).faction === F.DUCK;
const isGoose  = id => roleInfo(id).faction === F.GOOSE;
const isNeut   = id => roleInfo(id).faction === F.NEUT;
/** 보안관 사격 시 "적법한 표적"인가 */
const isSheriffTarget = id => isDuck(id) || (isNeut(id) && isKiller(id));

const GOOSE_ROLES = Object.keys(ROLES).filter(k => ROLES[k].faction === F.GOOSE && k !== 'goose');
/* 인원이 적으면 성립하지 않는 직업들.
 * 독수리: 시체 3구를 먹어야 승리 — 6인 이하에선 수학적으로 거의 불가능.
 * 암살자: 회의 즉사 한 방 — 소인원에선 한 명 실수로 판이 끝난다.
 * 숫양: 자폭 맞교환 — 소인원에선 스노볼이 너무 크다. */
const ROLE_MIN_P = { vulture: 7, assassin: 7, canadian: 6, pelican: 7 };

/* 인원수 → 권장·상한 구성.
 * 늑대 상한 floor((n-1)/3): 4~6명 1, 7~9명 2, 10~12명 3, 13명+ 4.
 * (이전의 floor((n-1)/2) 는 5명에 늑대 2를 허용 — 한 명만 죽어도 2:2 즉시 패배였다) */
function recommendComp(n) {
  const duck = n <= 6 ? 1 : n <= 9 ? 2 : n <= 12 ? 3 : 4;
  const neut = n <= 5 ? 0 : n <= 8 ? 1 : n <= 11 ? 2 : 3;
  return { duck, neut };
}
function maxDuck(n) { return Math.max(1, Math.floor((n - 1) / 3)); }
function maxNeut(n, duck) { return Math.max(0, Math.min(3, n - duck * 2 - 1)); }

const DUCK_ROLES  = Object.keys(ROLES).filter(k => ROLES[k].faction === F.DUCK  && k !== 'duck');
const NEUT_ROLES  = Object.keys(ROLES).filter(k => ROLES[k].faction === F.NEUT);

/* ---------------------------------------------------------------------------
 *  역할 배정
 *  settings.roleWeights: {roleId: 0|1|2}  0=끔, 1=가끔, 2=자주
 *  settings.duckCount, settings.neutralCount
 * -------------------------------------------------------------------------*/
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

function assignRoles(playerIds, S) {
  const n = playerIds.length;
  const ids = shuffle([...playerIds]);
  const out = {};

  const nDuck = Math.max(1, Math.min(S.duckCount, maxDuck(n)));
  const nNeut = Math.max(0, Math.min(S.neutralCount, maxNeut(n, nDuck)));

  const pick = (pool, count) => {
    // 가중치 기반 추첨 (중복 없음) · 인원 미달 직업은 제외
    const bag = [];
    for (const r of pool) {
      if (ROLE_MIN_P[r] && n < ROLE_MIN_P[r]) continue;
      const w = S.roleWeights[r] || 0; for (let i = 0; i < w; i++) bag.push(r);
    }
    const chosen = [];
    while (chosen.length < count && bag.length) {
      const i = (Math.random() * bag.length) | 0;
      const r = bag[i];
      chosen.push(r);
      for (let k = bag.length - 1; k >= 0; k--) if (bag[k] === r) bag.splice(k, 1);
    }
    return chosen;
  };

  let idx = 0;
  // 늑대
  const duckSpecial = pick(DUCK_ROLES, nDuck);
  for (let i = 0; i < nDuck; i++) out[ids[idx++]] = duckSpecial[i] || 'duck';
  // 중립
  const neutSpecial = pick(NEUT_ROLES, nNeut);
  for (let i = 0; i < nNeut && neutSpecial[i]; i++) out[ids[idx++]] = neutSpecial[i];
  // 양
  const remain = ids.slice(idx);
  const gooseSpecial = pick(GOOSE_ROLES, remain.length);
  remain.forEach((pid, i) => { out[pid] = gooseSpecial[i] || 'goose'; });

  return out;
}

/* 기본 역할 가중치 (0=끔 1=가끔 2=자주) */
const DEFAULT_WEIGHTS = {
  detective:2, mortician:2, engineer:2, medium:2, sheriff:1, birdwatcher:2,
  politician:1, doctor:1, canadian:1, tracker:2, bodyguard:1,
  assassin:1, professional:1, morphling:1, undertaker:1, spy:1, pelican:1,
  vulture:1, pigeon:1, falcon:0,
};
