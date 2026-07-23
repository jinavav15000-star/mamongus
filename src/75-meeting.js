/* ============================================================================
 *  마몽어스 · 회의 · 투표 · 채팅
 *  ※ 대부분 음성을 못 쓰는 환경 → 타이핑 부담을 없애는 것이 이 모듈의 목표
 * ==========================================================================*/

/* ---------------------------------------------------------------------------
 *  동선 자동 기록 · 목격 기록
 *  "나 어디 있었는지 타이핑" 이 게임에서 제일 느린 동작이다. 자동으로 남긴다.
 * -------------------------------------------------------------------------*/
const Trail = {
  log: [],            // {t:초, room:'전기실'}
  seen: {},           // playerId -> {t, room}
  roundStart: 0,
  lastRoom: null,

  reset() { this.log = []; this.seen = {}; this.roundStart = now(); this.lastRoom = null; },
  sec() { return Math.round((now() - this.roundStart) / 1000); },
  fmt(s) { return `${String((s / 60) | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; },

  track(me, visibleOthers) {
    const room = roomNameAt(me.x, me.y);
    if (room !== '오솔길' && room !== this.lastRoom) {
      this.lastRoom = room;
      this.log.push({ t: this.sec(), room });
      if (this.log.length > 40) this.log.shift();
    }
    for (const p of visibleOthers) this.seen[p.id] = { t: this.sec(), room: roomNameAt(p.x, p.y) };
  },

  /** 회의 채팅에 붙여넣을 내 동선 문자열 */
  myPath() {
    if (!this.log.length) return '동선 기록 없음';
    const parts = this.log.slice(-7).map(e => `${this.fmt(e.t)} ${e.room}`);
    return '📍 내 동선 ' + parts.join(' → ');
  },
  seenText(pid) {
    const s = this.seen[pid];
    return s ? `👁 ${this.fmt(s.t)} ${s.room}` : '👁 못 봄';
  },
};

/* ---------------------------------------------------------------------------
 *  퀵챗 — 색/방 이름을 눌러 문장을 즉시 완성
 * -------------------------------------------------------------------------*/
const QUICK = [
  { cat:'🚨 지목', items:[
    { t:'{p} 의심돼', n:['p'] }, { t:'{p} 늑대야 확실해', n:['p'] }, { t:'{p} 클리어', n:['p'] },
    { t:'{p} 벤트 타는 거 봤어', n:['p'] }, { t:'{p} 시체 옆에 있었어', n:['p'] },
    { t:'{p} 임무 안 하고 서성였어', n:['p'] }, { t:'{p} 아까부터 나 따라다녀', n:['p'] },
    { t:'{p}랑 {q} 둘 중 하나야', n:['p','q'] },
  ]},
  { cat:'📍 위치', items:[
    { t:'나 {r}에 있었어', n:['r'] }, { t:'나 계속 {r}에서 임무했어', n:['r'] },
    { t:'{p} {r}에서 봤어', n:['p','r'] }, { t:'시체 {r}에서 나왔어', n:['r'] },
    { t:'{r} 쪽 아무도 없었어', n:['r'] }, { t:'{r}로 가보자', n:['r'] },
    { t:'{p}랑 {r}에서 같이 있었어', n:['p','r'] },
  ]},
  { cat:'❓ 질문', items:[
    { t:'어디?' }, { t:'누구?' }, { t:'증거는?' }, { t:'너 뭐 했는데?' },
    { t:'시체 어디서 나왔어?' }, { t:'{p} 어디 있었어?', n:['p'] },
    { t:'{p} 봤어?', n:['p'] }, { t:'누구랑 같이 있었어?' },
  ]},
  { cat:'💬 대답', items:[
    { t:'ㅇㅇ 맞아' }, { t:'ㄴㄴ 아니야' }, { t:'나 아님 진짜' }, { t:'몰라 못 봤어' },
    { t:'스킵하자' }, { t:'투표하자' }, { t:'시간 없어 빨리' }, { t:'혼자 있었어…' },
    { t:'{p} 믿어', n:['p'] }, { t:'나 임무 중이었어' },
  ]},
  { cat:'🎭 직업', items:[
    { t:'나 탐정이야' }, { t:'나 기술자야 (벤트 타도 돼)' }, { t:'나 장의사야' },
    { t:'나 영매야' }, { t:'나 의사야' }, { t:'나 보안관이야' }, { t:'나 조류관찰자야' },
    { t:'{p}한테 방패 줬어', n:['p'] }, { t:'{p} 이번 라운드 살인 없음', n:['p'] },
    { t:'{p} 이번 라운드 살인 있음 ⚠️', n:['p'] }, { t:'커밍아웃 하지 마 (암살자 있음)' },
  ]},
  { cat:'⚠️ 상황', items:[
    { t:'{r}에서 벤트 소리 났어', n:['r'] }, { t:'정전 났을 때 {r}에 있었어', n:['r'] },
    { t:'사보타주 고치러 갔었어' }, { t:'임무바 안 올라가고 있어' },
    { t:'{p} 방패 발동했대', n:['p'] }, { t:'2명 남았어 조심해' },
  ]},
];

const Meeting = {
  cat: 0,
  pending: null,      // {tpl, need:[...], vals:{}}
  myVote: null,
  chatMsgs: [],

  open(st) {
    UI.closeAllModals();
    UI.show('meeting');
    this.myVote = null;
    this.pending = null;
    this.renderQuickCats();
    this.renderQuickItems();
    this.render(st);
    $('#chat').scrollTop = 1e9;
    Sfx.meeting();
  },

  render(st) {
    this.bindQcToggle();
    const m = st.meeting; if (!m) return;
    const body = m.body;
    $('#meet-title').innerHTML = body
      ? `🚨 시체 발견 — <span style="color:${colorOf(body.color).hex}">${G.players[body.pid]?.name || '?'}</span>`
      : '🔔 긴급 회의';
    const caller = G.players[m.caller];
    $('#meet-sub').textContent = body
      ? `${caller?.name || '?'} 님이 ${body.room}에서 신고 · ${m.phase === 'discuss' ? '토론 중' : '투표 중'}`
      : `${caller?.name || '?'} 님이 소집 · ${m.phase === 'discuss' ? '토론 중' : '투표 중'}`;

    const left = $('#meet-left');
    const scrollTop = left.scrollTop;
    left.innerHTML = '';

    if (m.phase === 'discuss') {
      left.appendChild(h('div', { cls:'meet-note tiny dim', style:{ textAlign:'center', padding:'4px 0 6px' } },
        '토론 시간 — 투표는 곧 열립니다'));
    }

    // 투표 중에는 "누가 투표했는지"만 보이고 "누구에게"는 개표 후 공개
    const hidden = m.phase === 'vote' && !m.tally;
    const votedSet = new Set(Object.keys(m.votes || {}));
    const voteCounts = {};
    if (!hidden && m.votes) for (const [voter, target] of Object.entries(m.votes)) {
      (voteCounts[target] ||= []).push(voter);
    }

    G.order.forEach(pid => {
      const p = G.players[pid]; if (!p) return;
      const c = colorOf(p.color);
      const isMe = pid === G.myId;
      const canVote = m.phase === 'vote' && G.me?.alive && this.myVote == null && p.alive;
      const card = h('div', { cls:'vcard' + (p.alive ? '' : ' dead') + (isMe ? ' me' : '') + (this.myVote === pid ? ' voted' : '') + (p.afk ? ' afk' : '') });
      card.append(
        h('div', { cls:'pdot', style:{ background:c.hex } }),
        h('div', { cls:'info' },
          h('div', { cls:'nm' }, p.name + (isMe ? ' (나)' : '') + (p.alive ? '' : ' 💀') + (p.afk && p.alive ? ' 💤' : '') + (!p.connected ? ' 📴' : '')),
          h('div', { cls:'seen' }, p.alive ? (isMe ? '나' : Trail.seenText(pid)) : '사망')),
      );
      // 득표 표시 (개표 후) / 투표 완료 표시 (투표 중)
      const chips = h('div', { cls:'votechips' });
      if (hidden) {
        if (votedSet.has(pid)) chips.appendChild(h('span', { cls:'tiny', style:{ color:'var(--warn)', fontWeight:800 } }, '✓ 투표'));
      } else {
        (voteCounts[pid] || []).forEach(v => {
          const vc = G.settings.anonVotes ? '#7a8ba8' : colorOf(G.players[v]?.color).hex;
          chips.appendChild(h('div', { cls:'votechip', style:{ background: vc } }));
        });
      }
      card.appendChild(chips);
      if (canVote) card.appendChild(h('button', { cls:'vbtn', onclick: () => this.vote(pid) }, '투표'));
      left.appendChild(card);
    });

    // 스킵
    const skipCount = (voteCounts['skip'] || []).length;
    const skipCard = h('div', { cls:'vcard meet-note' + (this.myVote === 'skip' ? ' voted' : '') },
      h('div', { cls:'pdot', style:{ background:'#3a4a6a', display:'flex', alignItems:'center', justifyContent:'center' } }, '⏭'),
      h('div', { cls:'info' }, h('div', { cls:'nm' }, '스킵 (투표 안 함)')),
    );
    const skipChips = h('div', { cls:'votechips' });
    if (!hidden) (voteCounts['skip'] || []).forEach(v => skipChips.appendChild(h('div', { cls:'votechip', style:{ background: G.settings.anonVotes ? '#7a8ba8' : colorOf(G.players[v]?.color).hex } })));
    skipCard.appendChild(skipChips);
    if (m.phase === 'vote' && G.me?.alive && this.myVote == null)
      skipCard.appendChild(h('button', { cls:'vbtn', onclick: () => this.vote('skip') }, '스킵'));
    left.appendChild(skipCard);

    // 암살자 UI
    if (G.myRole === 'assassin' && G.me?.alive && G.abilityUses > 0) {
      left.appendChild(h('button', { cls:'btn danger small meet-note', style:{ width:'100%', marginTop:'6px' },
        onclick: () => this.openGuess() }, `🗡️ 직업 추측 암살 (${G.abilityUses}회 남음)`));
    }
    // 유령 안내
    if (!G.me?.alive) left.appendChild(h('div', { cls:'meet-note tiny', style:{ color:'#9d7fd0', textAlign:'center', marginTop:'6px' } },
      '👻 유령입니다. 채팅은 유령과 영매에게만 보입니다.'));

    left.scrollTop = scrollTop;
    this.updateTimer(m);
  },

  updateTimer(m) {
    const left = Math.max(0, Math.ceil((m.endsAt - now()) / 1000));
    const el = $('#meet-timer');
    el.textContent = String(left).padStart(2, '0');
    el.classList.toggle('urgent', left <= 10);
  },

  vote(target) {
    if (this.myVote != null) return;
    this.myVote = target;
    Net.toHost('vote', { target });
    Sfx.vote();
    this.render({ meeting: G.meeting });
  },

  /* ---------------- 채팅 ---------------- */
  _el(m) {
    if (m.sys)   return h('div', { cls:'msg sys' }, m.text);
    if (m.mylog) return h('div', { cls:'msg mylog' }, m.text);
    const c = colorOf(m.color);
    const el = h('div', { cls:'msg' + (m.channel === 'dead' ? ' dead' : '') });
    el.innerHTML = `<span class="who" style="color:${c.hex}">${m.channel === 'dead' ? '👻' : ''}${escapeHtml(m.name)}</span> <span>${escapeHtml(m.text)}</span>`;
    return el;
  },
  _append(box, m) {
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.appendChild(this._el(m));
    if (atBottom) box.scrollTop = 1e9;
  },
  addMsg(m) {
    this.chatMsgs.push(m);
    if (this.chatMsgs.length > 300) this.chatMsgs.shift();
    this._append($('#chat'), m);
    this._append($('#lobby-chat'), m);
    this._append($('#play-chat'), m);
    this._append(document.getElementById('ghost-chat'), m);
    if (!m.sys) Sfx.chat();
    // 머리 위 말풍선 (구스구스덕처럼). 유령 채팅은 산 사람에게 그려질 몸이 없으니 제외
    if (!m.sys && m.from && m.channel !== 'dead') {
      const pl = G.players?.[m.from];
      if (pl) pl.bubble = { text: String(m.text).slice(0, 42), until: Date.now() + 4800 };
    }
    // 채팅창이 닫혀 있으면 버튼에 안읽음 표시
    if (!m.sys && m.from !== G.myId) {
      const w = document.getElementById('play-chat-wrap'), b = document.getElementById('btn-chat');
      if (w && b && w.classList.contains('hidden') && !b.classList.contains('hidden'))
        b.style.borderColor = 'var(--warn)';
    }
    // 게임 화면에서 유령끼리 대화가 오면 배지로 알림
    if (UI.screen === 'game' && !m.sys && m.from !== G.myId) {
      const b = $('#btn-ghostchat');
      if (b && !b.classList.contains('hidden')) b.style.borderColor = 'var(--warn)';
    }
  },
  clearChat() { this.chatMsgs = []; $('#chat').innerHTML = ''; $('#lobby-chat').innerHTML = ''; const pc = $('#play-chat'); if (pc) pc.innerHTML = ''; },

  /** 게임 진행 중 유령/영매용 채팅 창 */
  openGhostChat() {
    $('#btn-ghostchat').style.borderColor = '';
    const box = h('div', { cls:'chat scroll', id:'ghost-chat', style:{ height:'42vh', background:'#1c140d', borderRadius:'12px' } });
    this.chatMsgs.forEach(m => box.appendChild(this._el(m)));
    const inp = h('input', { placeholder:'유령끼리 대화…', maxlength:'160' });
    const send = () => { const v = inp.value.trim(); if (v) { Net.toHost('chat', { text: v }); inp.value = ''; } };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    const bar = h('div', { cls:'chatinput', style:{ marginTop:'9px' } }, inp, h('button', { onclick: send }, '전송'));
    const root = h('div', {}, box, bar,
      h('div', { cls:'tiny dim', style:{ marginTop:'7px' } },
        G.myRole === 'medium' ? '🔮 영매: 유령들의 대화가 보입니다. 회의에서 대신 전할 수 있어요.'
                              : '👻 유령의 대화는 다른 유령과 영매에게만 보입니다.'));
    UI.modal({ title:'👻 유령 채팅', body: root });
    setTimeout(() => { box.scrollTop = 1e9; }, 0);
  },

  send(text) {
    text = (text || '').trim();
    if (!text) return;
    Net.toHost('chat', { text });
    $('#chat-in').value = '';
  },

  /* ---------------- 퀵챗 (기본 접힘 — ⚡ 로 펼침) ---------------- */
  bindQcToggle() {
    const b = $('#qc-toggle');
    if (!b || b._bound) return;
    b._bound = true;
    b.onclick = () => {
      const opening = $('#qc-cats').classList.contains('hidden');
      $('#qc-cats').classList.toggle('hidden', !opening);
      $('#qc-items').classList.toggle('hidden', !opening);
      b.classList.toggle('on', opening);
    };
  },

  renderQuickCats() {
    const el = $('#qc-cats'); el.innerHTML = '';
    el.appendChild(h('button', { cls:'act', onclick: () => { this.send(Trail.myPath()); } }, '📍 내 동선'));
    QUICK.forEach((g, i) => el.appendChild(h('button', { cls: i === this.cat ? 'act' : '',
      onclick: () => { this.cat = i; this.pending = null; this.renderQuickCats(); this.renderQuickItems(); } }, g.cat)));
  },

  renderQuickItems() {
    const el = $('#qc-items'); el.innerHTML = '';
    if (this.pending) {
      const need = this.pending.need[0];
      el.appendChild(h('button', { cls:'act', onclick: () => { this.pending = null; this.renderQuickItems(); } }, '✕ 취소'));
      if (need === 'p' || need === 'q') {
        G.order.forEach(pid => {
          const p = G.players[pid]; if (!p) return;
          const c = colorOf(p.color);
          el.appendChild(h('button', { style:{ borderColor:c.hex, color:c.hex },
            onclick: () => this.fill(need, p.name) }, p.name));
        });
      } else {
        ROOMS.forEach(r => el.appendChild(h('button', { onclick: () => this.fill('r', r.name) }, r.name)));
        el.appendChild(h('button', { onclick: () => this.fill('r', '오솔길') }, '오솔길'));
      }
      return;
    }
    QUICK[this.cat].items.forEach(it => {
      el.appendChild(h('button', { onclick: () => {
        if (!it.n) return this.send(it.t);
        this.pending = { tpl: it.t, need: [...it.n], vals: {} };
        this.renderQuickItems();
      } }, it.t.replace(/\{p\}/g, '[누구]').replace(/\{q\}/g, '[누구]').replace(/\{r\}/g, '[어디]')));
    });
  },

  fill(key, val) {
    const p = this.pending; if (!p) return;
    p.vals[key] = val;
    p.need.shift();
    if (p.need.length) { this.renderQuickItems(); return; }
    let out = p.tpl;
    for (const k in p.vals) out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), p.vals[k]);
    this.pending = null;
    this.renderQuickItems();
    this.send(out);
  },

  /* ---------------- 암살자 추측 ---------------- */
  openGuess() {
    const root = h('div', {});
    let target = null, role = null;
    const info = h('div', { cls:'mg-msg' }, '대상과 직업을 고르세요. 맞으면 즉사, 틀리면 내가 죽습니다.');
    const pRow = h('div', { cls:'qc', style:{ flexWrap:'wrap', margin:'10px 0' } });
    G.order.forEach(pid => {
      const p = G.players[pid]; if (!p || !p.alive || pid === G.myId) return;
      const c = colorOf(p.color);
      const b = h('button', { style:{ borderColor:c.hex, color:c.hex }, onclick: () => {
        target = pid; [...pRow.children].forEach(x => x.classList.remove('act')); b.classList.add('act'); } }, p.name);
      pRow.appendChild(b);
    });
    const rRow = h('div', { cls:'qc', style:{ flexWrap:'wrap' } });
    [...['goose'], ...GOOSE_ROLES, ...NEUT_ROLES].forEach(k => {
      const b = h('button', { onclick: () => { role = k; [...rRow.children].forEach(x => x.classList.remove('act')); b.classList.add('act'); } },
        `${ROLES[k].icon} ${ROLES[k].name}`);
      rRow.appendChild(b);
    });
    root.append(info, h('div', { cls:'tiny dim' }, '대상'), pRow, h('div', { cls:'tiny dim' }, '직업'), rRow);
    const go = h('button', { cls:'btn danger', style:{ width:'100%' }, onclick: () => {
      if (!target || !role) { UI.toast('대상과 직업을 모두 고르세요.'); return; }
      Net.toHost('ability', { kind:'guess', target, role });
      UI.closeModal();
    } }, '🗡️ 암살 실행');
    UI.modal({ title:'🗡️ 직업 추측 암살', body: root, footer:[go] });
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
