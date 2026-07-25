/* ============================================================================
 *  마몽어스 · 효과음 (WebAudio 절차 생성 · 외부 파일 0)
 *
 *  ★ 소리를 다시 만든 이유 (2026-07-25)
 *  예전에는 전부 오실레이터(사인·사각파)였다. 순음은 귀에 곧바로 '전자음'으로 들려서,
 *  공들여 그린 목장 그림 위에 삐— 소리가 얹히는 꼴이었다. 세 가지 원칙으로 다시 만들었다.
 *
 *   1) 실제 물체 소리는 「노이즈 + 공명」이다.
 *      발소리·부스럭·문 삐걱은 노이즈를 필터에 통과시켜 만든다 (_grain)
 *   2) 같은 소리도 매번 조금씩 달라야 한다.
 *      똑같은 파형이 반복되면 사람은 즉시 '기계'로 알아듣는다 (_rnd · 버퍼 임의 위치)
 *   3) 울음소리는 「성대 + 포먼트」다.
 *      톱니파를 공명 3개에 통과시키고 초당 15번 떨면 양이 된다 (bleat)
 *
 *  녹음 파일을 쓰지 않는 이유는 여전히 용량이다. 효과음 20종을 녹음으로 넣으면 2MB가
 *  넘는다 — 게임 전체(586KB)보다 크다. 카톡에서의 로딩 시간이 곧 첫인상이다.
 *
 *  ⚠️ tone() / noise() 는 미니게임 18종이 직접 쓴다. 시그니처를 바꾸지 말 것.
 * ==========================================================================*/
