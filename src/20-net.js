/* ============================================================================
 *  덕몽어스 · 네트워크 레이어 (PeerJS · 스타 토폴로지)
 *
 *   [클라] ──┐
 *   [클라] ──┼──▶ [호스트] ── 게임 로직 권한 ──▶ 스냅샷 브로드캐스트
 *   [클라] ──┘
 *
 *  · 호스트가 유일한 허브 → 연결 수 N-1 (메시 N²/2 대비 모바일에서 압도적)
 *  · uid 기반 재접속 복구 (모바일 화면잠금/백그라운드 대응)
 *  · 음성은 별도 메시 (사용자가 켠 사람끼리만)
 * ==========================================================================*/
const NET_PREFIX = 'duckus7-';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 0/O/1/I 제외

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80',  username:'openrelayproject', credential:'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username:'openrelayproject', credential:'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username:'openrelayproject', credential:'openrelayproject' },
  ],
  sdpSemantics: 'unified-plan',
};

function makeCode(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
  return s;
}
/** 재접속용 고정 ID.
 *  sessionStorage 우선 → 같은 탭에서 새로고침/연결끊김 시 원래 슬롯으로 복귀.
 *  탭을 완전히 닫았다 링크를 다시 열면 localStorage 백업으로 복귀. */
function myUid() {
  let u = sessionStorage.getItem('duckus_uid') || localStorage.getItem('duckus_uid');
  if (!u) u = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { sessionStorage.setItem('duckus_uid', u); localStorage.setItem('duckus_uid', u); } catch {}
  return u;
}

