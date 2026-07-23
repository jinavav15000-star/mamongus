/* ============================================================================
 *  마몽어스 · 게임 로직 (호스트 권한)
 * ==========================================================================*/
const DEFAULT_SETTINGS = {
  duckCount: 2, neutralCount: 1,
  killCd: 30, killRange: 92, playerSpeed: 3.35,
  visionCrew: 330, visionDuck: 470, visionDark: 145,
  emergencies: 1, emergencyCd: 20,
  discussSec: 60, voteSec: 75,          // 음성 없이 타이핑하는 환경 → 넉넉하게
  confirmEject: true, anonVotes: false, showKiller: true,
  taskCommon: 1, taskShort: 4, taskLong: 2,
  visualTasks: true, ghostTasks: true,
  sabotageCd: 25, reactorSec: 40, oxygenSec: 40, doorSec: 10,
  roleWeights: { ...DEFAULT_WEIGHTS },
};

const G = {
  phase: 'lobby',            // lobby | play | meeting | eject | over
  players: {},               // id -> record (공개 정보)
  order: [],                 // 입장 순서
  bodies: [],
  settings: { ...DEFAULT_SETTINGS },
  meeting: null,
  sabotage: null,            // {kind, endsAt, data}
  doors: {},                 // roomId -> unlockAt(ms)
  taskBar: { done: 0, total: 0 },
  myId: null, myRole: null, myTasks: [], myVentId: null,
  ducksKnown: [], loversKnown: [],
  hostId: null,
  successor: null,           // 방장이 사라지면 이 사람이 이어받는다
  gen: 0,
  result: null,
  round: 1,
  killCdEnd: 0, abilityCdEnd: 0, abilityUses: 0, emergencyLeft: 0, sabCdEnd: 0,
  shielded: false, infected: false, eaten: 0,
  privateLog: [],            // 나만 보는 능력 결과
  startedAt: 0,
};

/** 호스트 시계 기준 현재 시각. 모든 타이머·쿨다운의 단일 기준점.
 *  (기기마다 시계가 몇 초씩 다르므로 절대 Date.now() 를 직접 쓰지 않는다) */
