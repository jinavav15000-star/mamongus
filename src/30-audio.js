/* ============================================================================
 *  마몽어스 · 효과음 (WebAudio 절차 생성 · 외부 파일 0)
 * ==========================================================================*/
const Sfx = {
  ctx: null, master: null,
  muted: (typeof localStorage !== 'undefined' && localStorage.getItem('duckus_sfx') === '0'),
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    } catch {}
  },
  setMuted(m) { this.muted = m; try { localStorage.setItem('duckus_sfx', m ? '0' : '1'); } catch {} },
  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); Bgm.kick(); },
  _env(node, t0, a, d, peak = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    node.connect(g); g.connect(this.master);
    return g;
  },
  tone(freq, dur = 0.12, type = 'sine', when = 0, slideTo = null, vol = 1) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    this._env(o, t0, 0.008, dur, vol);
    o.start(t0); o.stop(t0 + dur + 0.06);
  },
  noise(dur = 0.25, filterFreq = 900, vol = 0.7, sweepTo = null) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    src.connect(f);
    this._env(f, t0, 0.01, dur, vol);
    src.start(t0);
  },

  click()      { this.tone(880, 0.05, 'square', 0, 660, 0.35); },
  /** 사물함 끼익 + 쾅 */
  creak() {
    this.tone(280, 0.28, 'sawtooth', 0, 180, 0.18);
    this.tone(190, 0.2, 'sawtooth', 0.05, 240, 0.14);
    this.noise(0.06, 500, 0.5, 200);
    setTimeout(() => this.noise(0.08, 350, 0.6, 150), 380);   // 닫히는 쾅
  },
  /** 건초 부스럭 */
  rustle() { this.noise(0.16, 2600, 0.4, 900); this.noise(0.12, 1900, 0.3, 700); },
  /** 인사 — 밝게 두 번 통통 */
  wave() { this.tone(620, 0.07, 'triangle', 0, 780, 0.4); this.tone(780, 0.09, 'triangle', 0.09, 990, 0.4); },
  /** 방귀 — 낮은 톱니파가 떨리며 내려간다. 대기실 장난용 */
  fart() {
    this.tone(140, 0.09, 'sawtooth', 0,    95, 0.5);
    this.tone(110, 0.13, 'sawtooth', 0.07, 70, 0.55);
    this.tone(85,  0.22, 'sawtooth', 0.16, 45, 0.5);
    this.noise?.(0.28, 300, 0.25, 120);
  },
  /** 발소리 — 흙 밟는 낮은 톡. 좌우 발을 번갈아 살짝 다른 음으로 */
  _stepFlip: false,
  step() {
    this._stepFlip = !this._stepFlip;
    this.noise(0.05, this._stepFlip ? 480 : 380, 0.16, 160);
    this.tone(this._stepFlip ? 130 : 110, 0.045, 'sine', 0, 70, 0.1);
  },
  taskStep()   { this.tone(660, 0.08, 'triangle', 0, 880, 0.5); },
  taskDone()   { [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, 'triangle', i * 0.07, null, 0.45)); this.bell(1046, 0.2, 0.3); },
  /** 킬 — 휙(고역 노이즈) + 퍽(저역 타격) + 잔울림 */
  kill() {
    this.noise(0.12, 5200, 0.7, 2400);                       // 휙
    this.tone(180, 0.16, 'sine', 0.05, 50, 0.9);             // 퍽
    this.noise(0.4, 900, 0.5, 90);                           // 먼지
    this.tone(72, 0.5, 'sine', 0.08, 46, 0.5);               // 몸이 쓰러지는 울림
  },
  /** 진짜 종처럼 — 비정수배 배음(1, 2.4, 3.9, 5.4배)을 함께 울린다 */
  bell(base = 523, when = 0, vol = 0.5) {
    if (!this.ctx || this.muted) return;
    [[1, 1], [2.4, 0.45], [3.9, 0.22], [5.4, 0.1]].forEach(([m, v]) => {
      const t0 = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.setValueAtTime(base * m, t0);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol * v, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1 / m);   // 높은 배음일수록 빨리 죽는다
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + 1.3);
    });
  },
  bodyFound()  { this.bell(659, 0, 0.55); this.bell(659, 0.55, 0.5); this.bell(523, 1.1, 0.45); },
  meeting()    { this.bell(523, 0, 0.5); this.bell(659, 0.4, 0.45); },
  vote()       { this.tone(1046, 0.09, 'square', 0, 1318, 0.4); },
  eject()      { this.tone(300, 1.0, 'sine', 0, 60, 0.5); this.noise(0.9, 500, 0.4, 80); },
  vent()       { this.noise(0.3, 700, 0.6, 200); this.tone(240, 0.22, 'sine', 0, 90, 0.35); },
  sabotage()   { for (let i = 0; i < 3; i++) { this.tone(700, 0.22, 'sawtooth', i * 0.3, 420, 0.5); } },
  alarm()      { this.tone(880, 0.3, 'square', 0, 500, 0.45); this.tone(880, 0.3, 'square', 0.45, 500, 0.45); },
  fixed()      { [784, 1046].forEach((f, i) => this.tone(f, 0.16, 'triangle', i * 0.1, null, 0.5)); },
  win()        { [523, 659, 784].forEach((f, i) => this.tone(f, 0.28, 'triangle', i * 0.11, null, 0.45)); this.bell(1046, 0.34, 0.5); this.bell(1318, 0.5, 0.4); },
  lose()       { [392, 330, 294].forEach((f, i) => this.tone(f, 0.4, 'triangle', i * 0.2, null, 0.4)); this.tone(262, 0.8, 'sine', 0.6, 240, 0.4); },
  chat()       { this.tone(1200, 0.05, 'sine', 0, 1600, 0.22); },
  alert()      { this.tone(1400, 0.07, 'square', 0, 1000, 0.3); this.tone(1000, 0.07, 'square', 0.09, 1400, 0.3); },
  quack()      { this.tone(420, 0.1, 'sawtooth', 0, 260, 0.4); this.tone(300, 0.09, 'square', 0.09, 190, 0.3); },
};