const Net = {
  peer: null,
  isHost: false,
  code: null,
  conns: new Map(),        // hostOnly: peerId -> DataConnection
  hostConn: null,          // clientOnly
  uid: myUid(),
  handlers: {},
  status: 'idle',
  pingMs: 0,
  clockOffset: 0,          // 호스트 시계 - 내 시계 (ms). 호스트는 항상 0
  _bestRtt: Infinity,
  _lastPong: 0,
  _hb: null,
  _peerIds: {},            // playerId -> peerId (음성 메시용)

  on(evt, fn) { (this.handlers[evt] ||= []).push(fn); return this; },
  emit(evt, ...a) { (this.handlers[evt] || []).forEach(f => { try { f(...a); } catch (e) { console.error('[net]', evt, e); } }); },

  _setStatus(s, detail) { this.status = s; this.emit('status', s, detail); },

  /* ---------------- 호스트 ---------------- */
  async createRoom(preferred) {
    this.isHost = true;
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = preferred && attempt === 0 ? preferred : makeCode();
      const ok = await this._tryOpen(NET_PREFIX + code);
      if (ok) {
        this.code = code;
        this._wireHost();
        this._setStatus('hosting');
        return code;
      }
      if (this._fatal) throw new Error(this._fatal);
    }
    throw new Error('방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
  },

  _tryOpen(id) {
    return new Promise(resolve => {
      let done = false;
      const p = new Peer(id, { config: ICE, debug: 0 });
      const to = setTimeout(() => { if (!done) { done = true; try { p.destroy(); } catch {} resolve(false); } }, 12000);
      p.on('open', () => { if (done) return; done = true; clearTimeout(to); this.peer = p; resolve(true); });
      p.on('error', err => {
        if (done) return;
        if (err.type === 'unavailable-id') { done = true; clearTimeout(to); try { p.destroy(); } catch {} resolve(false); }
        else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
          done = true; clearTimeout(to); this._fatal = '시그널링 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.';
          try { p.destroy(); } catch {} resolve(false);
        }
      });
    });
  },

  _wireHost() {
    this.peer.on('connection', conn => {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        conn.on('data', d => this._onHostData(conn, d));
      });
      conn.on('close', () => { this.conns.delete(conn.peer); this.emit('peerleave', conn.peer); });
      conn.on('error', () => { this.conns.delete(conn.peer); this.emit('peerleave', conn.peer); });
    });
    this.peer.on('error', err => {
      if (err.type === 'peer-unavailable') return;
      this._setStatus('error', err.type);
    });
    this.peer.on('disconnected', () => { this._setStatus('reconnecting'); try { this.peer.reconnect(); } catch {} });
    this._startHeartbeat();
  },

  _onHostData(conn, msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'ping') { try { conn.send({ t:'pong', n: msg.n, h: Date.now() }); } catch {} return; }
    if (msg.t === 'voiceon') { this.emit('data', msg, conn.peer); return; }
    this.emit('data', msg, conn.peer);
  },

  /* ---------------- 클라이언트 ---------------- */
  joinRoom(code) {
    this.isHost = false;
    this.code = code;
    return new Promise((resolve, reject) => {
      let settled = false;
      const p = new Peer({ config: ICE, debug: 0 });
      this.peer = p;
      const fail = m => { if (!settled) { settled = true; reject(new Error(m)); } };
      const to = setTimeout(() => fail('연결 시간이 초과됐습니다. 방 코드를 확인하거나 다시 시도해 주세요.'), 20000);

      p.on('open', () => {
        const conn = p.connect(NET_PREFIX + code, { reliable: true, metadata: { uid: this.uid } });
        this.hostConn = conn;
        const to2 = setTimeout(() => fail('방에 연결하지 못했습니다. 호스트가 방을 닫았을 수 있어요.'), 18000);
        conn.on('open', () => {
          clearTimeout(to); clearTimeout(to2);
          settled = true;
          this._setStatus('connected');
          this._startHeartbeat();
          resolve(conn);
        });
        conn.on('data', d => {
          if (d && d.t === 'pong') {
            const rtt = Date.now() - d.n;
            this.pingMs = rtt; this._lastPong = Date.now();
            // RTT가 가장 짧았던 샘플로 시계 오프셋 추정 (지연이 적을수록 정확)
            if (rtt <= this._bestRtt) { this._bestRtt = rtt; this.clockOffset = (d.h + rtt / 2) - Date.now(); }
            return;
          }
          this.emit('data', d, 'host');
        });
        conn.on('close', () => { this._setStatus('closed'); this.emit('hostgone'); });
        conn.on('error', () => fail('연결 오류가 발생했습니다.'));
      });
      p.on('error', err => {
        clearTimeout(to);
        if (err.type === 'peer-unavailable') fail('그런 방이 없습니다. 코드를 다시 확인해 주세요.');
        else if (err.type === 'network' || err.type === 'server-error') fail('네트워크에 연결할 수 없습니다.');
        else if (!settled) fail('연결 실패: ' + err.type);
      });
      p.on('disconnected', () => { this._setStatus('reconnecting'); try { p.reconnect(); } catch {} });
    });
  },

  /* ---------------- 송신 ---------------- */
  /** 클라 → 호스트 */
  toHost(t, d) {
    if (this.isHost) { this.emit('data', { t, ...d }, 'self'); return; }
    if (this.hostConn && this.hostConn.open) { try { this.hostConn.send({ t, ...d }); } catch {} }
  },
  /** 호스트 → 전원.
   *  _s:1 = 서버발 표식. 브로드캐스트는 호스트 자신에게도 emit 되므로,
   *  이 표식이 없으면 Host 가 자기 브로드캐스트를 클라이언트 요청으로
   *  오인해 무한 재귀에 빠질 수 있다 (타입명이 겹칠 때). */
  broadcast(t, d) {
    const msg = { t, ...d, _s: 1 };
    for (const c of this.conns.values()) if (c.open) { try { c.send(msg); } catch {} }
    this.emit('data', msg, 'self');           // 호스트 자신도 처리
  },
  /** 호스트 → 특정 peer */
  toPeer(peerId, t, d) {
    const msg = { t, ...d, _s: 1 };
    if (peerId === 'self' || peerId === this.peer?.id) { this.emit('data', msg, 'self'); return; }
    const c = this.conns.get(peerId);
    if (c && c.open) { try { c.send(msg); } catch {} }
  },

  /* ---------------- 하트비트 ---------------- */
  _startHeartbeat() {
    clearInterval(this._hb);
    this._lastPong = Date.now();
    const beat = () => {
      if (this.isHost) return;
      if (this.hostConn && this.hostConn.open) {
        try { this.hostConn.send({ t: 'ping', n: Date.now() }); } catch {}
        if (Date.now() - this._lastPong > 15000) this._setStatus('laggy');
        else if (this.status === 'laggy') this._setStatus('connected');
      }
    };
    // 접속 직후 시계 동기화를 빠르게 수렴시킨다
    [0, 250, 600, 1200, 2200].forEach(d => setTimeout(beat, d));
    this._hb = setInterval(beat, 3000);
  },

  peerCount() { return this.isHost ? this.conns.size : (this.hostConn?.open ? 1 : 0); },

  destroy() {
    clearInterval(this._hb);
    try { this.peer?.destroy(); } catch {}
    this.peer = null; this.conns.clear(); this.hostConn = null; this.isHost = false;
  },
};

