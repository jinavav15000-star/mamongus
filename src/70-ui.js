/* ============================================================================
 *  덕몽어스 · UI (화면 · 로비 · HUD · 모달)
 * ==========================================================================*/
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const SETTING_DEFS = [
  { g:'인원 구성' },
  { k:'duckCount',   label:'오리 수',          min:1, max:4,  step:1 },
  { k:'neutralCount',label:'중립 수',          min:0, max:3,  step:1 },
  { g:'전투' },
  { k:'killCd',      label:'킬 쿨다운',        min:10, max:60, step:5, unit:'초' },
  { k:'killRange',   label:'킬 사거리',        min:60, max:170, step:10 },
  { k:'playerSpeed', label:'이동 속도',        min:2,  max:6,  step:0.25, fmt:v => v.toFixed(2) },
  { g:'시야' },
  { k:'visionCrew',  label:'거위 시야',        min:200, max:620, step:20 },
  { k:'visionDuck',  label:'오리 시야',        min:200, max:720, step:20 },
  { k:'visionDark',  label:'정전 시 시야',     min:80,  max:300, step:10 },
  { g:'회의' },
  { k:'emergencies', label:'긴급회의 횟수',    min:0, max:5, step:1, unit:'회' },
  { k:'discussSec',  label:'토론 시간',        min:15, max:180, step:15, unit:'초' },
  { k:'voteSec',     label:'투표 시간',        min:15, max:180, step:15, unit:'초' },
  { k:'confirmEject',label:'추방 시 직업 공개', bool:true },
  { k:'anonVotes',   label:'익명 투표',        bool:true },
  { k:'showKiller',  label:'죽을 때 범인 보임', bool:true },
  { g:'임무' },
  { k:'taskCommon',  label:'공통 임무',        min:0, max:2, step:1, unit:'개' },
  { k:'taskShort',   label:'짧은 임무',        min:1, max:8, step:1, unit:'개' },
  { k:'taskLong',    label:'긴 임무',          min:0, max:3, step:1, unit:'개' },
  { k:'visualTasks', label:'시각 임무 표시',   bool:true },
  { k:'ghostTasks',  label:'유령도 임무 수행', bool:true },
  { g:'사보타주' },
  { k:'sabotageCd',  label:'사보타주 쿨다운',  min:10, max:60, step:5, unit:'초' },
  { k:'reactorSec',  label:'리액터 제한시간',  min:20, max:90, step:5, unit:'초' },
  { k:'oxygenSec',   label:'산소 제한시간',    min:20, max:90, step:5, unit:'초' },
];