/* ============================================================================
 *  배경음악 — 파일 없이 코드로 연주한다 (용량 0)
 *  · lobby   목가풍 오르골 루프 (펜타토닉이라 어떤 조합도 안 어긋난다)
 *  · play    밤 분위기 (바람 + 귀뚜라미 + 아주 드문 저음)
 *  · meeting 긴장 맥박
 *  녹음 파일을 쓰지 않는 이유: 30초 루프 하나가 350KB+ 라
 *  게임 전체(480KB)만큼 커진다. 카톡 로딩이 곧 첫인상이다.
 * ==========================================================================*/
const Bgm = {
  bus: null, want: null, playing: null,
  enabled: (typeof localStorage !== 'undefined' && localStorage.getItem('duckus_bgm') !== '0'),
  _timer: null, _next: 0, _step: 0, _nodes: [],

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('duckus_bgm', on ? '1' : '0'); } catch {}
    if (!on) this._silence(); else this.kick();
  },

  _ensure() {
    if (this.bus || !Sfx.ctx) return;
    this.bus = Sfx.ctx.createGain();
    this.bus.gain.value = 0.26;                    // 효과음보다 항상 뒤에 있어야 한다
    this.bus.connect(Sfx.ctx.destination);
  },

  /** 원하는 트랙을 기억해 두고, 오디오가 가능해지는 순간 시작한다 */
  play(name) {
    this.want = name;
    this.kick();
  },
  stop() { this.want = null; this._silence(); },

  kick() {
    if (!this.enabled || !this.want) return;
    if (!Sfx.ctx || Sfx.ctx.state !== 'running') return;   // 첫 터치 전 — resume() 이 다시 불러 준다
    this._ensure();
    if (this.playing === this.want) return;
    this._silence();
    this.playing = this.want;
    this._step = 0;
    this._next = Sfx.ctx.currentTime + 0.06;
    if (this.playing === 'play') this._startAmbience();
    this._timer = setInterval(() => this._tick(), 90);
  },

  _silence() {
    clearInterval(this._timer); this._timer = null;
    for (const n of this._nodes) { try { n.stop ? n.stop() : n.disconnect(); } catch {} }
    this._nodes = [];
    this.playing = null;
  },

  /* ---- 악기 ---- */
  _pluck(freq, t0, vol = 1, dur = 0.5) {           // 오르골 느낌
    const c = Sfx.ctx;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16 * vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const g2 = c.createGain(); g2.gain.value = 0.35;
    o2.connect(g2); g2.connect(g); o.connect(g); g.connect(this.bus);
    o.start(t0); o.stop(t0 + dur + 0.05); o2.start(t0); o2.stop(t0 + dur + 0.05);
  },
  _bass(freq, t0, dur = 0.8) {
    const c = Sfx.ctx;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.bus);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  _tick2(t0) {                                     // 나무 블록 (말발굽 같은)
    const c = Sfx.ctx;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    o.connect(g); g.connect(this.bus);
    o.start(t0); o.stop(t0 + 0.08);
  },

  /* ---- 악보 ----
   * G 장조 펜타토닉 (G A B D E). 16분음표 32스텝 × 2절.
   * 0 = 쉼표. 저음은 4스텝(한 박)마다. */
  _SONG: {
    mel: [
      392,0,494,0, 587,0,494,587, 659,0,587,0, 494,0,392,0,
      440,0,494,440, 392,0,294,0, 330,0,392,330, 294,0,0,0,
      392,0,494,0, 587,0,659,0, 784,0,659,587, 494,0,587,0,
      659,587,494,0, 440,0,494,440, 392,0,330,294, 392,0,0,0,
    ],
    bass: [98, 98, 73.4, 73.4, 87.3, 87.3, 98, 98, 98, 98, 73.4, 73.4, 87.3, 65.4, 98, 98],
  },

  _tick() {
    if (!Sfx.ctx || Sfx.ctx.state !== 'running') return;
    const now = Sfx.ctx.currentTime;
    const spb = this.playing === 'meeting' ? 0.24 : 0.156;   // 스텝 길이 (로비 ≈ 96BPM)
    while (this._next < now + 0.28) {                        // 0.28초 앞까지 예약
      const t = this._next, i = this._step;
      if (this.playing === 'lobby') {
        const n = this._SONG.mel[i % 64];
        if (n) this._pluck(n, t, 1, 0.42);
        if (i % 4 === 0) this._bass(this._SONG.bass[(i / 4 | 0) % 16], t, 0.7);
        if (i % 8 === 4) this._tick2(t);
      } else if (this.playing === 'meeting') {
        if (i % 4 === 0) this._bass(i % 8 === 0 ? 82.4 : 77.8, t, 0.5);   // 심장 박동처럼
        if (i % 8 === 6) this._tick2(t);
      } else if (this.playing === 'play') {
        // 귀뚜라미 — 드문드문
        if (Math.random() < 0.06) {
          const f = 4200 + Math.random() * 800;
          for (let k = 0; k < 3; k++) {
            const o = Sfx.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
            const g = Sfx.ctx.createGain();
            const tt = t + k * 0.05;
            g.gain.setValueAtTime(0.0001, tt);
            g.gain.exponentialRampToValueAtTime(0.012, tt + 0.008);
            g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.04);
            o.connect(g); g.connect(this.bus); o.start(tt); o.stop(tt + 0.06);
          }
        }
      }
      this._next += spb; this._step++;
    }
  },

  /** 게임 중 상시 배경 — 낮게 웅웅대는 바람 */
  _startAmbience() {
    const c = Sfx.ctx;
    const n = c.sampleRate * 2;
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + (Math.random() * 2 - 1) * 0.02) * 0.995; d[i] = last * 3; }
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240;
    const g = c.createGain(); g.gain.value = 0.5;
    src.connect(f); f.connect(g); g.connect(this.bus);
    src.start();
    this._nodes.push(src, g);
  },
};