/* ============================================================================
 *  음성 채팅 (선택) · 근접 음성 + 회의 음성
 *  대부분 음성을 못 쓰는 환경이므로 기본 OFF, 켠 사람끼리만 메시 연결
 * ==========================================================================*/
const Voice = {
  enabled: false,
  stream: null,
  calls: new Map(),        // peerId -> MediaConnection
  nodes: new Map(),        // peerId -> {audio, panner, gain, ctx}
  ctx: null,
  pushToTalk: true,
  talking: false,
  onLevel: null,

  async enable() {
    if (this.enabled) return true;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저는 마이크를 지원하지 않습니다.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.enabled = true;
    this.setTalking(!this.pushToTalk);
    // 수신 대기
    Net.peer?.on('call', call => {
      call.answer(this.stream);
      this._bind(call);
    });
    return true;
  },

  setTalking(on) {
    this.talking = on;
    this.stream?.getAudioTracks().forEach(t => { t.enabled = on; });
  },

  callPeer(peerId) {
    if (!this.enabled || !peerId || this.calls.has(peerId) || peerId === Net.peer?.id) return;
    try {
      const call = Net.peer.call(peerId, this.stream);
      if (call) this._bind(call);
    } catch {}
  },

  _bind(call) {
    this.calls.set(call.peer, call);
    call.on('stream', remote => {
      const audio = new Audio();
      audio.srcObject = remote; audio.autoplay = true; audio.muted = false;
      audio.play().catch(() => {});
      const src = this.ctx.createMediaStreamSource(remote);
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
      panner.refDistance = 90; panner.maxDistance = 700; panner.rolloffFactor = 1.6;
      const gain = this.ctx.createGain();
      src.connect(panner); panner.connect(gain); gain.connect(this.ctx.destination);
      this.nodes.set(call.peer, { audio, panner, gain, src });
    });
    call.on('close', () => this._drop(call.peer));
    call.on('error', () => this._drop(call.peer));
  },

  _drop(peerId) {
    const n = this.nodes.get(peerId);
    if (n) { try { n.audio.srcObject = null; n.src.disconnect(); } catch {} this.nodes.delete(peerId); }
    this.calls.delete(peerId);
  },

  /** 위치 기반 공간 음향 갱신. meeting=true면 거리 무시 */
  update(listener, positions, meeting, deadSet, iAmDead) {
    if (!this.enabled || !this.ctx) return;
    if (this.ctx.listener.positionX) {
      this.ctx.listener.positionX.value = listener.x; this.ctx.listener.positionZ.value = listener.y;
      this.ctx.listener.positionY.value = 0;
    } else if (this.ctx.listener.setPosition) this.ctx.listener.setPosition(listener.x, 0, listener.y);

    for (const [peerId, n] of this.nodes) {
      const p = positions[peerId];
      // 유령의 목소리는 산 사람에게 들리지 않는다
      const speakerDead = deadSet.has(peerId);
      const audible = iAmDead ? true : !speakerDead;
      n.gain.gain.value = audible ? 1 : 0;
      if (meeting || !p) {
        if (n.panner.positionX) { n.panner.positionX.value = listener.x; n.panner.positionZ.value = listener.y; }
        else n.panner.setPosition(listener.x, 0, listener.y);
      } else {
        if (n.panner.positionX) { n.panner.positionX.value = p.x; n.panner.positionZ.value = p.y; }
        else n.panner.setPosition(p.x, 0, p.y);
      }
    }
  },

  disable() {
    this.stream?.getTracks().forEach(t => t.stop());
    for (const id of [...this.calls.keys()]) { try { this.calls.get(id).close(); } catch {} this._drop(id); }
    try { this.ctx?.close(); } catch {}
    this.enabled = false; this.stream = null; this.ctx = null;
  },
};