const now = () => Date.now() + Net.clockOffset;
const genId = () => Math.random().toString(36).slice(2, 8);
/** 닉네임은 토스트·추방 연출에서 innerHTML 로도 쓰이므로 호스트에서 한 번 걸러낸다 */
const cleanName = n => String(n || '양').replace(/[<>&"'`\\]/g, '').trim().slice(0, 10) || '양';

/* ---------------------------------------------------------------------------
 *  임무 목록 생성
 * -------------------------------------------------------------------------*/
const COMMON_POOL = [['t_card'], ['t_swipe2']];
const LONG_POOL   = [['t_fuel1','t_fuel2','t_fuel3'], ['t_gar_c','t_gar_s'], ['t_dl','t_up']];
const WIRE_SPOTS  = ['t_wire_e','t_wire_c','t_wire_n','t_wire_s','t_wire_a'];
const SHORT_POOL  = ['t_align1','t_align2','t_ast','t_shield','t_scan','t_sample','t_leaf',
                     't_div1','t_div2','t_chart','t_cal','t_temp1','t_temp2','t_secur','t_shoot','t_store']
                     .map(s => [s]);

const spotById = id => TASK_SPOTS.find(t => t.id === id);

function makeTaskList(S, commonChosen) {
  const list = [];
  const mk = spots => {
    const first = spotById(spots[0]);
    return { tid: genId(), name: first.name, spots, step: 0, vis: !!first.vis };
  };
  commonChosen.forEach(c => list.push(mk(c)));
  pickN(LONG_POOL, Math.min(S.taskLong, LONG_POOL.length)).forEach(c => list.push(mk(c)));

  let shortNeed = S.taskShort;
  if (shortNeed > 0) {                       // 배선은 항상 1개 (3부위)
    list.push({ ...mk(pickN(WIRE_SPOTS, 3)), name: '전선 잇기' });
    shortNeed--;
  }
  pickN(SHORT_POOL, Math.min(shortNeed, SHORT_POOL.length)).forEach(c => list.push(mk(c)));
  return list;
}
const taskTotalSteps = list => list.reduce((a, t) => a + t.spots.length, 0);

/* ============================================================================
 *  HOST — 권한 로직
 * ==========================================================================*/
const Host = {
  P: {},                 // id -> 전체 기록(비공개 포함)
  /** 회의의 '권한' 상태. G.meeting 은 클라이언트 뷰(투표 대상이 가려진 사본)이므로
   *  호스트 로직이 G.meeting 을 읽으면 자기 브로드캐스트에 덮여 개표가 깨진다. */
  M: null,
  peerToId: {},
  tickTimer: null, snapTimer: null,
  commonTasks: [],

  init() {
    G.hostId = G.myId;
    Net.on('data', (m, from) => this.onMsg(m, from));
    Net.on('peerleave', peerId => {
      const id = this.peerToId[peerId];
      if (!id) return;
      const p = this.P[id];
      if (!p) return;
      p.connected = false;
      if (G.phase === 'lobby') { delete this.P[id]; G.order = G.order.filter(x => x !== id); }
      else this.sys(`${p.name} 님의 연결이 끊겼습니다.`);
      delete this.peerToId[peerId];
      this.pushState(); this.checkWin();
    });
    this.tickTimer = setInterval(() => this.tick(), 50);
    this.snapTimer = setInterval(() => this.sendSnap(), 80);
    this.migTimer  = setInterval(() => this.pushMigration(), 2500);
  },
  stopTimers() { clearInterval(this.tickTimer); clearInterval(this.snapTimer); clearInterval(this.migTimer); },

  addPlayer(peerId, uid, name, color) {
    // 재접속 복구
    const existing = Object.values(this.P).find(p => p.uid === uid);
    if (existing) {
      delete this.peerToId[existing.peerId];
      existing.peerId = peerId; existing.connected = true;
      if (name) existing.name = cleanName(name);
      this.peerToId[peerId] = existing.id;
      return existing;
    }
    if (G.phase !== 'lobby') return null;
    if (G.order.length >= 16) return null;
    const used = new Set(Object.values(this.P).map(p => p.color));
    const free = COLORS.find(c => !used.has(c.id)) || COLORS[0];
    const p = {
      id: genId(), uid, peerId, name: cleanName(name),
      color: used.has(color) || !color ? free.id : color,
      role: 'goose', alive: true, connected: true,
      x: EMERGENCY_BTN.wx, y: EMERGENCY_BTN.wy + 90, dir: 1, moving: false,
      ventId: null, tasks: [], killCdEnd: 0, abilityCdEnd: 0, abilityUses: 0,
      emergencyLeft: 0, shielded: false, infected: false, eaten: 0,
      killedThisRound: false, votes: null, ready: false, morphTo: null, morphEnd: 0,
      dragging: null, lastActive: now(), afk: false,
    };
    this.P[p.id] = p; G.order.push(p.id); this.peerToId[peerId] = p.id;
    return p;
  },

  /* ---------------- 메시지 라우팅 ---------------- */
  onMsg(m, fromPeer) {
    if (m._s) return;                  // 서버발(내 브로드캐스트) — 클라이언트 요청이 아니다
    const id = fromPeer === 'self' ? G.myId : this.peerToId[fromPeer];
    // 움직임 외의 모든 조작도 '활동'으로 친다 (임무·채팅·투표 중이면 AFK 아님)
    if (id && this.P[id] && m.t !== 'pos') this.markActive(this.P[id]);
    switch (m.t) {
      case 'hello': {
        const p = this.addPlayer(fromPeer, m.uid, m.name, m.color);
        if (!p) { Net.toPeer(fromPeer, 'denied', { reason: G.phase !== 'lobby' ? '이미 게임이 진행 중입니다.' : '방이 가득 찼습니다 (최대 16명).' }); return; }
        p.peerId = fromPeer;
        Net.toPeer(fromPeer, 'welcome', { yourId: p.id, hostId: G.hostId, code: Net.code });
        this.pushState();
        if (G.phase !== 'lobby') { this.sendPrivate(p.id); this.sys(`${p.name} 님이 다시 접속했습니다.`); }
        else this.sys(`${p.name} 님이 입장했습니다.`);
        break;
      }
      case 'setName': { const p = this.P[id]; if (p && G.phase === 'lobby') { p.name = cleanName(m.name); this.pushState(); } break; }
      case 'setColor': {
        const p = this.P[id]; if (!p || G.phase !== 'lobby') break;
        if (Object.values(this.P).some(q => q.id !== id && q.color === m.color)) break;
        p.color = m.color; this.pushState(); break;
      }
      case 'settings': if (id === G.hostId) { Object.assign(G.settings, m.s); this.pushState(); } break;
      case 'start':    if (id === G.hostId) this.startGame(); break;
      case 'addbot':   if (id === G.hostId) this.addBot(); break;
      case 'rmbots':   if (id === G.hostId) this.removeBots(); break;
      case 'restart':  if (id === G.hostId) this.toLobby(); break;
      case 'pos':      this.onPos(id, m); break;
      case 'kill':     this.onKill(id, m.target); break;
      case 'report':   this.onReport(id, m.body); break;
      case 'emergency':this.onEmergency(id); break;
      case 'vent':     this.onVent(id, m.vent); break;
      case 'sabotage': this.onSabotage(id, m.kind, m.room); break;
      case 'sabfix':   this.onSabFix(id, m); break;
      case 'taskstep': this.onTaskStep(id, m.tid); break;
      case 'vote':     this.onVote(id, m.target); break;
      case 'reqinfo':  this.onReqInfo(id, m.kind); break;
      case 'ability':  this.onAbility(id, m); break;
      case 'chat':     this.onChat(id, m.text, m.channel); break;
      case 'voiceon': {
        const p = this.P[id]; if (!p) break;
        p.voicePeer = m.peerId || (fromPeer === 'self' ? Net.peer?.id : fromPeer);
        const map = {};
        for (const oid of G.order) if (this.P[oid]?.voicePeer) map[oid] = this.P[oid].voicePeer;
        Net.broadcast('voicepeers', { map });
        break;
      }
    }
  },

  /* ---------------- 상태 배포 ---------------- */
  /** ⚠️ 좌표는 여기 넣지 않는다.
   *  state 는 전원 브로드캐스트라, 좌표를 담으면 콘솔로 전원 위치가 노출된다.
   *  위치는 sendSnap 에서 수신자별 시야 컬링을 거쳐 나간다. */
  pubPlayer(p) {
    return { id: p.id, name: p.name, color: p.color, alive: p.alive,
             connected: p.connected, afk: !!p.afk, isBot: !!p.isBot };
  },
  /** 투표 중에는 "누가 투표했는지"만 공개하고 "누구에게"는 감춘다 (밴드왜건 방지) */
  pubMeeting() {
    const m = this.M; if (!m) return null;
    if (m.phase === 'vote' && !m.tally) {
      const masked = {};
      for (const voter in m.votes) masked[voter] = '__hidden__';
      return { ...m, votes: masked };
    }
    return m;
  },
  pushState() {
    Net.broadcast('state', {
      phase: G.phase, round: G.round,
      players: G.order.map(i => this.P[i]).filter(Boolean).map(p => this.pubPlayer(p)),
      order: G.order, settings: G.settings, hostId: G.hostId,
      taskBar: G.taskBar, bodies: G.bodies, sabotage: G.sabotage,
      doors: G.doors, meeting: this.pubMeeting(), result: G.result,
      sabCdEnd: G.sabCdEnd, gen: Net.gen,
    });
  },
  /** 수신자가 실제로 볼 수 있는 사람만 담은 스냅샷.
   *  전원 좌표를 브로드캐스트하면 개발자도구만 열어도 전원 위치가 보인다. */
  visibleTo(viewer) {
    const out = [];
    const ghost = !viewer.alive;
    const R = roleInfo(viewer.role).faction === F.DUCK ? G.settings.visionDuck
            : (G.sabotage?.kind === 'lights' ? G.settings.visionDark : G.settings.visionCrew);
    for (const id of G.order) {
      const p = this.P[id]; if (!p) continue;
      if (p.id === viewer.id || ghost) { out.push(p); continue; }
      if (!p.alive || p.ventId) continue;                 // 유령·벤트 안은 산 사람에게 안 보임
      const d = Math.hypot(p.x - viewer.x, p.y - viewer.y);
      if (d > R + 60) continue;                           // 여유 60px (보간 튐 방지)
      if (d > 40 && lineBlocked(viewer.x, viewer.y, p.x, p.y)) continue;
      out.push(p);
    }
    return out;
  },
  packPlayer(p) {
    return [p.id, Math.round(p.x), Math.round(p.y), p.dir,
            (p.moving ? 1 : 0) | (p.alive ? 2 : 0), p.ventId || 0,
            (p.morphEnd > now() ? p.morphTo : 0) || 0];
  },
  sendSnap() {
    if (G.phase !== 'play') return;
    for (const id of G.order) {
      const viewer = this.P[id];
      if (!viewer || !viewer.connected) continue;
      const arr = this.visibleTo(viewer).map(p => this.packPlayer(p));
      // 추적자에게만 대상의 좌표를 따로 실어 보낸다 (모습은 안 보이고 방향만 표시)
      let trk = null;
      if (viewer.role === 'tracker' && viewer.trackTarget && now() < (viewer.trackEnd || 0)) {
        const t = this.P[viewer.trackTarget];
        if (t && t.alive) trk = [Math.round(t.x), Math.round(t.y), t.color];
      }
      Net.toPeer(viewer.peerId, 'snap', trk ? { p: arr, trk } : { p: arr });
    }
  },

  /** 사무실·감시초소는 시야 밖 정보라 서버가 계산해 준다 (클라에 원본을 주지 않기 위함) */
  onReqInfo(id, kind) {
    const p = this.P[id]; if (!p) return;
    if (G.sabotage?.kind === 'comms') { Net.toPeer(p.peerId, 'info', { kind, blocked: true }); return; }
    if (kind === 'admin') {
      const counts = {};
      for (const oid of G.order) {
        const q = this.P[oid];
        if (!q || !q.alive || q.ventId) continue;
        const rid = roomIdAt(q.x, q.y);
        if (rid) counts[rid] = (counts[rid] || 0) + 1;
      }
      Net.toPeer(p.peerId, 'info', { kind, counts });
    } else if (kind === 'cams') {
      const list = [];
      for (const oid of G.order) {
        const q = this.P[oid];
        if (!q || !q.alive || q.ventId) continue;
        if (!CAM_ROOMS.includes(roomIdAt(q.x, q.y))) continue;
        list.push({ color: q.color, x: Math.round(q.x), y: Math.round(q.y) });
      }
      Net.toPeer(p.peerId, 'info', { kind, list });
    }
  },
  /** 개인 정보(역할/임무/능력) 전송 */
  sendPrivate(id) {
    const p = this.P[id]; if (!p) return;
    const r = roleInfo(p.role);
    const payload = {
      role: p.role, tasks: p.tasks,
      killCdEnd: p.killCdEnd, abilityCdEnd: p.abilityCdEnd, abilityUses: p.abilityUses,
      emergencyLeft: p.emergencyLeft, shielded: p.shielded, infected: p.infected, eaten: p.eaten,
      sample: p.sample || null, dragging: p.dragging || null,
      guarding: p.guarding || null, trackEnd: p.trackEnd || 0,
      trackName: p.trackTarget ? this.P[p.trackTarget]?.name : null,
      ducks: r.faction === F.DUCK ? Object.values(this.P).filter(q => isDuck(q.role)).map(q => q.id) : [],
      ghost: !p.alive,
      allRoles: !p.alive ? Object.fromEntries(Object.values(this.P).map(q => [q.id, q.role])) : null,
    };
    Net.toPeer(p.peerId, 'private', payload);
  },
  sendPrivateAll() { for (const id of G.order) this.sendPrivate(id); },

  /* ⚠️ 클라→호스트 타입명과 호스트→클라 타입명은 절대 겹치면 안 된다.
   *    broadcast 는 호스트 자신에게도 emit 되므로 이름이 겹치면 무한 재귀가 된다.
   *    (클라→호스트: chat / 호스트→클라: msg) */
  /* ---------------- 방장 마이그레이션 ----------------
   * 방장이 사라져도 게임이 계속되도록, 권한 상태 전부를 '후계자' 1명에게만
   * 주기적으로 넘겨둔다. 전원에게 뿌리면 모든 역할이 노출되므로 후계자 1명뿐.
   * (원래 방장도 모든 역할을 알고 있으므로 신뢰 범위가 1명 늘어나는 정도) */
  successorId() {
    // 봇은 방장 브라우저 안에서만 살기 때문에 후계자가 될 수 없다
    return G.order.find(id => id !== G.hostId && this.P[id]?.connected && !this.P[id]?.isBot) || null;
  },
  exportState() {
    return {
      players: G.order.map(id => ({ ...this.P[id], voicePeer: undefined })),
      order: [...G.order], phase: G.phase, round: G.round,
      settings: G.settings, bodies: G.bodies, sabotage: G.sabotage,
      doors: G.doors, taskBar: G.taskBar, meeting: this.M, result: G.result,
      sabCdEnd: G.sabCdEnd, startedAt: G.startedAt, commonTasks: this.commonTasks,
      hostClockNow: now(),
    };
  },
  pushMigration() {
    if (G.phase === 'lobby' || G.phase === 'over') return;
    const s = this.successorId();
    if (!s) return;
    if (s !== this._lastSuccessor) {
      this._lastSuccessor = s;
      Net.broadcast('successor', { id: s });
    }
    Net.toPeer(this.P[s].peerId, 'migstate', { s: this.exportState() });
  },

  /** 후계자가 방장을 인계받는다.
   *  snap 의 절대 시각은 '이전 방장 시계' 기준이므로 내 시계로 옮긴다.
   *  oldOffset = 승격 직전 내가 갖고 있던 Net.clockOffset (= 이전방장시각 − 내시각) */
  importState(snap, myId, oldOffset = 0) {
    const fix = t => (typeof t === 'number' && t > 1e12) ? t - oldOffset : t;

    this.P = {};
    for (const p of snap.players) {
      // 봇은 새 방장 브라우저에서 그대로 되살아난다 (연결이 아니라 로컬 시뮬레이션이므로)
      const q = { ...p, connected: p.id === myId || !!p.isBot,
                  peerId: p.id === myId ? 'self' : (p.isBot ? p.peerId : null) };
      q.killCdEnd = fix(q.killCdEnd); q.abilityCdEnd = fix(q.abilityCdEnd);
      q.morphEnd = fix(q.morphEnd); q.lastActive = fix(q.lastActive) || now();
      this.P[q.id] = q;
    }
    G.order = snap.order; G.phase = snap.phase; G.round = snap.round;
    G.settings = snap.settings; G.bodies = (snap.bodies || []).map(b => ({ ...b, t: fix(b.t) }));
    G.sabotage = snap.sabotage ? { ...snap.sabotage, endsAt: fix(snap.sabotage.endsAt) } : null;
    G.doors = {}; for (const k in (snap.doors || {})) G.doors[k] = fix(snap.doors[k]);
    G.taskBar = snap.taskBar; G.result = snap.result;
    G.sabCdEnd = fix(snap.sabCdEnd); G.startedAt = fix(snap.startedAt);
    this.commonTasks = snap.commonTasks || [];
    this.M = snap.meeting ? { ...snap.meeting, endsAt: fix(snap.meeting.endsAt) } : null;

    G.hostId = myId; G.myId = myId;
    this.peerToId = { self: myId };
    this._lastSuccessor = null;
    // 승격 직후엔 나만 '접속 상태'라 자동 개표가 즉시 터진다 → 재접속 유예
    this._graceUntil = now() + 12000;
  },

  sys(text, channel = 'all') { Net.broadcast('msg', { sys: true, text, channel, ts: now() }); },
  ev(type, data = {}) { Net.broadcast('event', { type, ...data }); },

  /* ---------------- 게임 시작 ---------------- */
  startGame() {
    const alive = G.order.filter(i => this.P[i]?.connected);
    if (alive.length < 4) { Net.toPeer(this.P[G.hostId].peerId, 'toast', { text: '최소 4명이 필요합니다.' }); return; }
    G.order = alive;
    const roles = assignRoles(alive, G.settings);
    this.commonTasks = pickN(COMMON_POOL, Math.min(G.settings.taskCommon, COMMON_POOL.length));

    const sp = spawnPoints(alive.length);
    alive.forEach((id, i) => {
      const p = this.P[id];
      p.role = roles[id]; p.alive = true; p.ventId = null;
      p.x = sp[i].x; p.y = sp[i].y; p.dir = 1; p.moving = false;
      p.tasks = makeTaskList(G.settings, this.commonTasks);
      p.killCdEnd = now() + 12000;
      p.abilityCdEnd = now() + 8000;
      p.abilityUses = roleInfo(p.role).uses || 0;
      p.emergencyLeft = G.settings.emergencies;
      p.shielded = false; p.infected = false; p.eaten = 0;
      p.killedThisRound = false; p.morphTo = null; p.morphEnd = 0; p.dragging = null;
      p.lastActive = now(); p.afk = false;
      p.trackTarget = null; p.trackEnd = 0; p.guarding = null;
    });
    // 연인(선택) — 현재 미사용
    G.bodies = []; G.sabotage = null; G.doors = {}; this.M = null; G.result = null;
    G.round = 1; G.phase = 'play'; G.startedAt = now();
    this.recalcTaskBar();
    this.pushState(); this.sendPrivateAll();
    this.ev('start');
  },

  toLobby() {
    G.phase = 'lobby'; G.bodies = []; G.sabotage = null; this.M = null; G.result = null; G.doors = {};
    for (const id of G.order) { const p = this.P[id]; if (p) { p.alive = true; p.ventId = null; p.tasks = []; p.role = 'goose'; } }
    G.taskBar = { done: 0, total: 0 };
    this.pushState(); this.sendPrivateAll(); this.ev('tolobby');
  },

  /* ---------------- 이동 ---------------- */
  onPos(id, m) {
    const p = this.P[id]; if (!p || G.phase !== 'play') return;
    p.x = m.x; p.y = m.y; p.dir = m.d; p.moving = !!m.mv;
    if (m.mv) this.markActive(p);
    if (p.dragging) {
      const b = G.bodies.find(b => b.id === p.dragging);
      if (b) { b.x = p.x; b.y = p.y; b.room = roomNameAt(p.x, p.y); }
    }
  },

  /* ---------------- 살해 ---------------- */
  onKill(id, targetId) {
    const k = this.P[id], v = this.P[targetId];
    if (!k || !v || G.phase !== 'play' || !k.alive || !v.alive || k.ventId) return;
    const r = roleInfo(k.role);
    if (!r.canKill) return;
    if (now() < k.killCdEnd) return;
    const range = G.settings.killRange * (r.killRangeMul || 1);
    if (Math.hypot(k.x - v.x, k.y - v.y) > range * 1.25) return;

    // 경호원 — 방패보다 먼저 판정. 경호원이 대신 쓰러지고 대상은 산다.
    const bg = G.order.map(i => this.P[i]).find(q => q && q.alive && q.role === 'bodyguard' && q.guarding === v.id);
    if (bg) {
      bg.guarding = null;
      k.killCdEnd = now() + G.settings.killCd * 1000 * (r.cdMul || 1);
      this.doDeath(bg, k.id);
      this.sys(`🛡️ 경호원 ${bg.name} 님이 ${v.name} 님을 지키고 쓰러졌습니다.`);
      Net.toPeer(v.peerId, 'toast', { text: '🛡️ 경호원이 당신을 대신해 죽었습니다!' });
      this.sendPrivate(k.id);
      this.afterDeath();
      return;
    }
    // 의사 방패
    if (v.shielded) {
      v.shielded = false;
      k.killCdEnd = now() + G.settings.killCd * 1000 * (r.cdMul || 1);
      this.sendPrivate(v.id); this.sendPrivate(k.id);
      Net.toPeer(v.peerId, 'toast', { text: '🛡️ 방패가 살해 시도를 막았습니다!' });
      Net.toPeer(k.peerId, 'toast', { text: '🛡️ 대상이 방패로 보호받고 있습니다!' });
      this.ev('shieldblock', { at: { x: v.x, y: v.y } });
      return;
    }
    // 숫양 자폭
    if (k.role === 'canadian' && isGoose(v.role)) {
      this.doDeath(v, k.id); this.doDeath(k, k.id);
      Net.toPeer(k.peerId, 'toast', { text: '💀 양을 죽였습니다. 당신도 함께 쓰러집니다.' });
      this.afterDeath(); return;
    }
    k.killCdEnd = now() + G.settings.killCd * 1000 * (r.cdMul || 1);
    k.killedThisRound = true;
    this.doDeath(v, k.id);
    this.sendPrivate(k.id);
    this.afterDeath();
  },

  doDeath(v, killerId) {
    v.alive = false; v.ventId = null;
    // 펠리컨은 삼켜버리므로 시체가 남지 않는다 (신고 불가)
    const noBody = killerId !== v.id && roleInfo(this.P[killerId]?.role).noBody;
    if (!noBody) {
      const body = { id: genId(), pid: v.id, color: v.color, x: v.x, y: v.y,
                     room: roomNameAt(v.x, v.y), t: now(), role: v.role };
      G.bodies.push(body);
    }
    // ⚠️ killer 는 절대 브로드캐스트하지 않는다 (콘솔만 열면 범인이 보인다)
    this.ev('kill', { victim: v.id, at: { x: v.x, y: v.y } });
    // 킬 연출은 가해자·피해자 두 사람에게만 개별 전송
    const k = this.P[killerId];
    if (k && k.id !== v.id) {
      Net.toPeer(v.peerId, 'killcine', {
        killer: G.settings.showKiller ? k.color : null, victim: v.color, asVictim: true });
      Net.toPeer(k.peerId, 'killcine', { killer: k.color, victim: v.color, asVictim: false });
    }
    this.sendPrivate(v.id);
    this.recalcTaskBar();
  },
  afterDeath() { this.pushState(); this.checkWin(); },

  /* ---------------- 신고 / 긴급회의 ---------------- */
  onReport(id, bodyId) {
    const p = this.P[id]; if (!p || !p.alive || G.phase !== 'play') return;
    const b = G.bodies.find(x => x.id === bodyId); if (!b) return;
    if (Math.hypot(p.x - b.x, p.y - b.y) > 110) return;
    this.startMeeting(p.id, b);
  },
  onEmergency(id) {
    const p = this.P[id]; if (!p || !p.alive || G.phase !== 'play') return;
    if (p.emergencyLeft <= 0) return;
    if (Math.hypot(p.x - EMERGENCY_BTN.wx, p.y - EMERGENCY_BTN.wy) > 110) return;
    if (G.sabotage && (G.sabotage.kind === 'reactor' || G.sabotage.kind === 'oxygen')) return;
    p.emergencyLeft--; this.sendPrivate(p.id);
    this.startMeeting(p.id, null);
  },

  startMeeting(callerId, body) {
    const caller = this.P[callerId];
    G.phase = 'meeting';
    G.sabotage = null; G.doors = {};
    const deadSince = G.bodies.map(b => ({ pid: b.pid, room: b.room, t: b.t }));
    G.bodies = [];
    for (const id of G.order) { const p = this.P[id]; if (p) { p.votes = null; p.ventId = null; p.dragging = null; p.morphEnd = 0; } }
    this.M = {
      caller: callerId, body: body ? { pid: body.pid, room: body.room, color: body.color } : null,
      phase: 'discuss', endsAt: now() + G.settings.discussSec * 1000,
      votes: {}, tally: null, reported: deadSince,
    };
    this.pushState();                       // 뷰 상태를 먼저 배포해야 회의 화면이 열린다
    this.ev('meeting', { caller: callerId, body: this.M.body });
    if (body) this.sys(`🚨 ${caller.name} 님이 ${body.room}에서 시체를 발견했습니다. (사망자: ${this.P[body.pid]?.name || '?'})`);
    else this.sys(`🔔 ${caller.name} 님이 긴급 회의를 소집했습니다.`);
    // 장의사 부검 결과 자동 공유
    for (const id of G.order) {
      const p = this.P[id];
      if (p?.role === 'mortician' && p.autopsy?.length) {
        p.autopsy.forEach(a => Net.toPeer(p.peerId, 'privlog', { text: `⚰️ 부검: ${this.P[a.pid]?.name}의 직업은 [${roleInfo(a.role).name}], 발견 시점 기준 사망 후 ${a.ago}초 경과` }));
        p.autopsy = [];
      }
    }
    this.pushState();
  },

  onVote(id, target) {
    const p = this.P[id];
    if (!p || !p.alive || G.phase !== 'meeting' || this.M?.phase !== 'vote') return;
    if (this.M.votes[id] != null) return;
    this.M.votes[id] = target;
    this.ev('voted', { voter: id });
    this.pushState();
    // 연결이 끊긴 사람은 표를 던질 수 없으므로 개표 조건에서 제외 (회의가 멈추지 않게)
    if (now() < (this._graceUntil || 0)) return;      // 방장 교체 직후 재접속 유예
    const aliveIds = G.order.filter(i => this.P[i]?.alive && this.P[i]?.connected && !this.P[i]?.afk);
    if (aliveIds.length >= 2 && aliveIds.every(i => this.M.votes[i] != null)) this.endVote();
  },

  endVote() {
    const m = this.M; if (!m || m.tally) return;
    const counts = {}; let skip = 0;
    for (const [voter, target] of Object.entries(m.votes)) {
      const w = roleInfo(this.P[voter]?.role).votes || 1;
      if (target === 'skip') skip += w; else counts[target] = (counts[target] || 0) + w;
    }
    let top = null, topN = 0, tie = false;
    for (const [k, v] of Object.entries(counts)) { if (v > topN) { top = k; topN = v; tie = false; } else if (v === topN) tie = true; }
    const ejectId = (top && topN > skip && !tie) ? top : null;
    m.tally = { counts, skip, ejectId, votes: m.votes };
    G.phase = 'eject';
    if (ejectId) {
      const p = this.P[ejectId];
      p.alive = false; p.ventId = null;
      this.recalcTaskBar();
      this.sendPrivate(ejectId);
      // 암살자/추방 등으로 남은 정보 갱신
    }
    // 직업 공개 설정이 꺼져 있으면 role 자체를 보내지 않는다 (클라 분기만으로는 새어나간다)
    const reveal = G.settings.confirmEject;
    this.ev('ejectresult', {
      ejectId, tally: m.tally,
      role: (reveal && ejectId) ? this.P[ejectId].role : null,
      confirm: reveal,
      remainDucks: reveal ? G.order.filter(i => this.P[i].alive && isDuck(this.P[i].role)).length : null,
    });
    this.pushState();
    setTimeout(() => this.resumePlay(), G.settings.confirmEject ? 7200 : 5200);
  },

  resumePlay() {
    if (G.phase === 'over') return;
    if (this.checkWin()) return;
    G.phase = 'play'; this.M = null; G.round++;
    const sp = spawnPoints(G.order.length);
    G.order.forEach((id, i) => {
      const p = this.P[id]; if (!p) return;
      p.x = sp[i].x; p.y = sp[i].y; p.moving = false; p.ventId = null; p.killedThisRound = false;
      const r = roleInfo(p.role);
      p.killCdEnd = now() + G.settings.killCd * 1000 * (r.cdMul || 1);
      if (r.ability === 'remotefix') p.abilityUses = r.uses || 1;
    });
    G.sabCdEnd = now() + 10000;
    this.pushState(); this.sendPrivateAll(); this.ev('resume');
  },

  /* ---------------- 벤트 ---------------- */
  onVent(id, ventId) {
    const p = this.P[id]; if (!p || !p.alive || G.phase !== 'play') return;
    if (!roleInfo(p.role).canVent) return;
    if (ventId === null) {
      p.ventId = null; this.pushState();
      this.ventNotify(id, false, roomNameAt(p.x, p.y), p.x, p.y);
      return;
    }
    const v = VENTS.find(x => x.id === ventId); if (!v) return;
    if (!p.ventId && Math.hypot(p.x - v.wx, p.y - v.wy) > 80) return;
    if (p.ventId) { const cur = VENTS.find(x => x.id === p.ventId); if (!cur || cur.net !== v.net) return; }
    const entering = !p.ventId;
    p.ventId = ventId; p.x = v.wx; p.y = v.wy;
    this.pushState();
    this.ventNotify(id, entering, ROOMS.find(r => r.id === v.room)?.name || '?', v.wx, v.wy);
  },

  /** 벤트 사용 알림.
   *  ⚠️ 사용자 id 를 전체에 뿌리면 콘솔로 늑대가 특정된다.
   *     전체에는 '소리용 위치'만, 사용자 정보는 조류관찰자에게만 개별 전송. */
  ventNotify(userId, entering, roomName, wx, wy) {
    this.ev('vent', { in: entering, room: roomName, at: { x: wx, y: wy } });
    for (const oid of G.order) {
      const o = this.P[oid];
      if (!o || o.id === userId || !o.alive || o.role !== 'birdwatcher') continue;
      Net.toPeer(o.peerId, 'ventalert', { room: roomName });
    }
  },

  /* ---------------- 사보타주 ---------------- */
  onSabotage(id, kind, room) {
    const p = this.P[id]; if (!p || !p.alive || G.phase !== 'play') return;
    if (!isDuck(p.role)) return;
    if (now() < G.sabCdEnd) return;
    if (kind === 'doors') {
      if (!room || G.doors[room] > now()) return;
      G.doors[room] = now() + G.settings.doorSec * 1000;
      G.sabCdEnd = now() + 12000;
      this.ev('doors', { room }); this.pushState(); return;
    }
    if (G.sabotage) return;
    const dur = kind === 'reactor' ? G.settings.reactorSec : kind === 'oxygen' ? G.settings.oxygenSec : 0;
    const data = {};
    if (kind === 'oxygen') data.code = String(1000 + ((Math.random() * 9000) | 0));
    if (kind === 'lights') data.switches = [0, 0, 0, 0, 0].map(() => Math.random() < 0.5 ? 1 : 0);
    if (kind === 'lights' && data.switches.every(s => s === 1)) data.switches[0] = 0;
    if (kind === 'comms') data.dials = [Math.random() * 100 | 0, Math.random() * 100 | 0];
    if (kind === 'reactor') data.hold = {};
    G.sabotage = { kind, endsAt: dur ? now() + dur * 1000 : 0, data };
    G.sabCdEnd = now() + G.settings.sabotageCd * 1000;
    this.ev('sabotage', { kind });
    this.pushState();
  },

  onSabFix(id, m) {
    const p = this.P[id]; if (!p || !G.sabotage || G.phase !== 'play') return;
    const S = G.sabotage;
    if (m.kind !== S.kind) return;
    if (S.kind === 'lights') {
      if (m.idx != null) S.data.switches[m.idx] = m.val ? 1 : 0;
      if (S.data.switches.every(s => s === 1)) return this.clearSab();
      this.pushState();
    } else if (S.kind === 'comms') {
      if (m.idx != null) S.data.dials[m.idx] = m.val;
      if (Math.abs(S.data.dials[0] - 50) < 4 && Math.abs(S.data.dials[1] - 50) < 4) return this.clearSab();
      this.pushState();
    } else if (S.kind === 'oxygen') {
      S.data[`ok${m.idx}`] = true;
      if (S.data.ok0 && S.data.ok1) return this.clearSab();
      this.pushState();
    } else if (S.kind === 'reactor') {
      S.data.hold[m.idx] = m.val ? now() : 0;
      const a = S.data.hold[0] || 0, b = S.data.hold[1] || 0;
      if (a && b) return this.clearSab();
      this.pushState();
    }
  },
  clearSab() { G.sabotage = null; this.ev('sabfixed'); this.pushState(); },

  /* ---------------- 임무 ---------------- */
  onTaskStep(id, tid) {
    const p = this.P[id]; if (!p) return;
    if (!p.alive && !G.settings.ghostTasks) return;
    const t = p.tasks.find(x => x.tid === tid); if (!t || t.step >= t.spots.length) return;
    t.step++;
    this.sendPrivate(id);
    this.recalcTaskBar();
    this.pushState();
    if (t.step >= t.spots.length) {
      const sp = spotById(t.spots[0]);
      // 시각 임무는 '그 자리에 있던 사람'에게만 보여야 한다 (전체 브로드캐스트는 양 확정 정보 누출)
      if (sp?.vis && G.settings.visualTasks && p.alive) {
        for (const oid of G.order) {
          const o = this.P[oid];
          if (!o || o.id === id) continue;
          if (Math.hypot(o.x - p.x, o.y - p.y) > 400) continue;
          Net.toPeer(o.peerId, 'visualtask', { pid: id, kind: sp.kind });
        }
      }
    }
    this.checkWin();
  },

  recalcTaskBar() {
    let done = 0, total = 0;
    for (const id of G.order) {
      const p = this.P[id]; if (!p) continue;
      if (roleInfo(p.role).fakeTasks) continue;   // 늑대/중립의 가짜 임무는 제외 (첩자는 예외)
      total += taskTotalSteps(p.tasks);
      done += p.tasks.reduce((a, t) => a + t.step, 0);
    }
    G.taskBar = { done, total };
  },

  /* ---------------- 특수 능력 ---------------- */
  onAbility(id, m) {
    const p = this.P[id]; if (!p || G.phase === 'lobby') return;
    const r = roleInfo(p.role);
    const target = m.target ? this.P[m.target] : null;
    switch (m.kind) {
      case 'investigate': {          // 탐정
        if (p.role !== 'detective' || !p.alive || now() < p.abilityCdEnd || !target || !target.alive) return;
        if (Math.hypot(p.x - target.x, p.y - target.y) > 130) return;
        p.abilityCdEnd = now() + (r.cd || 45) * 1000;
        Net.toPeer(p.peerId, 'privlog', { text: `🔎 ${target.name}: 이번 라운드에 살인 ${target.killedThisRound ? '있음 ⚠️' : '없음'}` });
        this.sendPrivate(id); break;
      }
      case 'autopsy': {              // 장의사
        if (p.role !== 'mortician' || !p.alive) return;
        const b = G.bodies.find(x => x.id === m.body); if (!b) return;
        if (Math.hypot(p.x - b.x, p.y - b.y) > 110) return;
        const ago = Math.round((now() - b.t) / 1000);
        (p.autopsy ||= []).push({ pid: b.pid, role: b.role, ago });
        Net.toPeer(p.peerId, 'privlog', { text: `⚰️ 부검 완료 — ${this.P[b.pid]?.name}: [${roleInfo(b.role).name}] · 사망 ${ago}초 전` });
        break;
      }
      case 'remotefix': {            // 기술자
        if (p.role !== 'engineer' || !p.alive || p.abilityUses <= 0 || !G.sabotage) return;
        if (G.sabotage.kind === 'doors') return;
        p.abilityUses--; this.sendPrivate(id);
        this.sys(`🔧 누군가 사보타주를 원격으로 수리했습니다.`);
        this.clearSab(); break;
      }
      case 'shoot': {                // 보안관
        if (p.role !== 'sheriff' || !p.alive || p.abilityUses <= 0 || now() < p.abilityCdEnd) return;
        if (!target || !target.alive) return;
        if (Math.hypot(p.x - target.x, p.y - target.y) > 150) return;
        p.abilityUses--; p.abilityCdEnd = now() + (r.cd || 25) * 1000;
        if (isSheriffTarget(target.role)) { this.doDeath(target, p.id); Net.toPeer(p.peerId, 'toast', { text: '⭐ 명중! 적을 처치했습니다.' }); }
        else { this.doDeath(p, p.id); Net.toPeer(p.peerId, 'toast', { text: '💀 무고한 양이었습니다. 당신이 쓰러집니다.' }); }
        this.sendPrivate(id); this.afterDeath(); break;
      }
      case 'shield': {               // 의사
        if (p.role !== 'doctor' || !p.alive || p.abilityUses <= 0 || !target || !target.alive) return;
        if (Math.hypot(p.x - target.x, p.y - target.y) > 130) return;
        p.abilityUses--; target.shielded = true;
        this.sendPrivate(id); this.sendPrivate(target.id);
        Net.toPeer(target.peerId, 'toast', { text: '🛡️ 누군가 당신에게 방패를 씌웠습니다.' });
        Net.toPeer(p.peerId, 'toast', { text: `🩺 ${target.name} 님을 보호했습니다.` });
        break;
      }
      case 'morph': {                // 변신술사
        if (p.role !== 'morphling' || !p.alive) return;
        if (m.sample) {
          if (!target || Math.hypot(p.x - target.x, p.y - target.y) > 130) return;
          p.sample = target.id; this.sendPrivate(id);
          Net.toPeer(p.peerId, 'toast', { text: `🎭 ${target.name} 님의 털을 조금 얻었습니다.` });
        } else {
          if (!p.sample || now() < p.abilityCdEnd) return;
          p.morphTo = p.sample; p.morphEnd = now() + 15000;
          p.abilityCdEnd = now() + (r.cd || 25) * 1000;
          this.sendPrivate(id);
        }
        break;
      }
      case 'drag': {                 // 매장인
        if (p.role !== 'undertaker' || !p.alive) return;
        if (p.dragging) { p.dragging = null; this.sendPrivate(id); this.pushState(); break; }
        const b = G.bodies.find(x => Math.hypot(p.x - x.x, p.y - x.y) < 100);
        if (b) { p.dragging = b.id; this.sendPrivate(id); this.pushState(); }
        break;
      }
      case 'eat': {                  // 독수리
        if (p.role !== 'vulture' || !p.alive) return;
        const bi = G.bodies.findIndex(x => Math.hypot(p.x - x.x, p.y - x.y) < 100);
        if (bi < 0) return;
        G.bodies.splice(bi, 1); p.eaten++;
        this.sendPrivate(id);
        Net.toPeer(p.peerId, 'toast', { text: `🦅 시체를 먹었습니다 (${p.eaten}/${roleInfo('vulture').winNeed})` });
        this.pushState(); this.checkWin(); break;
      }
      case 'infect': {               // 비둘기
        if (p.role !== 'pigeon' || !p.alive || now() < p.abilityCdEnd || !target || !target.alive) return;
        if (Math.hypot(p.x - target.x, p.y - target.y) > 120) return;
        if (target.infected) return;
        target.infected = true; p.abilityCdEnd = now() + (r.cd || 20) * 1000;
        this.sendPrivate(id); this.sendPrivate(target.id);
        const rest = G.order.filter(i => this.P[i].alive && this.P[i].id !== p.id && !this.P[i].infected).length;
        Net.toPeer(p.peerId, 'toast', { text: `🕊️ 감염시켰습니다. 남은 대상 ${rest}명` });
        this.checkWin(); break;
      }
      case 'track': {                // 추적자
        if (p.role !== 'tracker' || !p.alive || now() < p.abilityCdEnd || !target || !target.alive) return;
        if (Math.hypot(p.x - target.x, p.y - target.y) > 140) return;
        p.trackTarget = target.id; p.trackEnd = now() + 15000;
        p.abilityCdEnd = now() + (r.cd || 40) * 1000;
        this.sendPrivate(id);
        Net.toPeer(p.peerId, 'toast', { text: `📡 ${target.name} 님을 15초간 추적합니다.` });
        break;
      }
      case 'guard': {                // 경호원
        if (p.role !== 'bodyguard' || !p.alive || p.abilityUses <= 0 || !target || !target.alive) return;
        if (target.id === p.id) return;
        if (Math.hypot(p.x - target.x, p.y - target.y) > 140) return;
        p.abilityUses--; p.guarding = target.id;
        this.sendPrivate(id);
        Net.toPeer(p.peerId, 'toast', { text: `🛡️ ${target.name} 님을 경호합니다. 그 사람이 노려지면 대신 죽습니다.` });
        break;
      }
      case 'guess': {                // 암살자 (회의 중)
        if (p.role !== 'assassin' || !p.alive || p.abilityUses <= 0 || G.phase !== 'meeting') return;
        if (!target || !target.alive || target.id === p.id) return;
        p.abilityUses--;
        const hit = target.role === m.role;
        if (hit) { this.doDeath(target, p.id); this.sys(`🗡️ ${target.name} 님이 암살당했습니다. (직업: ${roleInfo(target.role).name})`); }
        else { this.doDeath(p, p.id); this.sys(`🗡️ 암살 시도가 빗나갔습니다. ${p.name} 님이 쓰러집니다.`); }
        this.sendPrivate(id); this.pushState(); this.checkWin(); break;
      }
    }
  },

  /* ---------------- 채팅 ---------------- */
  onChat(id, text, channel) {
    const p = this.P[id]; if (!p || !text) return;
    text = String(text).slice(0, 160);
    if (G.phase === 'play' && p.alive) return;                 // 게임 중 산 사람은 채팅 불가
    const dead = !p.alive;
    // 유령 채팅은 유령 + 영매에게만
    if (dead && G.phase !== 'lobby') {
      const msg = { from: p.id, name: p.name, color: p.color, text, ts: now(), channel: 'dead' };
      for (const oid of G.order) {
        const o = this.P[oid];
        if (!o) continue;
        if (!o.alive || o.role === 'medium') Net.toPeer(o.peerId, 'msg', msg);
      }
      return;
    }
    Net.broadcast('msg', { from: p.id, name: p.name, color: p.color, text, ts: now(), channel: 'all' });
  },

  /* ---------------- 연습용 봇 ----------------
   * 혼자서는 4인 게임을 테스트할 수 없다. 로비에서 봇을 채워
   * 이동·킬·신고·회의·투표·승리판정까지 전부 혼자 돌려볼 수 있게 한다.
   * 봇은 방장 브라우저 안에서만 산다(네트워크 연결 없음, peerId 'bot:N'). */
  addBot() {
    if (G.phase !== 'lobby' || G.order.length >= 16) return null;
    const n = (this._botSeq = (this._botSeq || 0) + 1);
    const p = this.addPlayer('bot:' + n, 'bot:' + n, '양봇' + n, null);
    if (!p) return null;
    p.isBot = true;
    this.sys(`🤖 ${p.name} 이(가) 추가되었습니다.`);
    this.pushState();
    return p;
  },
  removeBots() {
    if (G.phase !== 'lobby') return;
    for (const id of [...G.order]) {
      const p = this.P[id];
      if (p?.isBot) { delete this.peerToId[p.peerId]; delete this.P[id]; G.order = G.order.filter(x => x !== id); }
    }
    this.sys('🤖 봇을 모두 내보냈습니다.');
    this.pushState();
  },

  /** 봇 행동. tick(50ms)마다 호출 */
  botTick() {
    const dt = 0.05;
    for (const id of G.order) {
      const p = this.P[id];
      if (!p?.isBot) continue;
      const b = (p._bot ||= { tx: p.x, ty: p.y, idleUntil: 0, taskAt: now() + rnd(12000, 25000), voteAt: 0 });

      if (G.phase === 'play' && p.alive) {
        // 배회 — 목표점에 도착했거나 오래 걸리면 새 목표
        if (now() > b.idleUntil) {
          const dx = b.tx - p.x, dy = b.ty - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 20 || !b.deadline || now() > b.deadline) {
            if (Math.random() < 0.25) { b.idleUntil = now() + rnd(800, 2600); p.moving = false; }
            const spot = TASK_SPOTS[(Math.random() * TASK_SPOTS.length) | 0];
            b.tx = spot.wx + rnd(-40, 40); b.ty = spot.wy + rnd(-40, 40);
            b.deadline = now() + 20000;
          } else {
            const spd = G.settings.playerSpeed * (dt * 60);
            const r = moveWithCollision(p.x, p.y, (dx / dist) * spd, (dy / dist) * spd);
            // 벽에 막혀 못 움직이면 목표를 버린다
            if (Math.abs(r.x - p.x) < 0.1 && Math.abs(r.y - p.y) < 0.1) b.deadline = 0;
            if (dx) p.dir = dx > 0 ? 1 : -1;
            p.x = r.x; p.y = r.y; p.moving = true;
          }
          p.lastActive = now();
        }
        // 가끔 임무 1단계 (진행바가 실제로 움직이는지 테스트용)
        if (now() > b.taskAt) {
          b.taskAt = now() + rnd(15000, 30000);
          const t = p.tasks.find(t => t.step < t.spots.length);
          if (t) this.onTaskStep(id, t.tid);
        }
      }

      // 투표 — 사람이 표를 던질 시간을 주도록 8~18초 늦게
      if (G.phase === 'meeting' && this.M?.phase === 'vote' && p.alive) {
        if (this.M.votes[id] == null) {
          if (!b.voteAt) b.voteAt = now() + rnd(8000, 18000);
          if (now() > b.voteAt) {
            const targets = G.order.filter(i => this.P[i]?.alive && i !== id);
            const pick = Math.random() < 0.6 ? 'skip' : targets[(Math.random() * targets.length) | 0];
            this.onVote(id, pick);
          }
        }
      } else b.voteAt = 0;
    }
  },

  /* ---------------- 자리비움(AFK) ----------------
   * 전화 받으러 간 사람 때문에 회의가 타이머 끝까지 멈춰 있으면 안 된다. */
  markActive(p) {
    if (!p) return;
    p.lastActive = now();
    if (p.afk) { p.afk = false; this.pushState(); }
  },
  updateAfk() {
    if (G.phase === 'lobby' || G.phase === 'over') return;
    let changed = false;
    for (const id of G.order) {
      const p = this.P[id]; if (!p || !p.alive) continue;
      const idle = now() - (p.lastActive || 0) > 75000;
      if (idle !== !!p.afk) { p.afk = idle; changed = true; }
    }
    if (changed) this.pushState();
  },

  /* ---------------- 틱 ---------------- */
  tick() {
    this.botTick();
    if (!this._afkTick || now() - this._afkTick > 3000) { this._afkTick = now(); this.updateAfk(); }
    if (G.phase === 'meeting' && this.M) {
      const m = this.M;
      if (m.phase === 'discuss' && now() >= m.endsAt) {
        m.phase = 'vote'; m.endsAt = now() + G.settings.voteSec * 1000;
        this.ev('votestart'); this.pushState();
      } else if (m.phase === 'vote' && now() >= m.endsAt) this.endVote();
    }
    if (G.phase === 'play') {
      // 변신 만료
      for (const id of G.order) { const p = this.P[id]; if (p?.morphEnd && now() > p.morphEnd) { p.morphTo = null; p.morphEnd = 0; } }
      // 문 잠금 만료
      let ch = false;
      for (const k in G.doors) if (G.doors[k] <= now()) { delete G.doors[k]; ch = true; }
      if (ch) this.pushState();
      // 치명적 사보타주 타임아웃
      if (G.sabotage?.endsAt && now() >= G.sabotage.endsAt) {
        this.finish('duck', G.sabotage.kind === 'reactor' ? '물레방아가 부서졌습니다' : '물이 모두 말랐습니다');
      }
    }
  },

  /* ---------------- 승리 판정 ---------------- */
  checkWin() {
    if (G.phase === 'over' || G.phase === 'lobby') return false;
    const alive = G.order.map(i => this.P[i]).filter(p => p && p.alive);
    const ducks = alive.filter(p => isDuck(p.role));
    const neutKillers = alive.filter(p => isNeut(p.role) && isKiller(p.role));
    const others = alive.filter(p => !isDuck(p.role));

    // 중립 단독 승리
    for (const p of alive) {
      if (p.role === 'vulture' && p.eaten >= roleInfo('vulture').winNeed) return this.finish('neutral', `🦅 독수리 ${p.name} 님이 시체 3구를 먹었습니다`, [p.id]);
      if (p.role === 'pigeon') {
        const targets = alive.filter(q => q.id !== p.id);
        if (targets.length > 0 && targets.every(q => q.infected)) return this.finish('neutral', `🕊️ 비둘기 ${p.name} 님이 전원을 감염시켰습니다`, [p.id]);
      }
    }
    if (neutKillers.length === 1 && alive.length === 1) return this.finish('neutral', `🪶 ${neutKillers[0].name} 님이 홀로 살아남았습니다`, [neutKillers[0].id]);

    // 임무 완수
    if (G.taskBar.total > 0 && G.taskBar.done >= G.taskBar.total) return this.finish('goose', '양들이 모든 임무를 완수했습니다');
    // 늑대 전멸
    if (ducks.length === 0 && neutKillers.length === 0) return this.finish('goose', '늑대를 모두 찾아냈습니다');
    // 늑대 과반
    if (ducks.length > 0 && ducks.length >= others.length) return this.finish('duck', '늑대의 수가 양과 같아졌습니다');
    return false;
  },

  finish(faction, reason, winnerIds) {
    if (G.phase === 'over') return true;
    G.phase = 'over';
    const winners = winnerIds || G.order.filter(i => roleInfo(this.P[i].role).faction === faction);
    G.result = {
      faction, reason, winners,
      roster: G.order.map(i => ({ id: i, name: this.P[i].name, color: this.P[i].color, role: this.P[i].role, alive: this.P[i].alive })),
      duration: Math.round((now() - G.startedAt) / 1000),
    };
    this.M = null; G.sabotage = null;
    this.pushState(); this.ev('over', { result: G.result });
    return true;
  },
};