const UI = {
  screen: 'home',
  modalStack: [],

  show(name) {
    this.screen = name;
    ['home','lobby','game','meeting','eject','result'].forEach(s =>
      $('#screen-' + s).classList.toggle('hidden', s !== name));
  },

  loading(on, text) {
    $('#loading').classList.toggle('hidden', !on);
    if (text) $('#loading-text').textContent = text;
  },

  toast(text, ms = 3400) {
    const el = h('div', { cls:'toast', html: text });
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = 0; setTimeout(() => el.remove(), 320); }, ms);
  },

  /* ---------------- 모달 ---------------- */
  modal({ title, body, footer, onClose, closable = true, cls = '' }) {
    const box = h('div', { cls:'modal-box ' + cls });
    const hd = h('div', { cls:'modal-hd' }, h('h2', {}, title || ''));
    if (closable) hd.appendChild(h('button', { cls:'x', onclick: () => this.closeModal() }, '✕'));
    const bd = h('div', { cls:'modal-bd' });
    if (typeof body === 'string') bd.innerHTML = body; else if (body) bd.appendChild(body);
    box.append(hd, bd);
    if (footer) { const ft = h('div', { cls:'modal-ft' }); footer.forEach(f => ft.appendChild(f)); box.appendChild(ft); }
    const wrap = h('div', { cls:'modal' }, box);
    wrap._onClose = onClose;
    if (closable) wrap.addEventListener('click', e => { if (e.target === wrap) this.closeModal(); });
    $('#modal-root').appendChild(wrap);
    this.modalStack.push(wrap);
    return { wrap, box, bd, hd };
  },
  closeModal() {
    const m = this.modalStack.pop();
    if (!m) return;
    const bd = m.querySelector('.modal-bd');
    // 미니게임 rAF 루프가 계속 돌지 않도록 본문 안의 모든 _cleanup 을 호출한다
    if (bd) {
      if (bd._cleanup) bd._cleanup();
      for (const c of bd.children) if (c._cleanup) c._cleanup();
    }
    m._onClose?.();
    m.remove();
  },
  closeAllModals() { while (this.modalStack.length) this.closeModal(); },
  hasModal() { return this.modalStack.length > 0; },

  /* ---------------- 로비 ---------------- */
  renderColors(players, myColor) {
    const grid = $('#colorgrid'); grid.innerHTML = '';
    const taken = new Set(players.filter(p => p.id !== G.myId).map(p => p.color));
    COLORS.forEach(c => {
      const b = h('button', {
        cls: 'swatch' + (c.id === myColor ? ' sel' : '') + (taken.has(c.id) ? ' taken' : ''),
        style: { background: c.hex }, title: c.name,
        onclick: () => Game.setColor(c.id),
      });
      grid.appendChild(b);
    });
  },

  renderLobby(st) {
    $('#lobby-code').textContent = Net.code || '----';
    $('#tab-count').textContent = st.players.length;
    const list = $('#plist'); list.innerHTML = '';
    st.players.forEach(p => {
      const c = colorOf(p.color);
      const mine = p.id === G.myId;
      list.appendChild(h('div', { cls:'pcard' + (mine ? ' me' : '') },
        h('div', { cls:'pdot', style:{ background: c.hex } }),
        h('div', { cls:'grow', style:{ minWidth:0 } },
          h('div', { cls:'pname' }, p.name),
          h('div', { cls:'tiny dim' }, mine ? c.name + ' · 나' : c.name)),
        p.id === st.hostId ? h('span', { cls:'hostbadge' }, '방장') : null,
        !p.connected ? h('span', { cls:'tiny', style:{color:'var(--bad)'} }, '끊김') : null,
      ));
    });
    this.renderColors(st.players, st.players.find(p => p.id === G.myId)?.color);

    const foot = $('#lobby-foot'); foot.innerHTML = '';
    const isHost = G.myId === st.hostId;
    if (isHost) {
      const n = st.players.filter(p => p.connected).length;
      const btn = h('button', { cls:'btn primary', style:{ width:'100%', padding:'17px', fontSize:'17px' },
        onclick: () => Game.start() }, n < 4 ? `게임 시작 (${n}/4명 필요)` : `🎮 게임 시작 (${n}명)`);
      btn.disabled = n < 4;
      foot.appendChild(btn);
      foot.appendChild(h('div', { cls:'tiny dim', style:{ textAlign:'center', marginTop:'8px' } },
        '오리 ' + st.settings.duckCount + '마리 · 중립 ' + st.settings.neutralCount + '명 · 나머지 거위'));
      foot.appendChild(h('div', { cls:'tiny', style:{ textAlign:'center', marginTop:'6px', color:'var(--warn)' } },
        '⚠️ 방장이 다른 앱으로 넘어가면 모두의 화면이 잠시 멈춥니다. 나가면 다음 사람이 자동으로 이어받습니다.'));
    } else {
      foot.appendChild(h('div', { cls:'card', style:{ textAlign:'center' } },
        h('div', { cls:'dim' }, '방장이 시작하기를 기다리는 중…')));
    }
    if (this.settingsDirty !== JSON.stringify(st.settings) || !$('#settings-body').children.length) {
      this.settingsDirty = JSON.stringify(st.settings);
      this.renderSettings(st, isHost);
      this.renderRoleWeights(st, isHost);
    }
  },

  renderSettings(st, isHost) {
    const body = $('#settings-body'); body.innerHTML = '';
    if (!isHost) body.appendChild(h('div', { cls:'tiny dim', style:{ marginBottom:'10px' } }, '방장만 변경할 수 있습니다.'));
    const grid = h('div', { cls:'setgrid' });
    SETTING_DEFS.forEach(d => {
      // 그룹 제목은 한 줄 전체를 차지한다. 여기서 셀을 하나라도 더 넣으면
      // 이후 모든 라벨·컨트롤 짝이 한 칸씩 밀린다.
      if (d.g) { grid.appendChild(h('div', { cls:'tiny setgroup', style:{ gridColumn:'1 / -1', color:'var(--acc)', fontWeight:800, marginTop:'6px' } }, d.g)); return; }
      grid.appendChild(h('div', { cls:'lbl' }, d.label));
      if (d.bool) {
        const b = h('button', { cls:'btn small' + (st.settings[d.k] ? ' primary' : ' ghost'),
          onclick: () => isHost && Game.setSetting(d.k, !st.settings[d.k]) }, st.settings[d.k] ? '켬' : '끔');
        b.disabled = !isHost; grid.appendChild(b);
      } else {
        const v = h('div', { cls:'v' }, (d.fmt ? d.fmt(st.settings[d.k]) : st.settings[d.k]) + (d.unit || ''));
        const dec = h('button', { onclick: () => isHost && Game.setSetting(d.k, Math.max(d.min, +(st.settings[d.k] - d.step).toFixed(2))) }, '−');
        const inc = h('button', { onclick: () => isHost && Game.setSetting(d.k, Math.min(d.max, +(st.settings[d.k] + d.step).toFixed(2))) }, '+');
        dec.disabled = !isHost; inc.disabled = !isHost;
        grid.appendChild(h('div', { cls:'stepper' }, dec, v, inc));
      }
    });
    body.appendChild(grid);
    if (isHost) body.appendChild(h('button', { cls:'btn ghost small', style:{ marginTop:'12px', width:'100%' },
      onclick: () => { Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => { if (k !== 'roleWeights') Game.setSetting(k, v); }); } }, '기본값으로 되돌리기'));
  },

  renderRoleWeights(st, isHost) {
    const body = $('#roles-body'); body.innerHTML = '';
    const groups = [['거위 진영', GOOSE_ROLES, 'var(--goose)'], ['오리 진영', DUCK_ROLES, 'var(--duck)'], ['중립', NEUT_ROLES, 'var(--neut)']];
    groups.forEach(([gname, keys, col]) => {
      body.appendChild(h('div', { style:{ color:col, fontWeight:800, fontSize:'13px', margin:'12px 0 6px' } }, gname));
      keys.forEach(k => {
        const r = ROLES[k];
        const sel = h('div', { cls:'wsel' });
        ['끔','가끔','자주'].forEach((lbl, i) => {
          const b = h('button', { cls: (st.settings.roleWeights[k] || 0) === i ? 'on' : '',
            onclick: () => isHost && Game.setRoleWeight(k, i) }, lbl);
          b.disabled = !isHost; sel.appendChild(b);
        });
        body.appendChild(h('div', { cls:'roleitem' },
          h('div', { cls:'ic' }, r.icon),
          h('div', { cls:'grow', style:{ minWidth:0 } }, h('div', { cls:'nm' }, r.name), h('div', { cls:'ds' }, r.desc)),
          sel));
      });
    });
  },

  /* ---------------- HUD ---------------- */
  buildActionButtons() {
    const row = $('#actrow2'); row.innerHTML = '';
    const r = roleInfo(G.myRole);
    const mk = (id, cls, ic, label) => {
      const b = h('button', { cls:`abtn small ${cls}`, id },
        h('span', { cls:'ic' }, ic), h('span', {}, label), h('span', { cls:'cd hidden' }, ''));
      row.appendChild(b); return b;
    };
    this.btn = {};
    this.btn.report = mk('btn-report', 'report', '📢', '신고');
    if (r.canKill) this.btn.kill = mk('btn-kill', 'kill', '🔪', '살해');
    if (r.canVent) this.btn.vent = mk('btn-vent', 'vent', '🕳️', '벤트');
    if (r.faction === F.DUCK) this.btn.sab = mk('btn-sab', 'sab', '💥', '방해');
    if (r.ability) this.btn.abil = mk('btn-abil', 'abil', r.icon, ABILITY_LABEL[r.ability] || '능력');

    this.btn.report.onclick = () => Game.doReport();
    if (this.btn.kill) this.btn.kill.onclick = () => Game.doKill();
    if (this.btn.vent) this.btn.vent.onclick = () => Game.doVent();
    if (this.btn.sab) this.btn.sab.onclick = () => UI.openSabotage();
    if (this.btn.abil) this.btn.abil.onclick = () => Game.doAbility();
    $('#btn-use').onclick = () => Game.doUse();

    // 킬 버튼은 크게
    if (this.btn.kill) { this.btn.kill.classList.remove('small'); }
    // 행동 버튼을 다시 만들면 말하기 버튼도 사라지므로 복구
    if (Voice.enabled) Game.buildVoiceBtn();
  },

  renderRoleChip() {
    const r = roleInfo(G.myRole);
    const col = FACTION_COLOR[r.faction];
    const el = $('#rolechip');
    el.innerHTML =
      `<div class="rn" style="color:${col}">${r.icon} ${r.name}</div>` +
      `<div class="rd">${G.ghost ? '👻 유령 — 임무를 계속하세요' : r.desc}</div>` +
      (G.privateLog.length ? `<div class="rd" style="color:var(--warn)">📒 기록 ${G.privateLog.length}건 · 눌러서 보기</div>` : '');
    el.onclick = () => this.openRolePanel();
  },

  /** 내 직업 상세 + 능력으로 얻은 정보 기록 (토스트를 놓쳐도 다시 볼 수 있게) */
  openRolePanel() {
    const r = roleInfo(G.myRole);
    const root = h('div', {});
    root.innerHTML =
      `<div style="text-align:center;margin-bottom:14px">
         <div style="font-size:52px;line-height:1">${r.icon}</div>
         <div style="font-size:12px;color:${FACTION_COLOR[r.faction]};font-weight:800">${FACTION_LABEL[r.faction]} 진영</div>
         <div style="font-size:24px;font-weight:900">${r.name}</div>
       </div>
       <div style="font-size:14px;line-height:1.55">${r.desc}</div>
       <div style="font-size:13px;line-height:1.5;color:var(--warn);margin-top:10px">💡 ${r.tip || ''}</div>`;
    if (G.ducksKnown.length > 1) {
      const names = G.ducksKnown.filter(i => i !== G.myId).map(i => G.players[i]?.name).filter(Boolean);
      if (names.length) root.appendChild(h('div', { style:{ marginTop:'14px', padding:'11px', background:'#2a1b28', borderRadius:'12px', border:'1px solid #63384f' } },
        h('div', { cls:'tiny dim' }, '동료 오리'), h('div', { style:{ fontWeight:800, color:'var(--duck)' } }, names.join(', '))));
    }
    const badges = [];
    if (G.shielded) badges.push('🛡️ 방패 보호 중');
    if (G.infected) badges.push('🕊️ 감염됨');
    if (G.mySample) badges.push(`🎭 샘플: ${G.players[G.mySample]?.name || '?'}`);
    if (r.uses) badges.push(`남은 사용 횟수 ${G.abilityUses}`);
    if (badges.length) root.appendChild(h('div', { cls:'tiny', style:{ marginTop:'12px', color:'var(--acc)' } }, badges.join('  ·  ')));

    root.appendChild(h('div', { style:{ marginTop:'16px', fontWeight:800, fontSize:'13.5px' } }, '📒 내가 얻은 정보'));
    if (!G.privateLog.length) root.appendChild(h('div', { cls:'tiny dim' }, '아직 없습니다.'));
    else G.privateLog.forEach(t => root.appendChild(
      h('div', { cls:'tiny', style:{ padding:'7px 9px', background:'#0e1728', borderRadius:'9px', marginTop:'5px', lineHeight:1.4 } }, t)));

    root.appendChild(h('div', { cls:'tiny dim', style:{ marginTop:'14px' } },
      '이 기록은 회의 채팅에도 초록색으로 남아 있습니다.'));
    this.modal({ title:'내 직업', body: root });
  },

  renderTaskList() {
    const el = $('#tasklist');
    if (G.sabotage?.kind === 'comms') { el.innerHTML = '<div class="hd" style="color:var(--bad)">📡 통신 두절 — 임무 목록 숨김</div>'; return; }
    const fake = roleInfo(G.myRole).fakeTasks;
    let html = `<div class="hd">${fake ? '가짜 임무 (진행바에 반영 안 됨)' : '내 임무'}</div>`;
    for (const t of G.myTasks) {
      const done = t.step >= t.spots.length;
      const sp = spotById(t.spots[Math.min(t.step, t.spots.length - 1)]);
      const room = ROOMS.find(r => r.id === sp?.room)?.name || '';
      html += `<div class="ti${done ? ' done' : ''}"><span class="rm">${done ? '✔' : '▸'}</span>` +
              `<span>${room} · ${t.name}${t.spots.length > 1 ? ` (${t.step}/${t.spots.length})` : ''}</span></div>`;
    }
    el.innerHTML = html;
  },

  renderTaskBar() {
    const { done, total } = G.taskBar;
    $('#taskbar-num').textContent = `${done} / ${total}`;
    $('#taskbar-fill').style.width = (total ? done / total * 100 : 0) + '%';
  },

  setAlert(text) {
    const el = $('#alertbar');
    if (!text) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden'); el.innerHTML = text;
  },

  cooldown(btn, endsAt, uses) {
    if (!btn) return;
    const cd = btn.querySelector('.cd');
    const left = Math.ceil((endsAt - now()) / 1000);
    if (left > 0) { cd.classList.remove('hidden'); cd.textContent = left; }
    else if (uses != null && uses <= 0) { cd.classList.remove('hidden'); cd.textContent = '0'; }
    else cd.classList.add('hidden');
  },

  /* ---------------- 미니게임 ---------------- */
  openTask(task, spot) {
    const mg = MiniGames[spot.kind];
    if (!mg) { Game.completeStep(task.tid); return; }
    const root = h('div', { cls:'mg' });
    const m = this.modal({ title: `${spot.name}${task.spots.length > 1 ? ` (${task.step + 1}/${task.spots.length})` : ''}`, body: root });
    m.bd.insertBefore(h('div', { cls:'mg-msg', style:{ marginBottom:'10px' } }, mg.title), root);
    const fake = roleInfo(G.myRole).fakeTasks;
    if (fake) m.bd.insertBefore(h('div', { cls:'tiny', style:{ color:'var(--duck)', textAlign:'center', marginBottom:'6px' } },
      '⚠️ 가짜 임무입니다. 하는 척만 하면 됩니다.'), root);
    mg.build(root, { up: !!spot.up, step: task.step }, () => {
      Sfx.taskDone();
      Game.completeStep(task.tid);
      this.closeModal();
    });
  },

  /* ---------------- 지도 / 관리실 / 생체신호 ---------------- */
  openMap(mode = 'map') {
    const cv = h('canvas', { style:{ width:'100%', height:'320px', borderRadius:'14px', display:'block' } });
    const info = h('div', { cls:'tiny dim', style:{ marginTop:'9px', textAlign:'center' } });
    const root = h('div', {}, cv, info);
    const titles = { map:'🗺️ 지도', admin:'📊 관리실 — 방별 인원', cams:'📹 감시 카메라' };
    const m = this.modal({ title: titles[mode], body: root });
    const commsDown = G.sabotage?.kind === 'comms';
    if (commsDown && mode !== 'map') { info.innerHTML = '<span style="color:var(--bad)">📡 통신이 끊겨 사용할 수 없습니다.</span>'; return; }
    if (mode === 'admin') info.textContent = '각 방에 몇 명이 있는지 표시됩니다. 누구인지는 알 수 없습니다.';
    if (mode === 'cams') info.innerHTML = '카메라 설치 구역: <b>' + CAM_ROOMS.map(id => ROOMS.find(r => r.id === id).name).join(' · ') + '</b><br>해당 방에 있는 사람이 실시간으로 보입니다.';
    if (mode === 'map') info.textContent = G.ghost ? '유령은 모든 위치를 볼 수 있습니다.' : '노란 점 = 내 임무 위치';

    // 관리실·감시카메라는 '시야 밖' 정보다. 클라이언트가 원본을 갖고 있으면
    // 콘솔로 전원 위치를 볼 수 있으므로, 서버가 계산한 결과만 받아 쓴다.
    let iv = null;
    const needsServer = (mode === 'admin' || mode === 'cams');
    if (needsServer) {
      Game.infoCache[mode] = null;
      const ask = () => Net.toHost('reqinfo', { kind: mode });
      ask(); iv = setInterval(ask, 600);
    }
    let raf;
    const loop = () => {
      const data = needsServer ? Game.infoCache[mode] : null;
      if (data?.blocked) {
        info.innerHTML = '<span style="color:var(--bad)">📡 통신이 끊겨 사용할 수 없습니다.</span>';
      }
      Render.drawMinimap(cv, { sabotage: G.sabotage }, {
        me: G.players[G.myId],
        tasks: mode === 'map' ? Game.myTaskSpots() : null,
        adminCounts: mode === 'admin' ? (data?.counts || {}) : null,
        camRooms:    mode === 'cams'  ? CAM_ROOMS : null,
        showAll:     mode === 'cams'  ? (data?.list || [])
                   : (G.ghost && mode === 'map') ? Object.values(G.players) : null,
      });
      raf = requestAnimationFrame(loop);
    };
    loop();
    m.bd._cleanup = () => { cancelAnimationFrame(raf); if (iv) clearInterval(iv); Game.infoCache[mode] = null; };
  },

  openVitals() {
    const root = h('div', {});
    if (G.sabotage?.kind === 'comms') { root.innerHTML = '<div class="dim" style="text-align:center">📡 통신이 끊겨 사용할 수 없습니다.</div>'; this.modal({ title:'💓 생체 신호', body: root }); return; }
    const grid = h('div', { cls:'vitals' });
    Object.values(G.players).forEach(p => {
      const c = colorOf(p.color);
      const cv = h('canvas', { cls:'ekg', width:'120', height:'26' });
      grid.appendChild(h('div', { cls:'vital' + (p.alive ? '' : ' dead') },
        h('div', { cls:'pdot', style:{ background:c.hex, width:'18px', height:'18px', borderRadius:'6px' } }),
        h('div', { style:{ flex:'1', minWidth:0 } },
          h('div', { style:{ fontWeight:800, fontSize:'12.5px' } }, p.name),
          h('div', { cls:'tiny', style:{ color: p.alive ? 'var(--good)' : 'var(--bad)' } }, p.alive ? '생존' : '사망')),
        cv));
      const g = cv.getContext('2d'); let t = 0;
      const draw = () => {
        g.clearRect(0, 0, 120, 26); g.strokeStyle = p.alive ? '#3ddc84' : '#ff4d5e'; g.lineWidth = 1.6;
        g.beginPath();
        for (let x = 0; x < 120; x++) {
          const ph = ((x + t) % 40) / 40;
          const y = p.alive ? 13 - (ph < .12 ? Math.sin(ph / .12 * Math.PI) * 10 : ph < .2 ? -3 : 0) : 13;
          x ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke(); t += 1.4;
      };
      const iv = setInterval(draw, 40); draw();
      cv._iv = iv;
    });
    root.appendChild(grid);
    const m = this.modal({ title:'💓 생체 신호', body: root });
    m.bd._cleanup = () => grid.querySelectorAll('canvas').forEach(c => clearInterval(c._iv));
  },

  /* ---------------- 사보타주 메뉴 ---------------- */
  openSabotage() {
    const root = h('div', {});
    const cdLeft = Math.ceil((G.sabCdEnd - now()) / 1000);
    if (cdLeft > 0) root.appendChild(h('div', { cls:'mg-msg bad', style:{ marginBottom:'10px' } }, `쿨다운 ${cdLeft}초`));
    if (G.sabotage) root.appendChild(h('div', { cls:'mg-msg bad', style:{ marginBottom:'10px' } }, '이미 진행 중인 사보타주가 있습니다.'));
    const grid = h('div', { cls:'sabgrid' });
    const items = [
      ['lights',  '💡', '정전',      '거위의 시야를 크게 줄입니다'],
      ['comms',   '📡', '통신 두절', '임무 목록·지도·관리실을 막습니다'],
      ['reactor', '☢️', '리액터',    '제한시간 내 2명이 동시에 눌러야 함'],
      ['oxygen',  '🫁', '산소 고갈', '제한시간 내 2곳에 코드 입력'],
    ];
    items.forEach(([k, ic, nm, ds]) => {
      const b = h('button', { cls:'sabbtn', onclick: () => { Game.sabotage(k); UI.closeModal(); } },
        h('span', { cls:'ic' }, ic), h('div', {}, nm), h('div', { cls:'tiny dim', style:{fontWeight:600} }, ds));
      b.disabled = cdLeft > 0 || !!G.sabotage;
      grid.appendChild(b);
    });
    root.appendChild(grid);
    root.appendChild(h('div', { style:{ marginTop:'16px', fontWeight:800, fontSize:'13.5px' } }, '🚪 문 잠그기'));
    root.appendChild(h('div', { cls:'tiny dim' }, '한 방의 문을 잠급니다. 쿨다운이 짧습니다.'));
    const dg = h('div', { cls:'doorgrid' });
    DOOR_ROOMS.forEach(id => {
      const r = ROOMS.find(x => x.id === id);
      const b = h('button', { onclick: () => { Game.sabotage('doors', id); UI.closeModal(); } }, r.name);
      b.disabled = cdLeft > 0 || (G.doors[id] > now());
      dg.appendChild(b);
    });
    root.appendChild(dg);
    this.modal({ title:'💥 사보타주', body: root });
  },

  /* ---------------- 사보타주 수리 패널 ---------------- */
  openRepair(kind) {
    const S = G.sabotage; if (!S || S.kind !== kind) return;
    const root = h('div', { cls:'mg' });
    const titles = { lights:'💡 전력 복구', comms:'📡 통신 복구', reactor:'☢️ 리액터 안정화', oxygen:'🫁 산소 코드 입력' };

    if (kind === 'lights') {
      root.appendChild(h('div', { cls:'mg-msg' }, '모든 스위치를 위로 올리세요'));
      const box = h('div', { cls:'mg-divert' });
      const draw = () => {
        box.innerHTML = '';
        (G.sabotage?.data.switches || []).forEach((v, i) => {
          const s = h('div', { cls:'mg-switch' + (v ? ' up' : ''), onclick: () => { Sfx.click(); Game.sabFix({ kind, idx:i, val: v ? 0 : 1 }); } },
            h('div', { cls:'mg-switch-knob' }));
          box.appendChild(s);
        });
      };
      draw(); root.appendChild(box); root._redraw = draw;
    }
    else if (kind === 'comms') {
      root.appendChild(h('div', { cls:'mg-msg' }, '두 다이얼을 모두 가운데(50)에 맞추세요'));
      const wrap = h('div', { style:{ display:'flex', gap:'22px' } });
      [0, 1].forEach(i => {
        const lane = h('div', { cls:'mg-align-lane', style:{ width:'80px' } });
        lane.append(h('div', { cls:'mg-align-center' }), h('div', { cls:'mg-align-handle' }));
        const handle = lane.querySelector('.mg-align-handle');
        const sync = () => { const v = G.sabotage?.data.dials[i] ?? 50;
          handle.style.top = ((100 - v) / 100 * (lane.clientHeight - 34)) + 'px';
          handle.classList.toggle('ok', Math.abs(v - 50) < 4); };
        setTimeout(sync, 0);
        onDrag(lane, { move(p) { const H = lane.clientHeight - 34;
          const v = Math.round(clamp(100 - (p.y - 17) / H * 100, 0, 100)); Game.sabFix({ kind, idx:i, val:v }); sync(); } });
        lane._sync = sync;
        wrap.appendChild(lane);
      });
      root.appendChild(wrap); root._redraw = () => wrap.querySelectorAll('.mg-align-lane').forEach(l => l._sync());
    }
    else if (kind === 'reactor') {
      const near = SAB_SPOTS.reactor.map((s, i) => ({ s, i })).filter(({ s }) => Math.hypot(G.me.x - s.wx, G.me.y - s.wy) < 120);
      if (!near.length) { root.appendChild(h('div', { cls:'mg-msg bad' }, '리액터 손잡이 가까이 가세요')); }
      else {
        const idx = near[0].i;
        root.appendChild(h('div', { cls:'mg-msg' }, `${idx === 0 ? '왼쪽' : '오른쪽'} 손잡이를 잡았습니다.<br>다른 사람이 반대쪽을 동시에 잡아야 합니다.`));
        const btn = h('button', { cls:'mg-bigbtn', style:{ padding:'34px 44px', fontSize:'19px' } }, '🖐 손 대기');
        const dn = e => { e.preventDefault(); btn.classList.add('held'); Game.sabFix({ kind, idx, val:1 }); };
        const up = () => { btn.classList.remove('held'); Game.sabFix({ kind, idx, val:0 }); };
        btn.addEventListener('pointerdown', dn); btn.addEventListener('pointerup', up);
        btn.addEventListener('pointerleave', up); btn.addEventListener('pointercancel', up);
        root.appendChild(btn);
        const st = h('div', { cls:'mg-msg' }); root.appendChild(st);
        root._redraw = () => { const hold = G.sabotage?.data.hold || {};
          st.textContent = `왼쪽 ${hold[0] ? '🟢' : '⚪'}   오른쪽 ${hold[1] ? '🟢' : '⚪'}`; };
        root._redraw();
      }
    }
    else if (kind === 'oxygen') {
      const near = SAB_SPOTS.oxygen.map((s, i) => ({ s, i })).filter(({ s }) => Math.hypot(G.me.x - s.wx, G.me.y - s.wy) < 120);
      if (!near.length) root.appendChild(h('div', { cls:'mg-msg bad' }, '산소실 또는 관리실 단말기로 가세요'));
      else {
        const idx = near[0].i;
        const code = G.sabotage.data.code;
        root.appendChild(h('div', { cls:'mg-msg' }, '코드를 입력하세요'));
        root.appendChild(h('div', { style:{ fontSize:'34px', fontWeight:900, letterSpacing:'9px', color:'var(--warn)' } }, code));
        const disp = h('div', { style:{ fontSize:'27px', fontWeight:900, letterSpacing:'9px', minHeight:'34px' } }, '');
        root.appendChild(disp);
        let buf = '';
        const pad = h('div', { cls:'mg-keypad', style:{ maxWidth:'250px' } });
        '123456789⌫0✔'.split('').forEach(ch => {
          pad.appendChild(h('button', { cls:'mg-key', style:{ width:'70px' }, onclick: () => {
            Sfx.click();
            if (ch === '⌫') buf = buf.slice(0, -1);
            else if (ch === '✔') { if (buf === code) { Sfx.fixed(); Game.sabFix({ kind, idx }); UI.closeModal(); } else { buf = ''; Sfx.tone(200,.2,'square',0,140,.4); } }
            else if (buf.length < 4) buf += ch;
            disp.textContent = buf;
          } }, ch));
        });
        root.appendChild(pad);
      }
    }
    const m = this.modal({ title: titles[kind], body: root });
    const iv = setInterval(() => {
      if (!G.sabotage || G.sabotage.kind !== kind) { UI.closeModal(); return; }
      root._redraw?.();
    }, 160);
    m.bd._cleanup = () => clearInterval(iv);
  },

  /* ---------------- 메뉴 ---------------- */
  openMenu() {
    const root = h('div', { cls:'col' });
    root.appendChild(h('button', { cls:'btn', onclick: () => { Game.copyLink(); } }, '🔗 초대 링크 복사'));
    const sfxBtn = h('button', { cls:'btn', onclick: () => { Sfx.muted = !Sfx.muted; sfxBtn.textContent = Sfx.muted ? '🔇 효과음 꺼짐' : '🔊 효과음 켜짐'; } },
      Sfx.muted ? '🔇 효과음 꺼짐' : '🔊 효과음 켜짐');
    root.appendChild(sfxBtn);
    const vBtn = h('button', { cls:'btn' + (Voice.enabled ? ' primary' : ''), onclick: async () => {
      if (Voice.enabled) { Voice.disable(); vBtn.textContent = '🎙️ 음성채팅 켜기'; vBtn.classList.remove('primary'); UI.toast('음성채팅을 껐습니다.'); }
      else {
        try { await Voice.enable(); Game.announceVoice(); vBtn.textContent = '🎙️ 음성채팅 켜짐 (누르면 끔)'; vBtn.classList.add('primary');
          UI.toast('🎙️ 음성채팅 ON — 화면 아래 <b>말하기</b> 버튼을 누르는 동안만 전송됩니다.', 6000); Game.buildVoiceBtn(); }
        catch (e) { UI.toast('마이크를 사용할 수 없습니다: ' + e.message, 5000); }
      }
    } }, Voice.enabled ? '🎙️ 음성채팅 켜짐 (누르면 끔)' : '🎙️ 음성채팅 켜기');
    root.appendChild(vBtn);
    root.appendChild(h('div', { cls:'tiny dim' }, '음성은 켠 사람끼리만 연결됩니다. 대부분 못 쓰는 상황을 고려해 채팅·퀵챗이 기본입니다.'));
    const gBtn = h('button', { cls:'btn' + (G.guideOn ? ' primary' : ''), onclick: () => {
      G.guideOn = !G.guideOn;
      localStorage.setItem('duckus_guide', G.guideOn ? '1' : '0');
      gBtn.textContent = G.guideOn ? '🧭 길안내 켜짐 (누르면 끔)' : '🧭 길안내 꺼짐';
      gBtn.classList.toggle('primary', G.guideOn);
    } }, G.guideOn ? '🧭 길안내 켜짐 (누르면 끔)' : '🧭 길안내 꺼짐');
    root.appendChild(gBtn);
    root.appendChild(h('div', { cls:'tiny dim' }, '화면 가장자리 화살표로 다음 임무·수리 지점 방향을 알려줍니다. 익숙해지면 끄세요.'));
    root.appendChild(h('button', { cls:'btn ghost', onclick: () => { UI.closeModal(); UI.openHowTo(); } }, '📖 게임 방법'));
    root.appendChild(h('button', { cls:'btn ghost', onclick: () => { UI.closeModal(); UI.openRolesInfo(); } }, '🎭 직업 목록'));
    if (G.myId === G.hostId && G.phase !== 'lobby')
      root.appendChild(h('button', { cls:'btn danger', onclick: () => { if (confirm('게임을 끝내고 로비로 돌아갈까요?')) { Net.toHost('restart', {}); UI.closeModal(); } } }, '⏹ 게임 종료 (방장)'));
    root.appendChild(h('button', { cls:'btn danger', onclick: () => { if (confirm('정말 나가시겠습니까?')) location.reload(); } }, '🚪 방 나가기'));
    this.modal({ title:'☰ 메뉴', body: root });
  },

  openHowTo() {
    this.modal({ title:'📖 게임 방법', body: `
<div style="line-height:1.65;font-size:14px">
<b style="color:var(--goose)">🪿 거위 (선량한 시민)</b><br>
맵을 돌아다니며 <b>임무</b>를 완수하세요. 임무 진행바를 100%로 채우면 승리합니다.
숨어 있는 <b>오리</b>를 회의에서 찾아내 추방해도 승리합니다.<br><br>

<b style="color:var(--duck)">🦆 오리 (마피아)</b><br>
거위를 몰래 살해하세요. 살아있는 오리 수가 거위 수와 같아지면 승리합니다.
<b>벤트</b>로 순간이동하고, <b>사보타주</b>로 방해할 수 있습니다.<br><br>

<b style="color:var(--neut)">🎭 중립</b><br>
독수리·비둘기 같은 중립은 자기만의 조건으로 <b>단독 승리</b>합니다.<br><br>

<b>▸ 조작</b><br>
왼쪽 <b>조이스틱</b>으로 이동, 오른쪽 <b>버튼</b>으로 행동합니다.<br>
<b>사용</b> — 임무·수리·패널<br>
<b>신고</b> — 시체 발견 시 회의 소집<br>
<b>살해 / 벤트 / 방해</b> — 오리 전용<br><br>

<b>▸ 회의</b><br>
시체를 신고하거나 카페테리아의 빨간 버튼을 누르면 회의가 열립니다.
<b>토론</b> 시간에 대화하고, <b>투표</b> 시간에 지목합니다. 최다 득표자가 추방됩니다.<br><br>

<b style="color:var(--warn)">▸ 음성 없이 잘하는 법 (중요)</b><br>
· <b>퀵챗 버튼</b>을 쓰세요. 색·방 이름을 눌러 문장을 즉시 완성합니다.<br>
· <b>📍내 동선</b> 버튼 — 내가 지나온 방과 시각이 자동으로 기록돼 한 번에 붙여넣어집니다.<br>
· 플레이어 카드에 <b>내가 마지막으로 본 위치와 시각</b>이 표시됩니다.<br>
· 토론 시간이 기본 60초로 길게 잡혀 있습니다. 방장이 설정에서 늘릴 수 있습니다.<br>
</div>` });
  },

  openRolesInfo() {
    const root = h('div', {});
    [['거위 진영', ['goose', ...GOOSE_ROLES], 'var(--goose)'],
     ['오리 진영', ['duck', ...DUCK_ROLES], 'var(--duck)'],
     ['중립', NEUT_ROLES, 'var(--neut)']].forEach(([gname, keys, col]) => {
      root.appendChild(h('div', { style:{ color:col, fontWeight:800, margin:'14px 0 7px' } }, gname));
      keys.forEach(k => {
        const r = ROLES[k];
        root.appendChild(h('div', { cls:'roleitem' }, h('div', { cls:'ic' }, r.icon),
          h('div', { style:{ minWidth:0 } },
            h('div', { cls:'nm' }, r.name),
            h('div', { cls:'ds' }, r.desc),
            r.tip ? h('div', { cls:'ds', style:{ color:'var(--warn)', marginTop:'2px' } }, '💡 ' + r.tip) : null)));
      });
    });
    this.modal({ title:'🎭 직업 목록', body: root });
  },

  /* ---------------- 역할 공개 연출 ---------------- */
  revealRole() {
    const r = roleInfo(G.myRole);
    const col = FACTION_COLOR[r.faction];
    const root = h('div', { style:{ textAlign:'center', padding:'14px 0' } });
    root.innerHTML = `
      <div style="font-size:76px;line-height:1;margin-bottom:6px">${r.icon}</div>
      <div style="font-size:13px;color:${col};font-weight:800">${FACTION_LABEL[r.faction]} 진영</div>
      <div style="font-size:31px;font-weight:900;margin:4px 0 10px">${r.name}</div>
      <div style="font-size:14px;line-height:1.55;color:var(--txt);max-width:340px;margin:0 auto">${r.desc}</div>
      <div style="font-size:13px;line-height:1.5;color:var(--warn);margin-top:12px;max-width:340px;margin-left:auto;margin-right:auto">💡 ${r.tip || ''}</div>`;
    if (G.ducksKnown.length > 1) {
      const names = G.ducksKnown.filter(i => i !== G.myId).map(i => G.players[i]?.name).filter(Boolean);
      if (names.length) root.appendChild(h('div', { style:{ marginTop:'16px', padding:'11px', background:'#2a1b28', borderRadius:'12px', border:'1px solid #63384f' } },
        h('div', { cls:'tiny dim' }, '동료 오리'), h('div', { style:{ fontWeight:800, color:'var(--duck)' } }, names.join(', '))));
    }
    const btn = h('button', { cls:'btn primary', style:{ width:'100%' }, onclick: () => UI.closeModal() }, '시작하기');
    this.modal({ title:'역할이 정해졌습니다', body: root, footer:[btn], closable:false });
    setTimeout(() => { if (UI.modalStack.length) UI.closeModal(); }, 9000);
  },

  /* ---------------- 킬 연출 ----------------
   * 갑자기 시체가 되면 긴장감이 없다. 가해자·피해자에게만 짧은 컷신을 보여준다. */
  playKill({ killerColor, victimColor, asVictim }) {
    if (this._killCine) return;
    const wrap = h('div', { cls:'killcine' });
    const cv = h('canvas', { cls:'killcine-cv' });
    const cap = h('div', { cls:'killcine-cap' },
      asVictim ? '💀 살해당했습니다' : '🔪 처리했습니다');
    const sub = h('div', { cls:'killcine-sub' },
      asVictim ? '이제 유령입니다 — 임무는 계속할 수 있어요' : '들키기 전에 자리를 뜨세요');
    wrap.append(cv, cap, sub);
    document.body.appendChild(wrap);
    this._killCine = wrap;

    const g = cv.getContext('2d');
    const K = colorOf(killerColor), V = colorOf(victimColor);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = 340, H = 190;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    g.scale(dpr, dpr);

    const t0 = performance.now();
    const DUR = 1900;
    let raf;
    const loop = () => {
      const p = Math.min(1, (performance.now() - t0) / DUR);
      g.clearRect(0, 0, W, H);
      // 배경 방사
      const grad = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W / 2);
      grad.addColorStop(0, `rgba(120,10,20,${0.55 * (1 - p) + 0.1})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);

      const vx = W * 0.34, vy = H * 0.56;            // 피해자 자리
      const fall = p < 0.55 ? 0 : (p - 0.55) / 0.45;  // 쓰러지는 정도
      const lunge = Math.min(1, p / 0.55);
      const back  = p < 0.6 ? 0 : (p - 0.6) / 0.4;
      // 가해자: 오른쪽 밖 → 피해자 옆까지 달려들고 → 살짝 물러난다
      const kx = p < 0.55 ? W * 1.25 + (W * 0.60 - W * 1.25) * (lunge ** 0.6)
                          : W * 0.60 + (W * 0.74 - W * 0.60) * back;

      // 핏자국 먼저 (바닥)
      if (fall > 0) {
        g.fillStyle = `rgba(150,20,30,${Math.min(0.55, fall * 0.8)})`;
        g.beginPath(); g.ellipse(vx + 10, vy + 34, 46 * fall, 12 * fall, 0, 0, 6.283); g.fill();
      }
      // 가해자 (뒤쪽)
      g.save();
      g.translate(kx, H * 0.54);
      g.scale(-2.3, 2.3);                            // 왼쪽을 바라보게 반전
      Render.duckShape(g, K, { moving: p < 0.6, t: performance.now() });
      g.restore();
      // 피해자 (앞쪽 — 쓰러진 모습이 가려지지 않도록 나중에 그린다)
      g.save();
      g.translate(vx, vy + fall * 18);
      g.rotate(fall * 1.35);
      g.scale(2.3, 2.3);
      Render.duckShape(g, V, { dead: fall > 0.15, moving: false, t: 0 });
      g.restore();

      // 슬래시 섬광
      if (p > 0.5 && p < 0.68) {
        const a = 1 - (p - 0.5) / 0.18;
        g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 6 * a + 1;
        g.beginPath(); g.moveTo(vx - 34, vy - 46); g.lineTo(vx + 52, vy + 40); g.stroke();
        g.fillStyle = `rgba(255,255,255,${a * 0.32})`; g.fillRect(0, 0, W, H);
      }
      if (p < 1) raf = requestAnimationFrame(loop);
    };
    loop();

    Sfx.kill();
    Render.shake = 20;
    setTimeout(() => {
      cancelAnimationFrame(raf);
      wrap.style.transition = 'opacity .35s'; wrap.style.opacity = 0;
      setTimeout(() => { wrap.remove(); this._killCine = null; }, 380);
    }, DUR + 500);
  },

  /* ---------------- 추방 연출 ---------------- */
  playEject(d) {
    this.closeAllModals();
    this.show('eject');
    const space = $('#eject-space'); space.innerHTML = '';
    for (let i = 0; i < 60; i++) space.appendChild(h('div', { cls:'eject-star', style:{
      left: rnd(0, 100) + '%', top: rnd(0, 100) + '%', width: rnd(1, 3) + 'px', height: rnd(1, 3) + 'px' } }));
    const duckEl = $('#eject-duck');
    if (d.ejectId) {
      const p = G.players[d.ejectId];
      duckEl.style.display = '';
      duckEl.innerHTML = `<span style="filter:drop-shadow(0 0 14px ${colorOf(p?.color).hex})">🦆</span>`;
      let txt = `${p?.name || '???'} 님이 우주로 추방되었습니다`;
      let sub = '';
      if (d.confirm) {
        const r = roleInfo(d.role);
        sub = `${p?.name} 님은 <b style="color:${FACTION_COLOR[r.faction]}">${r.icon} ${r.name}</b>${hasJong(r.name) ? '이었습니다' : '였습니다'}.`;
        if (isDuck(d.role)) sub += `<br>남은 오리 ${d.remainDucks}마리`;
      }
      $('#eject-text').innerHTML = txt;
      $('#eject-sub').innerHTML = sub;
      Sfx.eject();
    } else {
      duckEl.style.display = 'none';
      $('#eject-text').textContent = '아무도 추방되지 않았습니다';
      $('#eject-sub').textContent = d.tally?.skip > 0 ? '스킵이 가장 많았습니다' : '표가 갈렸습니다';
    }
  },

  /* ---------------- 결과 ---------------- */
  showResult(res) {
    this.closeAllModals();
    this.show('result');
    const label = { goose:'거위 승리!', duck:'오리 승리!', neutral:'중립 승리!' }[res.faction];
    const col = FACTION_COLOR[res.faction];
    $('#result-title').textContent = label;
    $('#result-title').style.color = col;
    $('#result-reason').textContent = res.reason;
    const iWon = res.winners.includes(G.myId);
    iWon ? Sfx.win() : Sfx.lose();

    const roster = $('#result-roster'); roster.innerHTML = '';
    roster.appendChild(h('div', { cls:'tiny dim', style:{ marginBottom:'8px' } },
      `플레이 시간 ${Math.floor(res.duration / 60)}분 ${res.duration % 60}초 · ${iWon ? '🎉 당신은 승리했습니다' : '패배했습니다'}`));
    res.roster.forEach(p => {
      const r = roleInfo(p.role), c = colorOf(p.color);
      roster.appendChild(h('div', { cls:'rrow' + (res.winners.includes(p.id) ? ' win' : '') },
        h('div', { cls:'pdot', style:{ background:c.hex } }),
        h('div', { cls:'grow', style:{ minWidth:0 } },
          h('div', { style:{ fontWeight:800, fontSize:'13.5px' } }, p.name + (p.id === G.myId ? ' (나)' : '')),
          h('div', { cls:'rl', style:{ color: FACTION_COLOR[r.faction] } }, `${r.icon} ${r.name}`)),
        h('div', { cls:'tiny dim' }, p.alive ? '생존' : '사망')));
    });

    const foot = $('#result-foot'); foot.innerHTML = '';
    if (G.myId === G.hostId)
      foot.appendChild(h('button', { cls:'btn primary', style:{ width:'100%', padding:'16px' },
        onclick: () => Net.toHost('restart', {}) }, '🔄 로비로 돌아가기'));
    else
      foot.appendChild(h('div', { cls:'card', style:{ textAlign:'center' } }, h('div', { cls:'dim' }, '방장이 로비로 돌아가기를 기다리는 중…')));
  },
};

const ABILITY_LABEL = {
  investigate:'조사', autopsy:'부검', remotefix:'원격수리', shoot:'사격', shield:'방패',
  morph:'변신', drag:'시체끌기', eat:'먹기', infect:'감염', guess:'추측',
  track:'추적', guard:'경호',
};