const Sfx = {
  ctx: null, master: null,
  muted: (typeof localStorage !== 'undefined' && localStorage.getItem('duckus_sfx') === '0'),
  _bufs: {},
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
  _rnd(a, b) { return a + Math.random() * (b - a); },

  /* ══════════ 저수준 엔진 ══════════ */

  /** 노이즈 버퍼 캐시.
   *  ⚠️ 예전엔 소리마다 새 버퍼를 만들었다 — 발소리 한 번에 수만 개 float 할당이라
   *     저사양 폰에서 걸음마다 미세하게 끊겼다. 2초짜리를 한 번만 만들고 재사용한다.
   *   white = 쨍한 것(돌·타일)  ·  pink = 자연스러운 것(짚·풀)  ·  brown = 묵직한 것(흙·쿵) */
  _noiseBuf(kind = 'pink') {
    if (this._bufs[kind]) return this._bufs[kind];
    const c = this.ctx, n = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === 'white') {
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } else if (kind === 'brown') {
      let last = 0;
      for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    } else {
      // 핑크 노이즈(Paul Kellet 근사) — 자연의 소리는 대개 핑크에 가깝다
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.3;
      }
    }
    this._bufs[kind] = buf;
    return buf;
  },

  /** 노이즈 한 조각을 필터에 통과시킨다 = '물체가 낸 소리' 한 번.
   *  버퍼의 임의 위치에서 잘라 쓰므로 부를 때마다 미세하게 다른 소리가 난다. */
  _grain(o = {}) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime + (o.when || 0);
    const dur = o.dur ?? 0.1, atk = o.atk ?? 0.004, vol = o.vol ?? 0.3;
    const src = c.createBufferSource();
    src.buffer = this._noiseBuf(o.noise || 'pink');
    src.playbackRate.value = o.rate ?? 1;
    const f = c.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 900, t0);
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweep), t0 + dur);
    f.Q.value = o.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0, Math.random() * 1.5, dur + atk + 0.05);
  },

  /** 공명체 — 나무·금속처럼 '뎅' 하고 울리는 몸통.
   *  배음비가 정수(1:2:3)면 악기가 되고, 어긋나면(1:2.76:5.4) 물체가 된다. */
  _body(freq, o = {}) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime + (o.when || 0);
    const parts = o.parts || [[1, 1], [2.76, 0.34], [5.4, 0.11]];
    const dur = o.dur ?? 0.3, vol = o.vol ?? 0.3;
    for (const [m, v] of parts) {
      const osc = c.createOscillator();
      osc.type = o.wave || 'sine';
      osc.frequency.setValueAtTime(freq * m, t0);
      if (o.bend) osc.frequency.exponentialRampToValueAtTime(Math.max(25, freq * m * o.bend), t0 + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol * v, t0 + 0.004);
      // 높은 배음일수록 빨리 사라진다 — 실제 물체가 그렇다
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur / Math.sqrt(m));
      osc.connect(g); g.connect(this.master);
      osc.start(t0); osc.stop(t0 + dur + 0.1);
    }
  },

  /** 금속 — 배음이 더 어긋나고 길게 남는다 (종·양철·경보) */
  _metal(freq, o = {}) {
    this._body(freq, { parts: [[1, 1], [1.52, 0.6], [2.13, 0.42], [2.97, 0.25], [4.1, 0.14]],
                       dur: o.dur ?? 1.0, vol: o.vol ?? 0.3, when: o.when || 0 });
    this._grain({ noise:'white', freq: freq * 4, q: 1.2, dur: 0.03, vol: (o.vol ?? 0.3) * 0.5,
                  when: o.when || 0 });     // 때리는 순간의 '깡'
  },

  /* ══════════ 옛 API (미니게임이 쓴다 — 시그니처 고정) ══════════ */
  _env(node, t0, a, d, peak = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    node.connect(g); g.connect(this.master);
    return g;
  },
  /** 순음. 사각·톱니파는 저역통과를 한 겹 씌워 찢어지는 고역만 깎는다
   *  (미니게임 오답음이 귀를 찌르던 원인) */
  tone(freq, dur = 0.12, type = 'sine', when = 0, slideTo = null, vol = 1) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    let node = o;
    if (type === 'square' || type === 'sawtooth') {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(Math.max(900, freq * 4), t0); lp.Q.value = 0.7;
      o.connect(lp); node = lp;
    }
    this._env(node, t0, 0.008, dur, vol);
    o.start(t0); o.stop(t0 + dur + 0.06);
  },
  noise(dur = 0.25, filterFreq = 900, vol = 0.7, sweepTo = null) {
    this._grain({ noise:'white', type:'lowpass', freq: filterFreq, sweep: sweepTo, dur, vol, q: 0.7, atk: 0.01 });
  },

  /* ══════════ 양 울음 ══════════ */
  /** "메에에—" · 성대(톱니파) → 포먼트 공명 3개 → 초당 15회 비브라토.
   *  비브라토가 이 소리의 정체다. 없으면 그냥 나팔 소리가 된다.
   *  size 1 = 어른 양 / 1.25 = 새끼 양(작은 몸통 = 높은 포먼트) */
  bleat(o = {}) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t0 = c.currentTime + (o.when || 0);
    const dur = o.dur ?? 0.5, vol = o.vol ?? 0.3, size = o.size ?? 1;
    const f0 = o.f0 ?? this._rnd(290, 380);

    const src = c.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0 * 1.07, t0);
    src.frequency.exponentialRampToValueAtTime(f0 * (o.fall ?? 0.8), t0 + dur);

    // 떨림 — 양 울음의 핵심
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(o.vib ?? this._rnd(13, 17), t0);
    const lg = c.createGain();
    lg.gain.setValueAtTime(f0 * (o.vibDepth ?? 0.08), t0);
    lfo.connect(lg); lg.connect(src.frequency);
    lfo.start(t0); lfo.stop(t0 + dur + 0.1);

    // 좁은 포먼트 필터는 원음의 대부분을 버린다 — 그대로 두면 다른 소리보다 10배 작다
    // (실측 peak 0.013). 목소리 계열만 보정 이득을 곱해 다른 효과음과 눈높이를 맞춘다.
    const MAKEUP = 7;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(vol * MAKEUP, t0 + Math.min(0.04, dur * 0.2));
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    out.connect(this.master);
    // 모음 "메(mɛ)" 의 포먼트 3개
    for (const [ff, fq, fv] of [[600, 6, 1], [1700, 8, 0.5], [2550, 10, 0.2]]) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(ff * size, t0);
      bp.Q.value = fq;
      const g = c.createGain(); g.gain.value = fv;
      src.connect(bp); bp.connect(g); g.connect(out);
    }
    src.start(t0); src.stop(t0 + dur + 0.1);
    this._grain({ noise:'pink', freq: 2000, q: 0.8, dur: dur * 0.45, vol: vol * 0.09, when: o.when || 0 });
  },

  /* ══════════ 발소리 ══════════ */
  /** 바닥 재질별 발소리 파라미터. 방 정의의 floor 값과 짝이다 (복도는 자갈).
   *  thump = 발이 바닥을 누르는 저역, wood = 널빤지 울림, grit = 자갈 알갱이 */
  /** ⚠️ 대역통과(bandpass)는 그 주파수 근처만 남긴다. 갈색 노이즈는 저역에만 에너지가
   *  있어서 430Hz 대역통과에 물리면 소리가 거의 사라진다 (실측 peak 0.007 — 흙을 밟으면
   *  발소리가 실종됐다). 묵직한 바닥은 저역통과(lowpass)로 저역을 통째로 살린다. */
  FLOOR_SFX: {
    straw:    { noise:'pink',  type:'bandpass', freq:2700, q:0.7, dur:0.09,  vol:0.30, sweep:1100, thump:0   },
    dirt:     { noise:'brown', type:'lowpass',  freq:520,  q:0.7, dur:0.06,  vol:0.42, sweep:190,  thump:104 },
    soil:     { noise:'brown', type:'lowpass',  freq:430,  q:0.7, dur:0.07,  vol:0.42, sweep:160,  thump:92  },
    grass:    { noise:'pink',  type:'bandpass', freq:1750, q:0.8, dur:0.075, vol:0.28, sweep:820,  thump:78  },
    plank:    { noise:'pink',  type:'bandpass', freq:950,  q:2.0, dur:0.05,  vol:0.40, sweep:520,  thump:196, wood:true },
    stone:    { noise:'white', type:'bandpass', freq:2300, q:1.6, dur:0.04,  vol:0.26, sweep:1400, thump:148 },
    concrete: { noise:'white', type:'bandpass', freq:2000, q:1.4, dur:0.038, vol:0.26, sweep:1200, thump:132 },
    tile:     { noise:'white', type:'bandpass', freq:3200, q:2.2, dur:0.035, vol:0.30, sweep:2000, thump:172 },
    gravel:   { noise:'white', type:'bandpass', freq:1600, q:0.6, dur:0.07,  vol:0.34, sweep:600,  thump:100, grit:true },
  },
  _stepFlip: false,
  /** 발소리 — 지금 밟고 있는 바닥에 따라 다른 소리가 난다.
   *  짚은 바스락, 널빤지는 통통, 자갈길은 자박자박. 좌우 발도 미세하게 다르다. */
  step(x, y) {
    if (!this.ctx || this.muted) return;
    let mat = 'gravel';
    if (x != null && typeof roomIdAt === 'function') {
      const rid = roomIdAt(x, y);
      if (rid) mat = ROOMS.find(r => r.id === rid)?.floor || 'dirt';
    }
    const S = this.FLOOR_SFX[mat] || this.FLOOR_SFX.dirt;
    this._stepFlip = !this._stepFlip;
    const p = (this._stepFlip ? 1 : 0.9) * this._rnd(0.94, 1.08);   // 좌우 발 + 매 걸음 흔들림
    const v = this._rnd(0.85, 1.1);

    if (S.grit) {                       // 자갈 — 알갱이 여러 개가 동시에 눌린다
      for (let i = 0; i < 3; i++)
        this._grain({ noise:S.noise, type:S.type, freq: S.freq * p * this._rnd(0.7, 1.4), q: S.q,
                      dur: S.dur * this._rnd(0.4, 0.8), vol: S.vol * v * 0.6,
                      sweep: S.sweep, when: i * this._rnd(0.004, 0.014) });
    } else {
      this._grain({ noise:S.noise, type:S.type, freq: S.freq * p, q: S.q, dur: S.dur,
                    vol: S.vol * v, sweep: S.sweep * p });
    }
    if (S.thump) this._grain({ noise:'brown', type:'lowpass', freq: S.thump * p * 2.2, q: 0.7,
                               dur: 0.05, vol: 0.5 * v });
    if (S.wood) this._body(S.thump * p, { parts:[[1,1],[2.4,0.3]], dur: 0.07, vol: 0.05 * v });
  },

  /* ══════════ 목장의 물건들 ══════════ */
  /** 나무 문/사물함 — 삐걱(경첩이 걸렸다 미끄러졌다 하는 소리) 뒤 쾅.
   *  삐걱은 순음이 아니라 '공명 주파수가 제멋대로 튀는 노이즈'다. */
  creak() {
    let t = 0;
    for (let i = 0; i < 6; i++) {
      // 경첩이 걸렸다 미끄러지는 소리 = 공명 주파수가 조각마다 다르고, 조각 안에서도 미끄러진다
      const f = this._rnd(420, 1500);
      this._grain({ noise:'pink', freq: f, sweep: f * this._rnd(0.55, 1.7), q: this._rnd(9, 18),
                    dur: this._rnd(0.05, 0.1), vol: this._rnd(0.1, 0.2), when: t });
      t += this._rnd(0.035, 0.075);
    }
    // 닫히는 쾅 — setTimeout 이 아니라 오디오 시계에 예약한다 (타이밍이 흔들리지 않는다)
    this._grain({ noise:'brown', type:'lowpass', freq: 280, sweep: 90, dur: 0.1, vol: 0.4, when: 0.38 });
    this._body(150, { parts:[[1,1],[2.9,0.3],[4.7,0.12]], dur: 0.16, vol: 0.22, when: 0.38 });
  },
  /** 건초 부스럭 — 마른 줄기 여러 가닥이 한꺼번에 쓸린다 */
  rustle() {
    for (let i = 0; i < 3; i++)
      this._grain({ noise:'pink', freq: this._rnd(1900, 3400), q: this._rnd(0.5, 1.2),
                    dur: this._rnd(0.1, 0.2), vol: this._rnd(0.12, 0.22),
                    sweep: this._rnd(600, 1100), when: i * this._rnd(0.01, 0.05) });
  },
  /** 벤트 = 짚더미 아래 나무 뚜껑 — 짧은 삐걱 + 통 울림 + 짚 스치는 소리 */
  vent() {
    this._grain({ noise:'pink', freq: this._rnd(600, 1100), q: 12, dur: 0.12, vol: 0.16 });
    this._body(128, { parts:[[1,1],[2.7,0.35],[4.4,0.12]], dur: 0.26, vol: 0.2, when: 0.05 });
    this._grain({ noise:'pink', freq: 2600, q: 0.7, dur: 0.18, vol: 0.13, sweep: 900, when: 0.06 });
  },
  /** 헛간 종 — 두꺼운 쇠종. 배음이 어긋나야 '종'으로 들린다 */
  bell(base = 523, when = 0, vol = 0.5) {
    if (!this.ctx || this.muted) return;
    this._grain({ noise:'white', freq: base * 3.4, q: 1.4, dur: 0.035, vol: vol * 0.42, when });
    [[1, 1], [2.4, 0.45], [3.9, 0.22], [5.4, 0.1]].forEach(([m, v]) => {
      const t0 = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.setValueAtTime(base * m, t0);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol * v, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1 / m);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + 1.3);
    });
  },

  /* ══════════ 게임 이벤트 ══════════ */
  click()    { this._grain({ noise:'pink', freq: 1900, q: 5, dur: 0.028, vol: 0.22 });
               this._body(760, { parts:[[1,1],[2.8,0.2]], dur: 0.05, vol: 0.09 }); },
  chat()     { this._grain({ noise:'pink', freq: 1500, q: 4, dur: 0.03, vol: 0.14 });
               this.tone(1100, 0.05, 'sine', 0, 1500, 0.16); },
  wave()     { this._body(620, { parts:[[1,1],[2.1,0.3]], dur: 0.12, vol: 0.2 });
               this._body(830, { parts:[[1,1],[2.1,0.3]], dur: 0.14, vol: 0.2, when: 0.1 }); },
  /** 방귀 — 대기실 장난.
   *  실제 방귀는 음이 아니라 「살이 파닥이며 공기를 끊는 소리」다. 세 겹으로 만든다.
   *   1) 떨림(톱니파)의 음정이 불안정하게 출렁인다        ← 기계가 아니라 몸이 내는 소리
   *   2) 그 소리가 초당 20~35번 끊긴다 (진폭 변조)        ← '뿌르륵'의 정체
   *   3) 살집 공명으로 고역이 죽는다 (저역통과 + 공진)     ← '삑'이 아니라 '뿡'이 되는 이유
   *  길이·음높이·끊김이 매번 달라서 같은 방귀가 두 번 나오지 않는다. */
  fart() {
    if (!this.ctx || this.muted) return;
    const dur = this._rnd(0.34, 0.62);
    const f0 = this._rnd(76, 116);
    this._brap(0, dur, f0, this._rnd(0.92, 1.12));
    // 가끔 여운 한 방 더 — "뿌웅… 뽕"
    if (Math.random() < 0.32)
      this._brap(dur + this._rnd(0.05, 0.15), this._rnd(0.09, 0.19), f0 * this._rnd(0.8, 1.35), 0.72);
  },

  /** 방귀 한 번의 실체 (when = 지금부터 몇 초 뒤) */
  _brap(when, dur, f0, vol) {
    const c = this.ctx, t0 = c.currentTime + when;

    const src = c.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0 * 1.28, t0);                 // 처음에 '뿡' 하고 튀었다가
    src.frequency.exponentialRampToValueAtTime(f0 * 0.6, t0 + dur);  // 힘이 빠지며 내려간다

    // ① 음정 출렁임 — 살은 일정한 속도로 떨리지 못한다
    const wob = c.createOscillator(); wob.type = 'sine';
    wob.frequency.setValueAtTime(this._rnd(5, 11), t0);
    const wobG = c.createGain(); wobG.gain.setValueAtTime(f0 * 0.3, t0);
    wob.connect(wobG); wobG.connect(src.frequency);

    // ② 끊김 — 진폭이 초당 20~35번 열렸다 닫힌다. 끝으로 갈수록 느슨해진다
    const am = c.createGain(); am.gain.setValueAtTime(0.55, t0);
    const flut = c.createOscillator(); flut.type = 'triangle';
    flut.frequency.setValueAtTime(this._rnd(21, 34), t0);
    flut.frequency.exponentialRampToValueAtTime(this._rnd(9, 15), t0 + dur);
    const flutG = c.createGain(); flutG.gain.setValueAtTime(0.45, t0);
    flut.connect(flutG); flutG.connect(am.gain);

    // ③ 살집 공명
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1100, t0);
    lp.frequency.exponentialRampToValueAtTime(270, t0 + dur);
    lp.Q.value = 4.5;

    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.6 * vol, t0 + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(am); am.connect(lp); lp.connect(env); env.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.05);
    wob.start(t0); wob.stop(t0 + dur + 0.05);
    flut.start(t0); flut.stop(t0 + dur + 0.05);

    // 바람 새는 소리 한 줌
    this._grain({ noise:'brown', type:'lowpass', freq: 540, sweep: 170,
                  dur: dur * 0.85, vol: 0.2 * vol, when });
  },
  taskStep() { this._grain({ noise:'pink', freq: 1500, q: 6, dur: 0.03, vol: 0.2 });
               this._body(520, { parts:[[1,1],[2.7,0.25]], dur: 0.1, vol: 0.14 }); },
  /** 임무 완료 — 나무 실로폰 3음 + 작은 종 */
  taskDone() {
    [523, 659, 784].forEach((f, i) =>
      this._body(f, { parts:[[1,1],[3.9,0.22],[9.2,0.06]], dur: 0.34, vol: 0.24, when: i * 0.075 }));
    this.bell(1046, 0.2, 0.26);
  },
  /** 살해 — 끊긴 울음 + 쓰러지는 둔탁한 소리 + 흙먼지 */
  kill() {
    this.bleat({ dur: 0.14, vol: 0.3, f0: 350, fall: 0.55, vib: 20 });
    this._grain({ noise:'white', freq: 4200, q: 0.8, dur: 0.09, vol: 0.3, sweep: 1200 });
    this._body(66, { parts:[[1,1],[2.3,0.3]], dur: 0.5, vol: 0.4, when: 0.06 });
    this._grain({ noise:'brown', type:'lowpass', freq: 400, sweep: 80, dur: 0.42, vol: 0.3, when: 0.06 });
  },
  bodyFound() { this.bell(659, 0, 0.55); this.bell(659, 0.55, 0.5); this.bell(523, 1.1, 0.45); },
  meeting()   { this.bell(523, 0, 0.5); this.bell(659, 0.4, 0.45); },
  vote()      { this._body(880, { parts:[[1,1],[3.1,0.25]], dur: 0.09, vol: 0.24 });
                this._grain({ noise:'pink', freq: 2200, q: 5, dur: 0.02, vol: 0.14 }); },
  /** 추방 — 나무 문이 삐걱 열리고, 멀어지며, 저 멀리서 울음 한 번 */
  eject() {
    for (let i = 0; i < 4; i++)
      this._grain({ noise:'pink', freq: this._rnd(400, 900), q: 14, dur: 0.12, vol: 0.14, when: i * 0.08 });
    this._grain({ noise:'brown', type:'lowpass', freq: 700, sweep: 60, dur: 0.9, vol: 0.34, when: 0.3 });
    this._body(120, { parts:[[1,1],[2.6,0.3]], dur: 0.7, vol: 0.22, bend: 0.4, when: 0.35 });
    this.bleat({ when: 0.75, dur: 0.5, vol: 0.1, f0: 300, size: 0.9 });
  },
  /** 사보타주 — 양철 지붕이 찌그러지는 듯한 금속 굉음 3연타 */
  sabotage() {
    for (let i = 0; i < 3; i++) {
      this._metal(this._rnd(210, 260), { dur: 0.55, vol: 0.26, when: i * 0.26 });
      this._grain({ noise:'white', freq: 1800, q: 0.8, dur: 0.18, vol: 0.2, sweep: 400, when: i * 0.26 });
    }
  },
  /** 경보 — 카우벨 두 번 (농장의 비상 신호) */
  alarm() {
    this._metal(540, { dur: 0.42, vol: 0.3 });
    this._metal(430, { dur: 0.5,  vol: 0.3, when: 0.2 });
  },
  fixed()    { this._body(784,  { parts:[[1,1],[3.9,0.2]], dur: 0.26, vol: 0.26 });
               this._body(1046, { parts:[[1,1],[3.9,0.2]], dur: 0.34, vol: 0.26, when: 0.1 }); },
  /** 승리 — 종 + 양떼가 함께 우는 소리 */
  win() {
    [523, 659, 784].forEach((f, i) =>
      this._body(f, { parts:[[1,1],[3.9,0.22],[9.2,0.06]], dur: 0.5, vol: 0.26, when: i * 0.11 }));
    this.bell(1046, 0.34, 0.42);
    this.bleat({ when: 0.5,  f0: 330, size: 1,    vol: 0.22 });
    this.bleat({ when: 0.66, f0: 400, size: 1.18, vol: 0.18 });
    this.bleat({ when: 0.84, f0: 290, size: 0.9,  vol: 0.2  });
  },
  /** 패배 — 낮은 종 + 힘없이 늘어지는 울음 */
  lose() {
    this._body(196, { parts:[[1,1],[2.4,0.4],[3.9,0.15]], dur: 1.1, vol: 0.3 });
    this._body(147, { parts:[[1,1],[2.4,0.4],[3.9,0.15]], dur: 1.4, vol: 0.28, when: 0.35 });
    this.bleat({ when: 0.55, f0: 250, dur: 0.9, fall: 0.55, vib: 9, vol: 0.2 });
  },
  alert()    { this._body(1250, { parts:[[1,1],[2.8,0.2]], dur: 0.1, vol: 0.24 });
               this._body(1000, { parts:[[1,1],[2.8,0.2]], dur: 0.12, vol: 0.24, when: 0.1 }); },
  /** 게임 시작 — 양떼가 한꺼번에 운다 */
  gameStart() {
    this.bleat({ f0: 340, vol: 0.26 });
    this.bleat({ when: 0.13, f0: 410, size: 1.2, vol: 0.2 });
    this.bleat({ when: 0.28, f0: 295, size: 0.92, vol: 0.22 });
  },
  quack() { this.gameStart(); },        // 옛 이름 (구스구스덕 시절 잔재)
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
        // 저 멀리 우리에서 양이 한 번 운다 (평균 40초에 한 번, 아주 작게)
        if (Math.random() < 0.004) {
          Sfx.bleat({ when: Math.max(0, t - Sfx.ctx.currentTime), vol: 0.045,
                      f0: 250 + Math.random() * 90, size: 0.85, dur: 0.6 });
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
