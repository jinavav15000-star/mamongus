/* ============================================================================
 *  마몽어스 · 메인 (입력 · 루프 · 액션 · 부팅)
 * ==========================================================================*/
const Game = {
  input: { dx: 0, dy: 0, keys: {} },
  stick: { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 },
  lastPosSent: 0,
  lastT: 0,
  useTarget: null,
  killTarget: null,
  voicePeers: {},
  wakeLock: null,
  infoCache: {},        // 사무실·감시초소 서버 응답 캐시

  /* ═══════════ 부팅 ═══════════ */
  boot() {
    Sfx.init();
    G.guideOn = localStorage.getItem('duckus_guide') !== '0';
    const savedName = localStorage.getItem('duckus_name') || '';
    $('#in-name').value = savedName;
    $('#in-name2').value = savedName;

    $('#btn-create').onclick = () => this.createRoom();
    $('#btn-join').onclick   = () => this.joinRoom($('#in-code').value.trim().toUpperCase());
    $('#in-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''); });
    $('#in-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });
    $('#btn-howto').onclick = () => UI.openHowTo();
    $('#btn-roles-info').onclick = () => UI.openRolesInfo();
    $('#btn-copy').onclick = () => this.copyLink();
    $('#btn-leave').onclick = () => { if (confirm('방에서 나가시겠습니까?')) { history.replaceState(null, '', location.pathname); location.reload(); } };
    $('#in-name2').addEventListener('change', e => {
      const n = e.target.value.trim().slice(0, 10) || '양';
      localStorage.setItem('duckus_name', n); Net.toHost('setName', { name: n });
    });
    $$('.tabs button').forEach(b => b.onclick = () => {
      $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
      ['players','settings','roles'].forEach(t => $('#tab-' + t).classList.toggle('hidden', t !== b.dataset.tab));
    });
    // 전체화면 버튼 — 메뉴 안에 숨어 있으면 아무도 못 찾는다. 눈에 보이는 곳에 둔다.
    $('#btn-fs').onclick      = () => Viewport.pressFullscreen();
    $('#btn-fs-home').onclick = () => Viewport.pressFullscreen();
    $('#btn-fs-gate').onclick = () => Viewport.pressFullscreen();
    $('#btn-map').onclick = () => UI.openMap('map');
    $('#btn-menu').onclick = () => UI.openMenu();
    $('#btn-ghostchat').onclick = () => Meeting.openGhostChat();
    $('#chat-send').onclick = () => Meeting.send($('#chat-in').value);
    $('#chat-in').addEventListener('keydown', e => { if (e.key === 'Enter') Meeting.send(e.target.value); });
    const lobbySend = () => { const v = $('#lobby-chat-in').value.trim(); if (v) { Net.toHost('chat', { text: v }); $('#lobby-chat-in').value = ''; } };
    $('#lobby-chat-send').onclick = lobbySend;
    $('#lobby-chat-in').addEventListener('keydown', e => { if (e.key === 'Enter') lobbySend(); });

    /* 대기실 HUD · 맵 채팅 */
    $('#btn-lobby-close').onclick = () => UI.closeLobbyPanel();
    $('#btn-lobbypanel').onclick = () => UI.openLobbyPanel();
    $('#btn-copy2').onclick = () => $('#btn-copy').click();
    $('#btn-lobby-start').onclick = () => Game.start();
    $('#btn-chat').onclick = () => UI.togglePlayChat();
    $('#play-chat-close').onclick = () => UI.closePlayChat();
    const playSend = () => {
      const v = $('#play-chat-in').value.trim();
      if (v) { Net.toHost('chat', { text: v }); $('#play-chat-in').value = ''; }
    };
    $('#play-chat-send').onclick = playSend;
    $('#play-chat-in').addEventListener('keydown', e => { if (e.key === 'Enter') playSend(); e.stopPropagation(); });
    $('#play-chat-in').addEventListener('keyup', e => e.stopPropagation());

    this.bindInput();
    Render.init($('#game-canvas'));
    this.wireNet();
    Viewport.init();
    this.setupImmersive();

    // 초대 링크 → 바로 자동 참가.
    // 전에는 홈에서 '참가'를 누르게 했는데, 화면에서 제일 큰 버튼이 '방 만들기'라
    // 초대받은 사람이 그걸 눌러 자기 혼자 있는 새 방을 만드는 사고가 실제로 났다.
    const m = location.hash.match(/#room=([A-Z2-9]{4})/i);
    if (m) {
      const code = m[1].toUpperCase();
      $('#in-code').value = code;
      this.autoJoin(code);
    }
    ['click','touchstart','keydown'].forEach(ev =>
      window.addEventListener(ev, () => { Sfx.resume(); }, { once: true }));
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('gesturestart', e => e.preventDefault());
    requestAnimationFrame(t => this.loop(t));
  },

  /* ═══════════ 몰입 모드 (가로 전체화면) ═══════════ */
  setupImmersive() {
    // 회전 안내에 기기별 문구를 채운다
    const hint = $('#rotate-hint');
    if (Viewport.isInApp)
      hint.innerHTML = '카카오톡 안에서는 화면 고정이 되지 않습니다.<br>우측 상단 <b>⋮ → 다른 브라우저로 열기</b> 를 추천합니다.';
    else if (Viewport.isIPhone)
      hint.innerHTML = '아이폰은 사파리가 화면 고정을 지원하지 않습니다.<br>제어센터의 <b>세로 방향 잠금</b>이 켜져 있다면 꺼주세요.';

    // 인앱 브라우저 안내 (전체화면·방향고정이 모두 막힌 환경)
    if (Viewport.shouldHintInApp()) setTimeout(() => UI.openInAppHint(), 900);
    // 아이폰 전체화면 안내
    else if (Viewport.shouldHintIOS()) setTimeout(() => UI.openIOSHint(), 900);
  },

  /** 화면 꺼짐 방지.
   *  wakeLock 은 탭이 가려지면 자동 해제되므로 돌아올 때마다 다시 요청해야 한다. */
  async keepAwake() {
    try { if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen'); } catch {}
    if (this._visBound) return;
    this._visBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') { this._hiddenAt = Date.now(); return; }
      this.keepAwake();
      // 백그라운드에서 시그널링이 끊겼으면 즉시 복구 — 초대 링크가 계속 살아 있어야 한다
      try { if (Net.peer && !Net.peer.destroyed && Net.peer.disconnected) Net.peer.reconnect(); } catch {}
      // 방장이 오래 자리를 비우면 모두의 화면이 끊긴다 → 돌아왔을 때 알려준다
      const away = Date.now() - (this._hiddenAt || 0);
      if (Net.isHost && G.phase !== 'lobby' && away > 8000)
        UI.toast('⚠️ 방장 화면이 꺼져 있으면 모두의 게임이 멈춥니다. 이 탭을 켜 두세요.', 7000);
    });
  },

  err(msg) { $('#home-err').textContent = msg; UI.loading(false); },

  async createRoom() {
    if (Viewport.wantsImmersive && !Viewport.userExited) Viewport.enter();   // 클릭 제스처 안 — 전체화면 재보장
    const name = ($('#in-name').value.trim() || '양').slice(0, 10);
    localStorage.setItem('duckus_name', name);
    UI.loading(true, '방을 만드는 중…');
    try {
      const code = await Net.createRoom();
      G.myId = 'HOST'; G.hostId = 'HOST';
      Host.init();
      // 호스트 자신을 플레이어로 등록
      const p = Host.addPlayer('self', Net.uid, name, null);
      G.myId = p.id; G.hostId = p.id; Host.peerToId['self'] = p.id;
      Host.pushState();
      history.replaceState(null, '', '#room=' + code);
      UI.loading(false);
      UI.show('game'); Render.resize();
      UI.hintLobbyMenu();
      $('#in-name2').value = name;
      this.keepAwake();
      UI.toast('방을 만들었습니다! 왼쪽 위 <b>🔗 복사</b>를 눌러 카카오톡에 붙여넣으세요.', 7000);
    } catch (e) { this.err(e.message); }
  },

  /** 초대 링크로 들어온 자동 참가. 실패하면 잠시 뒤 재시도 —
   *  방장이 링크를 보내느라 카톡에 가 있으면 방이 몇 초간 안 잡힐 수 있다. */
  async autoJoin(code, attempt = 1) {
    const MAX = 3;
    UI.loading(true, attempt === 1 ? `방 ${code} 에 들어가는 중…` : `방장을 찾는 중… (${attempt}/${MAX})`);
    const name = ($('#in-name').value.trim() || localStorage.getItem('duckus_name') || '양').slice(0, 10);
    try {
      await Net.joinRoom(code);
      Net.toHost('hello', { uid: Net.uid, name, color: null });
      history.replaceState(null, '', '#room=' + code);
      $('#in-name2').value = name;
      this.keepAwake();
      setTimeout(() => UI.loading(false), 600);
    } catch (e) {
      if (attempt < MAX) return this.autoJoin(code, attempt + 1);
      UI.loading(false);
      this.err('');
      // 마지막에도 실패 — 재시도 버튼을 크게, '방 만들기'로 오인하지 않게 안내
      UI.modal({ title:'😢 방을 찾지 못했습니다', body:`
<div style="font-size:14px;line-height:1.75">
방 <b style="color:var(--warn)">${code}</b> 의 방장이 지금 자리를 비운 것 같습니다.<br>
방장이 <b>게임 화면을 켜 둔 상태</b>여야 들어갈 수 있습니다.<br><br>
<span class="tiny dim">※ <b>방 만들기</b>를 누르면 친구와 다른 방이 생깁니다.
초대받았다면 아래 다시 시도를 눌러 주세요.</span></div>`,
        footer: [
          h('button', { cls:'btn primary grow', onclick: () => { UI.closeModal(); this.autoJoin(code); } }, '🔄 다시 시도'),
          h('button', { cls:'btn ghost grow', onclick: () => UI.closeModal() }, '닫기'),
        ] });
    }
  },

  async joinRoom(code) {
    if (Viewport.wantsImmersive && !Viewport.userExited) Viewport.enter();   // 클릭 제스처 안 — 전체화면 재보장
    if (!/^[A-Z2-9]{4}$/.test(code)) return this.err('방 코드 4자리를 입력하세요.');
    const name = ($('#in-name').value.trim() || '양').slice(0, 10);
    localStorage.setItem('duckus_name', name);
    UI.loading(true, '방에 접속하는 중…');
    try {
      await Net.joinRoom(code);
      Net.toHost('hello', { uid: Net.uid, name, color: null });
      history.replaceState(null, '', '#room=' + code);
      $('#in-name2').value = name;
      this.keepAwake();
      setTimeout(() => UI.loading(false), 600);
    } catch (e) { this.err(e.message); }
  },

  copyLink() {
    const base = location.origin + location.pathname;
    const url = Net.code ? base + '#room=' + Net.code : base;
    const done = () => UI.toast('🔗 초대 링크를 복사했습니다!<br><span class="tiny dim">' + url + '</span>', 5000);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(() => prompt('아래 주소를 복사하세요', url));
    else prompt('아래 주소를 복사하세요', url);
  },

  /* ═══════════ 네트워크 수신 ═══════════ */
  wireNet() {
    Net.on('data', (m, from) => {
      if (Net.isHost && from !== 'self') return;      // 호스트는 Host.onMsg 에서 처리
      this.onServer(m);
    });
    Net.on('hostgone', () => this.handleHostGone());
  },

  /* ═══════════ 방장 교체 ═══════════ */
  async handleHostGone() {
    if (this._migrating || Net.isHost) return;
    this._migrating = true;
    UI.closeAllModals();

    // 로비였다면 그냥 종료 (복구할 게임 상태가 없음)
    if (G.phase === 'lobby' || G.phase === 'over' || !G.hostId) return this.migrationFailed('방장이 방을 닫았습니다.');

    const oldOffset = Net.clockOffset;
    const nextGen = (G.gen || 0) + 1;

    if (G.successor === G.myId && this.migState) {
      /* 내가 후계자 → 방장 인계 */
      UI.loading(true, '방장이 나갔습니다. 내가 방을 이어받는 중…');
      const okHost = await Net.promoteToHost(Net.code, nextGen);
      if (!okHost) {
        // 누가 먼저 차지했으면 클라이언트로 붙는다
        return this.reconnectAsClient(nextGen);
      }
      Host.importState(this.migState, G.myId, oldOffset);
      Host.init();
      Host.pushState(); Host.sendPrivateAll();
      Host.sys('👑 방장이 나가서 방을 이어받았습니다. 잠시 후 모두 다시 연결됩니다.');
      Net.isHost = true;
      this._migrating = false;
      UI.loading(false);
      UI.toast('👑 <b>당신이 새 방장이 되었습니다.</b> 이 탭을 켜 두세요.', 8000);
      return;
    }
    /* 그 외 → 새 방장에게 재접속 */
    return this.reconnectAsClient(nextGen);
  },

  async reconnectAsClient(fromGen) {
    UI.loading(true, '방장이 바뀌었습니다. 다시 연결하는 중…');
    const conn = await Net.rejoinAfterMigration(Net.code, fromGen);
    if (!conn) return this.migrationFailed('새 방장을 찾지 못했습니다.');
    // 이름은 보내지 않는다. 새 방장이 이미 갖고 있고, 여기서 덮어쓰면 로비에서 바꾼 이름이 날아간다.
    Net.toHost('hello', { uid: Net.uid });
    this._migrating = false;
    UI.loading(false);
    UI.toast('✅ 새 방장에게 다시 연결됐습니다.', 4000);
  },

  migrationFailed(reason) {
    this._migrating = false;
    UI.loading(false);
    UI.modal({ title:'연결 끊김', closable:false,
      body:`<div style="text-align:center;padding:14px">${reason}<br><span class="dim tiny">잠시 후 다시 시도하거나, 방장에게 새 링크를 받아 주세요.</span></div>`,
      footer:[
        h('button', { cls:'btn grow', onclick: () => { UI.closeModal(); this.handleHostGone(); } }, '다시 시도'),
        h('button', { cls:'btn primary grow', onclick: () => location.reload() }, '처음으로'),
      ] });
  },

  onServer(m) {
    switch (m.t) {
      case 'welcome': G.myId = m.yourId; G.hostId = m.hostId; Net.code = m.code; UI.loading(false); UI.show('game'); Render.resize(); UI.hintLobbyMenu(); break;
      case 'denied':  UI.loading(false); UI.show('home'); this.err(m.reason); Net.destroy(); break;
      case 'state':   this.onState(m); break;
      case 'snap':    this.onSnap(m); break;
      case 'private': this.onPrivate(m); break;
      case 'event':   this.onEvent(m); break;
      case 'msg':     Meeting.addMsg(m); break;
      case 'toast':   UI.toast(m.text, 4500); break;
      case 'privlog': Meeting.addMsg({ mylog: true, text: m.text }); G.privateLog.push(m.text); UI.toast(m.text, 6500); UI.renderRoleChip(); break;
      case 'voicepeers': this.voicePeers = m.map; this.connectVoice(); break;
      case 'killcine':
        UI.playKill({ killerColor: m.killer || 'black', victimColor: m.victim, asVictim: m.asVictim });
        break;
      case 'info':      this.infoCache[m.kind] = m; break;
      case 'successor': G.successor = m.id; break;
      case 'migstate':  this.migState = m.s; break;   // 후계자에게만 온다
      case 'ventalert': {                       // 조류관찰자에게만 도착
        Sfx.alert();
        UI.toast(`🔭 <b>${m.room}</b>에서 벤트 사용이 감지되었습니다!`, 5500);
        Meeting.addMsg({ mylog: true, text: `🔭 ${Trail.fmt(Trail.sec())} ${m.room}에서 벤트 감지` });
        break;
      }
      case 'visualtask': {                      // 근처에 있던 사람에게만 도착
        const p = G.players[m.pid];
        if (p) {
          UI.toast(`✨ ${p.name} 님이 <b>${{ asteroid:'까마귀 쫓기', shields:'울타리 점검', scan:'건강 검진' }[m.kind] || '시각 임무'}</b>를 수행했습니다 (양 확정)`, 5000);
          if (p.x !== undefined) Render.sparkleAt(p.x, p.y, '#8ef0b5');
        }
        break;
      }
    }
  },

  onState(m) {
    G.phase = m.phase; G.round = m.round; G.order = m.order; G.settings = m.settings;
    G.hostId = m.hostId; G.taskBar = m.taskBar; G.bodies = m.bodies;
    G.sabotage = m.sabotage; G.doors = m.doors; G.meeting = m.meeting; G.result = m.result;
    G.sabCdEnd = m.sabCdEnd || 0;
    G.gen = m.gen || 0;

    const seen = new Set();
    for (const p of m.players) {
      seen.add(p.id);
      const cur = G.players[p.id];
      // state 에는 좌표가 없다 (시야 밖 위치 노출 방지). 좌표는 snap 에서만 온다.
      if (!cur) G.players[p.id] = { ...p, x: EMERGENCY_BTN.wx, y: EMERGENCY_BTN.wy,
                                    rx: EMERGENCY_BTN.wx, ry: EMERGENCY_BTN.wy, dir: 1, moving: false, seen: false };
      else Object.assign(cur, { name:p.name, color:p.color, alive:p.alive, connected:p.connected, afk:p.afk });
    }
    for (const id in G.players) if (!seen.has(id)) delete G.players[id];
    G.me = G.players[G.myId];

    if (G.phase === 'lobby') {
      // 대기실 = 걸어다니는 맵. 옛 로비 화면은 ☰ 패널로 남는다.
      if (UI.screen !== 'game') { UI.show('game'); Render.resize(); Meeting.clearChat(); UI.hintLobbyMenu(); }
      $('#screen-game').classList.add('lobby-mode');
      $('#lobby-hud').classList.remove('hidden');
      $('#btn-chat').classList.remove('hidden');
      UI.renderLobby(m);
    }
    else if (G.phase === 'play') {
      if (UI.screen !== 'game') { UI.show('game'); Render.resize(); }
      $('#screen-game').classList.remove('lobby-mode');
      $('#lobby-hud').classList.add('hidden');
      $('#btn-chat').classList.remove('hidden');
      UI.closeLobbyPanel();
      UI.renderTaskBar(); UI.renderTaskList(); this.updateAlert();
    }
    else if (G.phase === 'meeting') {
      // 호스트는 G 를 로직과 공유하므로 prevPhase 로 판단할 수 없다. 실제 화면 상태로 판단.
      if (UI.screen !== 'meeting') Meeting.open(m); else Meeting.render(m);
    }
    else if (G.phase === 'over' && m.result) { if (UI.screen !== 'result') UI.showResult(m.result); }
  },

  onSnap(m) {
    // 스냅샷에 없는 사람 = 지금 내 시야 밖 (서버가 걸러냈다)
    const present = new Set();
    for (const [id, x, y, dir, flags, ventId, morph] of m.p) {
      present.add(id);
      const p = G.players[id]; if (!p) continue;
      p.dir = dir; p.moving = !!(flags & 1); p.alive = !!(flags & 2);
      p.ventId = ventId || null;
      p.morphId = morph || null;
      p.morphColor = morph ? G.players[morph]?.color : null;
      p.morphName  = morph ? G.players[morph]?.name  : null;
      if (id === G.myId) { p.seen = true; if (p.ventId) { p.x = x; p.y = y; } continue; }
      const reappeared = !p.seen;
      p.x = x; p.y = y; p.seen = true;
      if (reappeared || p.rx == null) { p.rx = x; p.ry = y; }   // 다시 보일 땐 보간 없이 스냅
    }
    for (const id in G.players) if (!present.has(id)) G.players[id].seen = false;
    G.trackPos = m.trk || null;          // 추적자 전용 (없으면 null)
  },

  onPrivate(m) {
    const first = G.myRole !== m.role;
    G.myRole = m.role; G.myTasks = m.tasks || [];
    G.killCdEnd = m.killCdEnd; G.abilityCdEnd = m.abilityCdEnd; G.abilityUses = m.abilityUses;
    G.emergencyLeft = m.emergencyLeft; G.shielded = m.shielded; G.infected = m.infected;
    G.eaten = m.eaten; G.ducksKnown = m.ducks || []; G.ghost = m.ghost;
    G.allRoles = m.allRoles;
    if (G.me) G.me.shielded = m.shielded;
    G.mySample = m.sample; G.dragging = m.dragging;      // 호스트가 권한 (로컬 추측 금지)
    G.guarding = m.guarding; G.trackEnd = m.trackEnd; G.trackName = m.trackName;
    // 유령이거나 영매면 게임 중에도 유령 채팅을 쓸 수 있다
    $('#btn-ghostchat').classList.toggle('hidden', !(G.ghost || m.role === 'medium'));
    UI.buildActionButtons(); UI.renderRoleChip(); UI.renderTaskList();
  },

  onEvent(m) {
    switch (m.type) {
      case 'start':
        UI.closeLobbyPanel(); UI.closePlayChat();
        $('#screen-game').classList.remove('lobby-mode');
        $('#lobby-hud').classList.add('hidden');
        UI.show('game'); Render.resize(); Meeting.clearChat(); Trail.reset(); G.privateLog = [];
        setTimeout(() => UI.revealRole(), 260);
        Sfx.quack();
        break;
      case 'kill':
        // 당사자에게는 killcine 이 따로 간다. 여기서는 주변 사람의 '기척'만 처리.
        if (m.victim !== G.myId && G.me && !G.ghost && Math.hypot(G.me.x - m.at.x, G.me.y - m.at.y) < 420) {
          Sfx.kill(); Render.shake = 9; Render.ringAt(m.at.x, m.at.y, '#ff4d5e', 110);
        }
        break;
      case 'shieldblock': Sfx.fixed(); break;
      case 'vent':                              // 소리만. 누가 탔는지는 오지 않는다
        if (G.me && m.at && Math.hypot(G.me.x - m.at.x, G.me.y - m.at.y) < 380) {
          Sfx.vent(); Render.puffAt(m.at.x, m.at.y);
        }
        break;
      case 'meeting': Sfx.bodyFound(); Render.shake = 12; break;   // 종이 울리면 화면이 덜컹
      case 'votestart': Sfx.alarm(); Meeting.render({ meeting: G.meeting }); break;
      case 'voted': Sfx.vote(); break;
      case 'ejectresult': UI.playEject(m); break;
      case 'resume':
        UI.closeAllModals(); UI.show('game'); Render.resize(); Trail.reset(); Meeting.myVote = null;
        UI.toast('라운드 ' + G.round + ' 시작', 2200);
        break;
      case 'sabotage': {
        Sfx.sabotage(); Render.shake = 8;
        for (const sp of (SAB_SPOTS[m.kind] || [])) Render.ringAt(sp.wx, sp.wy, '#ff4d5e', 120);
        const nm = { lights:'💡 정전', comms:'📡 방송 두절', reactor:'🌀 물레방아 폭주', oxygen:'💧 물탱크 누수' }[m.kind];
        UI.toast(`<b style="color:var(--bad)">${nm}</b> 사보타주 발생!`, 4500);
        this.updateAlert();
        break;
      }
      case 'sabfixed': Sfx.fixed(); UI.toast('✅ 사보타주가 복구되었습니다.', 2600); this.updateAlert(); UI.closeAllModals(); break;
      case 'doors':
        Sfx.alarm();
        if (roomIdAt(G.me?.x, G.me?.y) === m.room) { UI.toast('🚪 문이 잠겼습니다!', 2600); Render.shake = 7; }
        break;
      case 'tolobby': UI.closeAllModals(); UI.show('game'); Render.resize(); Meeting.clearChat(); G.myRole = null; break;
      case 'over': UI.showResult(m.result); break;
    }
  },

  updateAlert() {
    if (!G.sabotage) { UI.setAlert(null); return; }
    const S = G.sabotage;
    const nm = { lights:'💡 정전 — 발전기실에서 복구', comms:'📡 방송 두절 — 방송실에서 복구',
                 reactor:'🌀 물레방아 폭주 — 2명이 동시에!', oxygen:'💧 물탱크 누수 — 2곳에 코드 입력' }[S.kind];
    if (S.endsAt) {
      const left = Math.max(0, Math.ceil((S.endsAt - now()) / 1000));
      UI.setAlert(`${nm} · <span style="font-variant-numeric:tabular-nums">${left}s</span>`);
    } else UI.setAlert(nm);
  },

  /* ═══════════ 입력 ═══════════ */
  bindInput() {
    const stickEl = $('#stick'), knob = $('#stick-knob');
    const canvas = $('#game-canvas');
    const RAD = 52;

    const startStick = (x, y, id) => {
      this.stick.active = true; this.stick.id = id; this.stick.ox = x; this.stick.oy = y;
      stickEl.style.left = (x - 66) + 'px'; stickEl.style.top = (y - 66) + 'px';
      stickEl.style.bottom = 'auto'; stickEl.style.opacity = '1';
    };
    const moveStick = (x, y) => {
      let dx = x - this.stick.ox, dy = y - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > RAD) { dx = dx / d * RAD; dy = dy / d * RAD; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.stick.dx = dx / RAD; this.stick.dy = dy / RAD;
    };
    const endStick = () => {
      this.stick.active = false; this.stick.id = null; this.stick.dx = 0; this.stick.dy = 0;
      knob.style.transform = 'translate(0,0)';
      stickEl.style.left = ''; stickEl.style.top = ''; stickEl.style.bottom = '';
    };

    // 화면 왼쪽 아래 넓은 영역 어디를 눌러도 조이스틱 발생 (모바일 조작감)
    const zoneOK = (x, y) => x < window.innerWidth * 0.55 && y > window.innerHeight * 0.30;
    canvas.addEventListener('pointerdown', e => {
      if (UI.screen !== 'game' || UI.hasModal()) return;
      if (!zoneOK(e.clientX, e.clientY)) return;
      e.preventDefault(); startStick(e.clientX, e.clientY, e.pointerId);
    });
    stickEl.addEventListener('pointerdown', e => { e.preventDefault(); startStick(e.clientX, e.clientY, e.pointerId); });
    window.addEventListener('pointermove', e => { if (this.stick.active && e.pointerId === this.stick.id) { e.preventDefault(); moveStick(e.clientX, e.clientY); } }, { passive: false });
    window.addEventListener('pointerup', e => { if (e.pointerId === this.stick.id) endStick(); });
    window.addEventListener('pointercancel', e => { if (e.pointerId === this.stick.id) endStick(); });

    // 키보드
    const K = this.input.keys;
    window.addEventListener('keydown', e => {
      if (document.activeElement?.tagName === 'INPUT') return;
      K[e.key.toLowerCase()] = true;
      if (UI.screen !== 'game') return;
      const k = e.key.toLowerCase();
      if (k === 'e' || k === ' ') { e.preventDefault(); this.doUse(); }
      if (k === 'q') this.doKill();
      if (k === 'r') this.doReport();
      if (k === 'f') this.doVent();
      if (k === 'g') this.doAbility();
      if (k === 'm') UI.openMap('map');
      if (k === 'escape') UI.closeModal();
    });
    window.addEventListener('keyup', e => { K[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { for (const k in K) K[k] = false; endStick(); });
  },

  readInput() {
    // 임무·수리 창이 열려 있는 동안에는 움직일 수 없다 (키보드로 몰래 도망 방지)
    if (UI.hasModal()) return { dx: 0, dy: 0 };
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return { dx: 0, dy: 0 };
    let dx = this.stick.dx, dy = this.stick.dy;
    const K = this.input.keys;
    if (K['arrowleft'] || K['a']) dx -= 1;
    if (K['arrowright'] || K['d']) dx += 1;
    if (K['arrowup'] || K['w']) dy -= 1;
    if (K['arrowdown'] || K['s']) dy += 1;
    const d = Math.hypot(dx, dy);
    if (d > 1) { dx /= d; dy /= d; }
    return { dx, dy };
  },

  /* ═══════════ 루프 ═══════════ */
  loop(t) {
    requestAnimationFrame(tt => this.loop(tt));
    const dt = Math.min(50, t - this.lastT || 16.7); this.lastT = t;
    if (UI.screen !== 'game' && UI.screen !== 'meeting') return;

    const me = G.players[G.myId];
    if (!me) return;
    G.me = me;

    if (UI.screen === 'game' && (G.phase === 'play' || G.phase === 'lobby')) {
      const inLobby = G.phase === 'lobby';
      this.stepMovement(me, dt);
      if (!inLobby) this.updateHud();
      // 원격 보간
      for (const id in G.players) {
        const p = G.players[id]; if (id === G.myId) continue;
        if (p.rx == null) { p.rx = p.x; p.ry = p.y; }
        const k = Math.min(1, dt / 60);
        p.rx += (p.x - p.rx) * k * 3.2; p.ry += (p.y - p.ry) * k * 3.2;
      }
      this.render(me);
      if (inLobby) return;
      // 동선 기록
      Trail.track(me, this.visibleOthers(me));
      if (Voice.enabled) {
        const pos = {}; for (const id in G.players) { const q = G.players[id]; if (this.voicePeers[id]) pos[this.voicePeers[id]] = { x:q.x, y:q.y }; }
        const deadSet = new Set(Object.entries(this.voicePeers).filter(([pid]) => !G.players[pid]?.alive).map(([, peer]) => peer));
        Voice.update({ x: me.x, y: me.y }, pos, false, deadSet, !!G.ghost);
      }
    } else if (UI.screen === 'meeting' && G.meeting) {
      Meeting.updateTimer(G.meeting);
      if (Voice.enabled) Voice.update({ x:0, y:0 }, {}, true, new Set(Object.entries(this.voicePeers).filter(([pid]) => !G.players[pid]?.alive).map(([, p]) => p)), !!G.ghost);
    }
    if (G.sabotage?.endsAt) this.updateAlert();
  },

  stepMovement(me, dt) {
    if (me.ventId) { me.moving = false; return; }
    const { dx, dy } = this.readInput();
    const ghost = !me.alive;
    const spd = G.settings.playerSpeed * (ghost ? 1.35 : 1) * (dt / 16.67);
    let moving = false;
    if (dx || dy) {
      moving = true;
      const nx = me.x + dx * spd, ny = me.y + dy * spd;
      if (ghost) { me.x = clamp(nx, 20, WORLD_W - 20); me.y = clamp(ny, 20, WORLD_H - 20); }
      else {
        const from = roomIdAt(me.x, me.y);
        const r = moveWithCollision(me.x, me.y, dx * spd, dy * spd);
        const to = roomIdAt(r.x, r.y);
        const blocked = from !== to && ((from && G.doors[from] > now()) || (to && G.doors[to] > now()));
        if (!blocked) { me.x = r.x; me.y = r.y; }
      }
      if (dx) me.dir = dx > 0 ? 1 : -1;
    }
    me.moving = moving;
    if (now() - this.lastPosSent > 66) {
      this.lastPosSent = now();
      Net.toHost('pos', { x: Math.round(me.x), y: Math.round(me.y), d: me.dir, mv: moving });
    }
  },

  visibleOthers(me) {
    if (G.ghost) return [];
    const R = this.visionR();
    const out = [];
    for (const id in G.players) {
      const p = G.players[id];
      if (id === G.myId || !p.alive || p.ventId || !p.seen) continue;   // 낡은 좌표 제외
      if (Math.hypot(p.x - me.x, p.y - me.y) > R) continue;
      if (lineBlocked(me.x, me.y, p.x, p.y)) continue;
      out.push(p);
    }
    return out;
  },

  visionR() {
    const r = roleInfo(G.myRole);
    if (!G.me?.alive) return 900;
    let R = r.faction === F.DUCK ? G.settings.visionDuck : G.settings.visionCrew;
    if (G.sabotage?.kind === 'lights' && r.faction !== F.DUCK) R = G.settings.visionDark;
    return R;
  },

  myTaskSpots() {
    const out = [];
    G.myTasks.forEach(t => {
      if (t.step >= t.spots.length) return;
      const sp = spotById(t.spots[t.step]);
      if (sp) out.push({ ...sp, next: true, tid: t.tid });
    });
    return out;
  },

  /** 화면 밖 목표를 가장자리 화살표로 안내. 처음 하는 사람이 방을 못 찾는 문제 해결. */
  buildGuides(me) {
    if (!G.guideOn || !me.alive) return [];
    const out = [];
    // 1) 사보타주 복구 지점이 최우선
    if (G.sabotage && G.sabotage.kind !== 'doors') {
      const icon = { lights:'💡', comms:'📡', reactor:'☢️', oxygen:'🫁' }[G.sabotage.kind] || '⚠️';
      for (const s of (SAB_SPOTS[G.sabotage.kind] || [])) {
        const rm = ROOMS.find(r => r.id === s.room);
        out.push({ wx: s.wx, wy: s.wy, color:'#ff5f6d', icon, label: rm?.name || '복구' });
      }
      return out;
    }
    // 2) 추적 중인 대상 (추적자)
    if (G.trackPos && now() < (G.trackEnd || 0)) {
      out.push({ wx: G.trackPos[0], wy: G.trackPos[1],
                 color: colorOf(G.trackPos[2]).hex, icon:'📡', label: G.trackName || '추적' });
    }
    // 3) 내 다음 임무 (가까운 순 3개)
    if (G.sabotage?.kind === 'comms') return out;
    const spots = this.myTaskSpots()
      .map(s => ({ ...s, d: Math.hypot(s.wx - me.x, s.wy - me.y) }))
      .sort((a, b) => a.d - b.d).slice(0, 3);
    for (const s of spots) {
      const rm = ROOMS.find(r => r.id === s.room);
      out.push({ wx: s.wx, wy: s.wy, color:'#ffd23d', icon:'📋', label: rm?.name || '임무' });
    }
    return out;
  },

  render(me) {
    const others = Object.values(G.players);
    Render.draw({
      guides: this.buildGuides(me),
      me: { ...me, x: me.x, y: me.y },
      others: others.map(p => p.id === G.myId ? p : { ...p, x: p.rx ?? p.x, y: p.ry ?? p.y }),
      bodies: G.bodies, doors: G.doors, sabotage: G.sabotage,
      visionR: this.visionR(), ghost: !!G.ghost, lobby: G.phase === 'lobby',
      myTaskSpots: G.sabotage?.kind === 'comms' ? [] : this.myTaskSpots(),
      canVent: roleInfo(G.myRole).canVent && me.alive,
      duckMates: G.ducksKnown,
    });
  },

  /* ═══════════ HUD 갱신 ═══════════ */
  updateHud() {
    const me = G.me; if (!me) return;
    const r = roleInfo(G.myRole);
    const B = UI.btn || {};

    /* 사용 버튼 대상 판정 */
    const target = this.findUseTarget(me);
    this.useTarget = target;
    const useBtn = $('#btn-use');
    useBtn.querySelector('.ic').textContent = target ? target.icon : '✋';
    useBtn.querySelector('span:nth-child(2)').textContent = target ? target.label : '사용';
    useBtn.disabled = !target;

    /* 신고 */
    if (B.report) {
      const body = G.bodies.find(b => Math.hypot(me.x - b.x, me.y - b.y) < 110);
      B.report.disabled = !body || !me.alive || !!me.ventId;
    }
    /* 살해 */
    if (B.kill) {
      const range = G.settings.killRange * (r.killRangeMul || 1);
      this.killTarget = this.nearestPlayer(me, range);
      const ready = now() >= G.killCdEnd;
      B.kill.disabled = !this.killTarget || !ready || !me.alive || !!me.ventId;
      UI.cooldown(B.kill, G.killCdEnd);
      B.kill.style.borderColor = this.killTarget && ready ? colorOf(this.killTarget.color).hex : '';
    }
    /* 벤트 */
    if (B.vent) {
      const near = VENTS.find(v => Math.hypot(me.x - v.wx, me.y - v.wy) < 78);
      B.vent.disabled = !me.alive || (!me.ventId && !near);
      B.vent.querySelector('span:nth-child(2)').textContent = me.ventId ? '나가기' : '벤트';
    }
    /* 사보타주 */
    if (B.sab) { B.sab.disabled = !me.alive; UI.cooldown(B.sab, G.sabCdEnd); }
    /* 능력 */
    if (B.abil) {
      const st = this.abilityState(me, r);
      B.abil.disabled = !st.ok;
      B.abil.querySelector('span:nth-child(2)').textContent = st.label;
      UI.cooldown(B.abil, G.abilityCdEnd, r.uses ? G.abilityUses : null);
    }
  },

  abilityState(me, r) {
    if (!me.alive || me.ventId) return { ok:false, label: ABILITY_LABEL[r.ability] };
    const cdOk = now() >= G.abilityCdEnd;
    const useOk = !r.uses || G.abilityUses > 0;
    switch (r.ability) {
      case 'investigate': return { ok: cdOk && !!this.nearestPlayer(me, 130), label:'조사' };
      case 'autopsy':     return { ok: !!G.bodies.find(b => Math.hypot(me.x - b.x, me.y - b.y) < 110), label:'부검' };
      case 'remotefix':   return { ok: useOk && !!G.sabotage && G.sabotage.kind !== 'doors', label:`수리${G.abilityUses ? '' : '✕'}` };
      case 'shoot':       return { ok: cdOk && useOk && !!this.nearestPlayer(me, 150), label:'사격' };
      case 'shield':      return { ok: useOk && !!this.nearestPlayer(me, 130), label:'방패' };
      case 'morph':       return { ok: !!this.nearestPlayer(me, 130) || (G.mySample && cdOk), label: G.mySample ? '변신' : '털 채취' };
      case 'drag':        return { ok: !!G.bodies.find(b => Math.hypot(me.x - b.x, me.y - b.y) < 100) || !!G.dragging, label: G.dragging ? '놓기' : '끌기' };
      case 'eat':         return { ok: !!G.bodies.find(b => Math.hypot(me.x - b.x, me.y - b.y) < 100), label:`먹기 ${G.eaten}/3` };
      case 'infect':      return { ok: cdOk && !!this.nearestPlayer(me, 120), label:'감염' };
      case 'track':       return { ok: cdOk && !!this.nearestPlayer(me, 140), label:'추적' };
      case 'guard':       return { ok: useOk && !!this.nearestPlayer(me, 140), label: G.guarding ? '경호중' : '경호' };
      case 'guess':       return { ok:false, label:'회의중' };
      default:            return { ok:false, label:'능력' };
    }
  },

  nearestPlayer(me, range) {
    let best = null, bd = range;
    for (const id in G.players) {
      const p = G.players[id];
      if (id === G.myId || !p.alive || p.ventId) continue;
      // ⚠️ 지금 스냅샷에 없는 사람(=시야 밖)은 좌표가 마지막으로 본 자리에 멈춰 있다.
      //    이걸 거르지 않으면 이미 떠난 사람이 '가장 가까운 대상'으로 잡혀
      //    방장이 "너무 멀다"로 거부한다 → 옆에 다른 양이 있으면 살해가 안 먹던 원인.
      if (!p.seen) continue;
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  },

  findUseTarget(me) {
    // 벤트 안에서는 아무것도 만질 수 없다 (숨어 있는데 임무가 되면 앞뒤가 안 맞는다)
    if (me.ventId) return null;
    // 1) 사보타주 수리
    if (G.sabotage && G.sabotage.kind !== 'doors') {
      for (const s of (SAB_SPOTS[G.sabotage.kind] || []))
        if (Math.hypot(me.x - s.wx, me.y - s.wy) < 100)
          return { kind:'repair', icon:'🛠️', label:'수리', data: G.sabotage.kind };
    }
    // 2) 내 임무
    for (const t of G.myTasks) {
      if (t.step >= t.spots.length) continue;
      const sp = spotById(t.spots[t.step]);
      if (sp && Math.hypot(me.x - sp.wx, me.y - sp.wy) < 78)
        return { kind:'task', icon:'📋', label:'임무', data:{ t, sp } };
    }
    // 3) 긴급 버튼
    if (me.alive && Math.hypot(me.x - EMERGENCY_BTN.wx, me.y - EMERGENCY_BTN.wy) < 100)
      return { kind:'emergency', icon:'🔔', label:'긴급회의' };
    // 4) 패널
    if (Math.hypot(me.x - ADMIN_TABLE.wx, me.y - ADMIN_TABLE.wy) < 100) return { kind:'admin', icon:'📊', label:'사무실' };
    if (Math.hypot(me.x - VITALS_PANEL.wx, me.y - VITALS_PANEL.wy) < 100) return { kind:'vitals', icon:'💓', label:'생체신호' };
    if (Math.hypot(me.x - CAMERA_PANEL.wx, me.y - CAMERA_PANEL.wy) < 100) return { kind:'cams', icon:'📹', label:'감시' };
    return null;
  },

  /* ═══════════ 액션 ═══════════ */
  doUse() {
    const t = this.useTarget; if (!t) return;
    Sfx.click();
    if (t.kind === 'task') UI.openTask(t.data.t, t.data.sp);
    else if (t.kind === 'repair') UI.openRepair(t.data);
    else if (t.kind === 'admin') UI.openMap('admin');
    else if (t.kind === 'vitals') UI.openVitals();
    else if (t.kind === 'cams') UI.openMap('cams');
    else if (t.kind === 'emergency') {
      if (G.emergencyLeft <= 0) return UI.toast('긴급 회의를 모두 사용했습니다.');
      if (G.sabotage?.endsAt) return UI.toast('치명적 사보타주 중에는 회의를 열 수 없습니다.');
      UI.modal({ title:'🔔 긴급 회의', body:`<div style="text-align:center;padding:10px">모두를 헛간 앞마당으로 소집합니다.<br><span class="dim tiny">남은 횟수 ${G.emergencyLeft}회</span></div>`,
        footer:[ h('button', { cls:'btn ghost grow', onclick: () => UI.closeModal() }, '취소'),
                 h('button', { cls:'btn danger grow', onclick: () => { Net.toHost('emergency', {}); UI.closeModal(); } }, '소집하기') ] });
    }
  },

  doReport() {
    const me = G.me; if (!me?.alive || me.ventId) return;
    const b = G.bodies.find(b => Math.hypot(me.x - b.x, me.y - b.y) < 110);
    if (!b) return;
    Sfx.bodyFound();
    Net.toHost('report', { body: b.id });
  },

  doKill() {
    const me = G.me;
    if (!me?.alive || me.ventId || now() < G.killCdEnd) return;
    // 버튼을 그릴 때 잡아둔 대상은 최대 한 프레임 낡았다. 누른 순간 다시 고른다.
    const r = roleInfo(G.myRole);
    const tgt = this.nearestPlayer(me, G.settings.killRange * (r.killRangeMul || 1)) || this.killTarget;
    if (!tgt) return;
    // 내 위치를 66ms 마다 보내므로 방장이 아는 내 위치는 최대 66ms + 왕복지연만큼 낡아 있다.
    // 속도 3.35px/프레임이면 그 사이 40px 넘게 어긋나 사거리 밖으로 판정되어 "한 번에 안 먹는다".
    // → 살해 직전에 현재 위치를 먼저 보낸다. 같은 채널이라 순서가 보장된다.
    Net.toHost('pos', { x: Math.round(me.x), y: Math.round(me.y), d: me.dir, mv: me.moving });
    this.lastPosSent = now();
    Net.toHost('kill', { target: tgt.id });
    // 판정은 방장이 하므로 결과가 오기까지 왕복지연만큼 빈다.
    // 그 사이 아무 반응이 없으면 "안 눌렸다"고 느껴 또 누르게 된다 → 눌린 즉시 손끝에 알려 준다.
    try { navigator.vibrate?.(35); } catch {}
  },

  doVent() {
    const me = G.me; if (!me?.alive) return;
    if (me.ventId) {
      const cur = VENTS.find(v => v.id === me.ventId);
      const nb = ventNeighbors(me.ventId);
      const root = h('div', { cls:'col' });
      nb.forEach(v => root.appendChild(h('button', { cls:'btn', onclick: () => {
        Net.toHost('vent', { vent: v.id }); Sfx.vent(); UI.closeModal(); } },
        `🕳️ ${ROOMS.find(r => r.id === v.room)?.name}로 이동`)));
      root.appendChild(h('button', { cls:'btn primary', onclick: () => {
        Net.toHost('vent', { vent: null }); Sfx.vent(); UI.closeModal(); } }, '⬆️ 벤트에서 나가기'));
      UI.modal({ title:`🕳️ ${ROOMS.find(r => r.id === cur?.room)?.name} 벤트`, body: root });
    } else {
      const v = VENTS.find(v => Math.hypot(me.x - v.wx, me.y - v.wy) < 78);
      if (!v) return;
      Net.toHost('vent', { vent: v.id }); Sfx.vent();
    }
  },

  doAbility() {
    const me = G.me, r = roleInfo(G.myRole); if (!me || !r.ability || me.ventId) return;
    switch (r.ability) {
      case 'investigate': case 'shoot': case 'shield': case 'infect': case 'track': case 'guard': {
        const range = r.ability === 'shoot' ? 150 : r.ability === 'infect' ? 120
                    : (r.ability === 'track' || r.ability === 'guard') ? 140 : 130;
        const tgt = this.nearestPlayer(me, range); if (!tgt) return;
        if (r.ability === 'shoot') {
          UI.modal({ title:'⭐ 사격', body:`<div style="text-align:center;padding:10px"><b>${tgt.name}</b> 님을 사격합니다.<br><span class="dim tiny">늑대·중립킬러가 아니면 당신이 죽습니다.</span></div>`,
            footer:[h('button', { cls:'btn ghost grow', onclick:() => UI.closeModal() }, '취소'),
                    h('button', { cls:'btn danger grow', onclick:() => { Net.toHost('ability', { kind:'shoot', target: tgt.id }); UI.closeModal(); } }, '발사')] });
        } else { Net.toHost('ability', { kind: r.ability, target: tgt.id }); Sfx.click(); }
        break;
      }
      case 'autopsy': case 'eat': {
        const b = G.bodies.find(b => Math.hypot(me.x - b.x, me.y - b.y) < 110); if (!b) return;
        Net.toHost('ability', { kind: r.ability, body: b.id }); Sfx.click(); break;
      }
      case 'remotefix': Net.toHost('ability', { kind:'remotefix' }); break;
      case 'drag':      Net.toHost('ability', { kind:'drag' }); break;
      case 'morph': {
        const tgt = this.nearestPlayer(me, 130);
        if (G.mySample) Net.toHost('ability', { kind:'morph', sample:false });
        else if (tgt)   Net.toHost('ability', { kind:'morph', sample:true, target: tgt.id });
        break;
      }
    }
  },

  completeStep(tid) { Net.toHost('taskstep', { tid }); },
  sabFix(d) { Net.toHost('sabfix', d); },
  sabotage(kind, room) { Net.toHost('sabotage', { kind, room }); },
  setColor(c) { Net.toHost('setColor', { color: c }); },
  setSetting(k, v) { Net.toHost('settings', { s: { [k]: v } }); },
  setRoleWeight(k, v) { const w = { ...G.settings.roleWeights, [k]: v }; Net.toHost('settings', { s: { roleWeights: w } }); },
  start() {
    if (Viewport.wantsImmersive && !Viewport.userExited) Viewport.enter();   // 게임 시작 순간이 전체화면의 최적 타이밍
    Net.toHost('start', {});
  },

  /* ═══════════ 음성 ═══════════ */
  /** 내가 음성을 켰다고 알린다. 켤 때 한 번만 호출할 것.
   *  (connectVoice 안에서 부르면 voicepeers 수신 → 재알림 → 재브로드캐스트 무한루프) */
  announceVoice() { Net.toHost('voiceon', { peerId: Net.peer?.id }); },

  connectVoice() {
    if (!Voice.enabled) return;
    for (const pid in this.voicePeers) {
      if (pid === G.myId) continue;
      Voice.callPeer(this.voicePeers[pid]);
    }
  },
  buildVoiceBtn() {
    if ($('#btn-talk')) return;
    const b = h('button', { cls:'abtn small', id:'btn-talk',
      style:{ background:'radial-gradient(circle at 40% 30%,#2ea44f,#14532d)', borderColor:'#5fe08a' } },
      h('span', { cls:'ic' }, '🎙️'), h('span', {}, '말하기'));
    const on = e => { e.preventDefault(); Voice.setTalking(true); b.style.filter = 'brightness(1.5)'; };
    const off = () => { Voice.setTalking(false); b.style.filter = ''; };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
    $('#actrow2').appendChild(b);
  },
};

/* ═══════════ 시작 ═══════════ */
window.addEventListener('DOMContentLoaded', () => Game.boot());
