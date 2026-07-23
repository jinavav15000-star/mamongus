/* ============================================================================
 *  마몽어스 · 렌더러
 * ==========================================================================*/
/* roundRect 미지원 브라우저(구형 iOS Safari · 카톡 인앱) 대비 */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
    return this;
  };
}

const Render = {
  cv: null, g: null, W: 0, H: 0, scale: 1,
  cam: { x: 0, y: 0 },
  mapCv: null,
  visCache: { x: -9999, y: -9999, r: 0, poly: null },
  shake: 0,

  /* ---------------- 연출(파티클) ----------------
   * 월드 좌표계에 그린다. 안개보다 먼저 그리므로 벽 너머 연출은 저절로 가려진다.
   * 개수 상한을 두는 이유: 16명이 동시에 뛰면 파티클이 폭증해 저사양 폰이 끊긴다. */
  fx: [],
  stepT: {},                 // 플레이어별 다음 발자국 시각
  FX_MAX: 180,

  addFx(o) {
    if (this.fx.length >= this.FX_MAX) this.fx.splice(0, this.fx.length - this.FX_MAX + 1);
    this.fx.push({ t: o.delay ? -o.delay : 0, ...o });   // delay 는 음수 t 로 시작해 그동안 안 보인다
  },
  /** 걸을 때 발밑에서 피어오르는 흙먼지. dir 은 진행 방향(먼지는 뒤로 남는다) */
  dustAt(x, y, dir = 0) {
    for (let i = 0; i < 3; i++) this.addFx({
      kind:'dust', x: x + rnd(-7, 7) - dir * 6, y: y + rnd(13, 19),
      vx: rnd(-.3, .3) - dir * .35, vy: rnd(-.2, -.05), r: rnd(3.4, 6.4), life: rnd(400, 620),
    });
  },
  /** 임무를 끝냈을 때 터지는 반짝임 */
  sparkleAt(x, y, col = '#ffd23d') {
    this.addFx({ kind:'ring', x, y, r0: 14, r1: 62, life: 520, col });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * 6.283 + rnd(-.2, .2), sp = rnd(1.1, 2.4);
      this.addFx({ kind:'star', x, y: y - 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - .6,
                   r: rnd(2.4, 4.4), life: rnd(520, 820), col });
    }
  },
  /** 벤트를 타고 내려갈 때 뿜는 먼지 */
  puffAt(x, y, col = 'rgba(196,168,130,') {
    this.addFx({ kind:'ring', x, y, r0: 10, r1: 44, life: 420, col:'#c9a86a' });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.283;
      this.addFx({ kind:'dust', x, y, vx: Math.cos(a) * rnd(.5, 1.2), vy: Math.sin(a) * rnd(.3, .8),
                   r: rnd(5, 9), life: rnd(420, 700), soft: col });
    }
  },
  /** 방귀 💨 — 뒤로 자욱하게 퍼지는 초록 가스구름.
   *  뒤에 서 있는 캐릭터(~50px)가 연기에 뒤덮일 만큼 크고 오래 간다. */
  fartAt(x, y, dir = 1) {
    const back = -dir;
    // 1파: 엉덩이에서 터지는 진한 구름
    for (let i = 0; i < 14; i++) {
      this.addFx({ kind:'dust',
        x: x + back * rnd(4, 18), y: y + rnd(2, 14),
        vx: back * rnd(.5, 1.6), vy: rnd(-.55, -.05),
        r: rnd(6, 12), life: rnd(800, 1300),
        a0: .55, soft: 'rgba(150,195,95,' });
    }
    // 2파: 잠시 뒤 더 멀리 번지는 옅은 구름 (뒤에 선 상대를 뒤덮는다)
    for (let i = 0; i < 10; i++) {
      this.addFx({ kind:'dust', delay: rnd(140, 320),
        x: x + back * rnd(18, 42), y: y + rnd(-6, 14),
        vx: back * rnd(.3, .9), vy: rnd(-.4, .05),
        r: rnd(8, 15), life: rnd(900, 1500),
        a0: .4, soft: 'rgba(150,195,95,' });
    }
    this.addFx({ kind:'ring', x: x + back * 12, y: y + 8, r0: 8, r1: 46, life: 480, col: '#9cc46a' });
    this.addFx({ kind:'emoji', x: x + back * 6, y: y - 6, vx: back * .35, vy: -.75, r: 14, life: 1100, txt: '💨' });
    this.addFx({ kind:'emoji', delay: 260, x: x + back * 22, y: y + 2, vx: back * .3, vy: -.6, r: 11, life: 1000, txt: '💨' });
  },

  /** 사물함 문 활짝 → 쾅 (드나들 때, 근처 전원에게 보임) */
  doorSwing(x, y) {
    this.addFx({ kind:'door', x, y: y - 22, life: 480 });
  },

  /** 건초 들썩임 — 누가 드나들 때 더미가 눌렸다 튀어오른다 (근처 전원에게 보임) */
  hayBounce(x, y) {
    this.addFx({ kind:'hay', x, y, life: 520 });
  },

  /** 지푸라기 폭발 — 건초에 숨기·수색당해 튀어나올 때 */
  strawBurst(x, y, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, sp = rnd(.8, 2.4);
      this.addFx({ kind:'star', x, y: y - 4,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.1,
        r: rnd(2, 3.6), life: rnd(500, 850), col: '#e2c37a' });
    }
    this.addFx({ kind:'dust', x, y: y + 4, vx: 0, vy: -.2, r: 11, life: 600, soft: 'rgba(214,186,120,', a0: .4 });
  },

  /** 충격파 (킬·사보타주) */
  ringAt(x, y, col = '#ff4d5e', r1 = 90) {
    this.addFx({ kind:'ring', x, y, r0: 10, r1, life: 460, col });
  },

  updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      if (f.t >= f.life) { this.fx.splice(i, 1); continue; }
      if (f.vx !== undefined) {
        const k = dt / 16.67;
        f.x += f.vx * k; f.y += f.vy * k;
        if (f.kind === 'star') f.vy += 0.035 * k;      // 별은 살짝 떨어진다
        else { f.vx *= 0.96; f.vy *= 0.96; }
      }
    }
  },

  drawFx(g) {
    for (const f of this.fx) {
      if (f.t < 0) continue;                              // 아직 지연 중
      const p = f.t / f.life, a = 1 - p;
      if (f.kind === 'dust') {
        g.fillStyle = (f.soft || 'rgba(224,203,166,') + (Math.min(1, a * 1.5) * 0.4).toFixed(3) + ')';
        g.beginPath(); g.arc(f.x, f.y, f.r * (1 + p * 1.1), 0, 6.283); g.fill();
      } else if (f.kind === 'ring') {
        g.strokeStyle = f.col; g.globalAlpha = a * 0.75;
        g.lineWidth = 3.5 * a + 1;
        g.beginPath(); g.arc(f.x, f.y, f.r0 + (f.r1 - f.r0) * p, 0, 6.283); g.stroke();
        g.globalAlpha = 1;
      } else if (f.kind === 'door') {
        // 두 짝 문이 활짝 열렸다가 닫힌다 (가로 스케일로 스윙 표현)
        const open = Math.sin(Math.min(1, p * 1.6) * 3.14159);   // 0→1→0
        g.save(); g.translate(f.x, f.y);
        for (const dir of [-1, 1]) {
          g.save();
          g.translate(dir * 1.5, 0);
          g.scale(1 - open * 0.85, 1);
          g.fillStyle = '#6a675e';
          g.fillRect(dir === -1 ? -15 : 0, -6, 15, 46);
          g.restore();
        }
        g.restore();
      } else if (f.kind === 'hay') {
        // 눌림 → 반동: sin 곡선으로 세로 스케일이 출렁인다
        const sq = 1 + Math.sin(p * 3.14159 * 2) * 0.16 * (1 - p);
        g.save(); g.translate(f.x, f.y); g.scale(1 / Math.sqrt(sq), sq);
        g.fillStyle = '#2b1a0a';
        g.beginPath(); g.ellipse(0, 0, 34, 25, 0, 0, 6.283); g.fill();
        g.fillStyle = '#d9b25f';
        g.beginPath(); g.ellipse(0, 0, 31, 22, 0, 0, 6.283); g.fill();
        g.fillStyle = '#e8c87a';
        g.beginPath(); g.ellipse(-6, -6, 16, 10, -0.3, 0, 6.283); g.fill();
        g.strokeStyle = 'rgba(140,100,40,.5)'; g.lineWidth = 1.5;
        for (const [sx, sy, ex, ey] of [[-18,2,-8,-6],[2,-12,10,-3],[-4,8,8,12],[12,-8,20,0]]) {
          g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
        }
        g.restore();
      } else if (f.kind === 'emoji') {
        g.globalAlpha = a;
        g.font = `700 ${f.r * (1 + p * 0.6)}px system-ui`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(f.txt, f.x, f.y);
        g.globalAlpha = 1;
      } else if (f.kind === 'star') {
        g.fillStyle = f.col; g.globalAlpha = a;
        const r = f.r * (1 - p * 0.5);
        g.beginPath();
        for (let i = 0; i < 8; i++) {                    // 4각 별
          const ang = i / 8 * 6.283, rr = i % 2 ? r * 0.38 : r;
          g.lineTo(f.x + Math.cos(ang) * rr, f.y + Math.sin(ang) * rr);
        }
        g.closePath(); g.fill(); g.globalAlpha = 1;
      }
    }
  },

  /** iOS 사파리는 메모리가 부족하면 화면 밖 캔버스를 통째로 비운다.
   *  맵은 한 번만 프리렌더하므로, 비워지면 세상이 영영 검게 남는다
   *  ("게임은 검은데 투표 화면은 보인다"의 원인).
   *  바닥이 반드시 칠해져 있어야 할 픽셀 하나를 주기적으로 검사해 복구한다. */
  _mapCheckAt: 0,
  ensureMap() {
    const t = performance.now();
    if (t - this._mapCheckAt < 2000) return;
    this._mapCheckAt = t;
    try {
      const g = this.mapCv.getContext('2d');
      // 헛간 앞마당 한복판 — 항상 불투명해야 한다
      const px = g.getImageData(59 * TILE, 12 * TILE, 1, 1).data;
      if (px[3] === 0) this.buildMap();
    } catch { this.buildMap(); }
  },

  init(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.buildMap();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    if (!this.cv) return;                       // init 전에 화면 전환이 먼저 오는 경우 방어
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = this.cv.getBoundingClientRect();
    this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 화면이 작을수록 더 넓게 보이도록
    const base = Math.min(r.width, r.height);
    this.scale = clamp(base / 560, 0.62, 1.45);
  },

  /* ---------------- 정적 맵 프리렌더 ----------------
   * 맵은 게임 화면의 대부분을 차지한다. 방마다 바닥 재질과 소품이 달라야
   * 이름을 읽지 않고도 "여긴 헛간, 저긴 온실"이 구분된다.
   * 텍스처는 시드 난수로 그려서 매번 같은 그림이 나오게 한다. */
  buildMap() {
    const c = document.createElement('canvas');
    c.width = WORLD_W; c.height = WORLD_H;
    const g = c.getContext('2d');

    // 맵 바깥 = 밤 들판
    g.fillStyle = '#0a0f0a'; g.fillRect(0, 0, WORLD_W, WORLD_H);

    this.drawFloors(g);
    this.drawProps(g);
    this.drawTaskProps(g);
    this.drawWalls(g);

    // 방 이름 — 소품에 가리지 않도록 방 위쪽에 나무 간판으로 건다
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const r of ROOMS) {
      const size = Math.min(26, r.w * 2.0);
      g.font = `700 ${size}px "MamongDisplay", "Pretendard", system-ui, sans-serif`;
      const cx = (r.x + r.w / 2) * TILE, cy = r.y * TILE + 26;
      const tw = g.measureText(r.name).width;
      const pw = tw + 26, ph = size + 16;
      g.fillStyle = 'rgba(52,32,14,.72)';
      g.beginPath(); g.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 7); g.fill();
      g.strokeStyle = 'rgba(196,148,88,.55)'; g.lineWidth = 2;
      g.beginPath(); g.roundRect(cx - pw / 2 + 2.5, cy - ph / 2 + 2.5, pw - 5, ph - 5, 5); g.stroke();
      g.fillStyle = 'rgba(24,12,4,.55)'; g.fillText(r.name, cx, cy + 1.5);
      g.fillStyle = 'rgba(255,238,205,.92)'; g.fillText(r.name, cx, cy);
    }
    this.mapCv = c;
  },

  /** 32비트 시드 난수 — 같은 맵이 매번 똑같이 그려지도록 */
  seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  },

  /* ---------------- 바닥 ----------------
   * 방마다 재질이 다르다. 재질을 못 찾으면 흙바닥으로 떨어진다. */
  FLOORS: {
    dirt:     { base:'#6a4f34', dark:'#5b432c', light:'#7d6042' },   // 차고 맨흙
    stone:    { base:'#6d6961', dark:'#5b5850', light:'#837e74' },   // 물레방아 돌바닥
    plank:    { base:'#7b5733', dark:'#65472a', light:'#8e6840' },   // 나무 판자
    tile:     { base:'#96a096', dark:'#828d83', light:'#a9b2a8' },   // 동물병원 타일
    straw:    { base:'#8a6b3b', dark:'#755a30', light:'#a08249' },   // 헛간 앞마당 짚
    soil:     { base:'#54402a', dark:'#463322', light:'#654e34' },   // 온실 흙
    grass:    { base:'#4e6d3b', dark:'#425c32', light:'#5e8047' },   // 잔디
    concrete: { base:'#6b6862', dark:'#5c5954', light:'#7d7a73' },   // 시멘트
  },
  PATH: { base:'#4a4033', dark:'#3d352a', light:'#5c5042' },         // 오솔길 (자갈길)

  drawFloors(g) {
    const rnd = this.seeded(20260723);

    for (let ty = 0; ty < GH; ty++) for (let tx = 0; tx < GW; tx++) {
      if (!walkableTile(tx, ty)) continue;
      const ri = roomOf[gi(tx, ty)];
      const room = ri < 0 ? null : ROOMS[ri];
      const pal = room ? (this.FLOORS[room.floor] || this.FLOORS.dirt) : this.PATH;
      const kind = room ? (room.floor || 'dirt') : 'path';
      const X = tx * TILE, Y = ty * TILE;

      g.fillStyle = pal.base; g.fillRect(X, Y, TILE, TILE);

      switch (kind) {
        case 'plank': {                                  // 가로 판자 + 나뭇결
          for (let i = 0; i < 4; i++) {
            g.fillStyle = i % 2 ? 'rgba(0,0,0,.055)' : 'rgba(255,220,170,.045)';
            g.fillRect(X, Y + i * 8, TILE, 8);
          }
          g.strokeStyle = 'rgba(40,24,10,.34)'; g.lineWidth = 1;
          g.beginPath();
          for (let i = 1; i < 4; i++) { g.moveTo(X, Y + i * 8 + .5); g.lineTo(X + TILE, Y + i * 8 + .5); }
          g.stroke();
          if (rnd() < .35) {                              // 옹이
            g.fillStyle = 'rgba(45,26,10,.35)';
            g.beginPath(); g.ellipse(X + rnd() * TILE, Y + 4 + ((rnd() * 4) | 0) * 8, 2.4, 1.2, 0, 0, 6.283); g.fill();
          }
          break;
        }
        case 'tile': {                                    // 병원 체크 타일
          const on = (tx + ty) % 2 === 0;
          g.fillStyle = on ? 'rgba(255,250,238,.055)' : 'rgba(0,0,0,.035)';
          g.fillRect(X, Y, TILE, TILE);
          g.strokeStyle = 'rgba(60,70,62,.22)'; g.lineWidth = 1;     // 줄눈
          g.strokeRect(X + .5, Y + .5, TILE - 1, TILE - 1);
          break;
        }
        case 'stone': {                                   // 자갈 깔린 돌바닥
          for (let i = 0; i < 5; i++) {
            g.fillStyle = rnd() < .5 ? pal.dark : pal.light;
            const cx = X + rnd() * TILE, cy = Y + rnd() * TILE;
            g.beginPath(); g.ellipse(cx, cy, 3 + rnd() * 4, 2.4 + rnd() * 3, rnd() * 3, 0, 6.283); g.fill();
          }
          g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 1;
          g.strokeRect(X + .5, Y + .5, TILE - 1, TILE - 1);
          break;
        }
        case 'straw': {                                   // 흩어진 지푸라기
          g.fillStyle = 'rgba(0,0,0,.06)';
          if ((tx * 7 + ty * 3) % 5 === 0) g.fillRect(X, Y, TILE, TILE);
          g.lineWidth = 1.4; g.lineCap = 'round';
          for (let i = 0; i < 5; i++) {
            const sx = X + rnd() * TILE, sy = Y + rnd() * TILE, a = rnd() * 3.14, l = 4 + rnd() * 7;
            g.strokeStyle = rnd() < .5 ? 'rgba(226,190,120,.42)' : 'rgba(120,88,40,.40)';
            g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); g.stroke();
          }
          break;
        }
        case 'soil': {                                    // 온실 이랑 + 새싹
          g.fillStyle = 'rgba(0,0,0,.10)';
          for (let i = 0; i < 2; i++) g.fillRect(X, Y + 6 + i * 14, TILE, 5);
          for (let i = 0; i < 3; i++) {
            g.fillStyle = 'rgba(120,90,60,.5)';
            g.beginPath(); g.arc(X + rnd() * TILE, Y + rnd() * TILE, 1 + rnd() * 1.6, 0, 6.283); g.fill();
          }
          if (rnd() < .25) {                              // 싹
            const sx = X + rnd() * TILE, sy = Y + rnd() * TILE;
            g.strokeStyle = 'rgba(120,190,110,.55)'; g.lineWidth = 1.6;
            g.beginPath(); g.moveTo(sx, sy + 3); g.lineTo(sx, sy - 3); g.stroke();
          }
          break;
        }
        case 'grass': {                                   // 잔디 포기
          g.lineWidth = 1.6; g.lineCap = 'round';
          for (let i = 0; i < 7; i++) {
            const sx = X + rnd() * TILE, sy = Y + rnd() * TILE;
            g.strokeStyle = rnd() < .5 ? 'rgba(126,168,88,.45)' : 'rgba(58,86,44,.55)';
            g.beginPath(); g.moveTo(sx, sy + 3.5); g.quadraticCurveTo(sx + 1.5, sy, sx + 3.5, sy - 2.5); g.stroke();
          }
          break;
        }
        case 'concrete': {                                // 시멘트 이음새 + 금
          g.strokeStyle = 'rgba(0,0,0,.20)'; g.lineWidth = 1;
          g.strokeRect(X + .5, Y + .5, TILE - 1, TILE - 1);
          if (rnd() < .18) {
            g.strokeStyle = 'rgba(0,0,0,.24)'; g.lineWidth = 1.2;
            g.beginPath(); g.moveTo(X + rnd() * TILE, Y); g.lineTo(X + rnd() * TILE, Y + TILE); g.stroke();
          }
          break;
        }
        case 'path': {                                    // 오솔길 — 자갈이 촘촘히 박힌 길
          for (let i = 0; i < 9; i++) {
            g.fillStyle = rnd() < .45 ? 'rgba(150,138,120,.42)' : 'rgba(38,32,24,.42)';
            g.beginPath(); g.ellipse(X + rnd() * TILE, Y + rnd() * TILE, 1.8 + rnd() * 2.6, 1.4 + rnd() * 1.8, rnd() * 3, 0, 6.283); g.fill();
          }
          break;
        }
        default: {                                        // 맨흙
          for (let i = 0; i < 4; i++) {
            g.fillStyle = rnd() < .5 ? pal.dark : pal.light;
            g.beginPath(); g.ellipse(X + rnd() * TILE, Y + rnd() * TILE, 2 + rnd() * 3.4, 1.6 + rnd() * 2.2, 0, 0, 6.283); g.fill();
          }
        }
      }
    }

    // 방 가장자리 어둡게 — 벽 안쪽에 그림자를 넣어 평면감을 없앤다
    g.save();
    for (const r of ROOMS) {
      const x = r.x * TILE, y = r.y * TILE, w = r.w * TILE, h = r.h * TILE;
      const grd = g.createLinearGradient(x, y, x, y + h);
      grd.addColorStop(0, 'rgba(0,0,0,.30)');
      grd.addColorStop(0.14, 'rgba(0,0,0,0)');
      grd.addColorStop(0.86, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,.24)');
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      const grd2 = g.createLinearGradient(x, y, x + w, y);
      grd2.addColorStop(0, 'rgba(0,0,0,.22)');
      grd2.addColorStop(0.10, 'rgba(0,0,0,0)');
      grd2.addColorStop(0.90, 'rgba(0,0,0,0)');
      grd2.addColorStop(1, 'rgba(0,0,0,.22)');
      g.fillStyle = grd2; g.fillRect(x, y, w, h);
    }
    g.restore();
  },

  /* ---------------- 벽 = 나무 기둥·판자 ---------------- */
  drawWalls(g) {
    g.lineCap = 'round';
    g.strokeStyle = '#1b1008'; g.lineWidth = 13;            // 바깥 그림자
    g.beginPath(); for (const w of WALLS) { g.moveTo(w.x1, w.y1); g.lineTo(w.x2, w.y2); } g.stroke();
    g.strokeStyle = '#6b4423'; g.lineWidth = 7;             // 나무 몸통
    g.beginPath(); for (const w of WALLS) { g.moveTo(w.x1, w.y1); g.lineTo(w.x2, w.y2); } g.stroke();
    g.strokeStyle = 'rgba(214,164,104,.55)'; g.lineWidth = 2; // 위쪽 하이라이트
    g.beginPath(); for (const w of WALLS) { g.moveTo(w.x1, w.y1 - 2); g.lineTo(w.x2, w.y2 - 2); } g.stroke();
    // 판자 이음매 (일정 간격 못 자국)
    g.fillStyle = 'rgba(40,22,8,.5)';
    for (const w of WALLS) {
      const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      const ux = (w.x2 - w.x1) / (len || 1), uy = (w.y2 - w.y1) / (len || 1);
      for (let d = TILE; d < len; d += TILE * 2) {
        g.beginPath(); g.arc(w.x1 + ux * d, w.y1 + uy * d, 1.6, 0, 6.283); g.fill();
      }
    }
  },

  /* ---------------- 방 소품 ----------------
   * 좌표는 타일 단위. 헬퍼가 알아서 픽셀로 바꾼다. */
  /* 임무 지점마다 실물 작업대를 그린다.
   * 바닥의 노란 동그라미만으로는 "여기서 뭘 하는지"가 안 보인다는 피드백.
   * 종류별로 알아볼 수 있는 소품 + 나무 받침. 정적 레이어라 비용 0. */
  drawTaskProps(g) {
    // 가구는 벽에 붙는다: 스폿(서는 자리)에서 벽 쪽으로 밀어 그린다
    const WALL_OFF = { N: [0, -20], S: [0, 14], E: [18, 0], W: [-18, 0] };
    for (const t of TASK_SPOTS) {
      const [ox, oy] = WALL_OFF[t.wall] || [0, 0];
      const x = t.wx + ox, y = t.wy + oy;
      g.save(); g.translate(x, y);
      // 북쪽 벽 가구는 벽에 '걸린' 판자 위에 얹는다 (액자 느낌)
      if (t.wall === 'N') {
        g.fillStyle = '#2b1a0a'; g.fillRect(-17, -26, 34, 30);
        g.fillStyle = '#5c452e'; g.fillRect(-15, -24, 30, 26);
      }
      // 바닥 가구는 그림자
      else {
        g.fillStyle = 'rgba(60,40,20,.5)';
        g.beginPath(); g.ellipse(0, 12, 20, 7, 0, 0, 6.283); g.fill();
      }
      const box = (w, h, c1, c2, yo = 0) => {
        g.fillStyle = '#2b1a0a'; g.fillRect(-w/2 - 2, -h + 10 + yo - 2, w + 4, h + 4);
        const gr = g.createLinearGradient(0, -h + yo, 0, 10 + yo);
        gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        g.fillStyle = gr; g.fillRect(-w/2, -h + 10 + yo, w, h);
      };
      switch (t.kind) {
        case 'wiring':                                    // 전선함
          box(24, 20, '#8a8578', '#5c584e');
          g.fillStyle = '#e64b4b'; g.fillRect(-8, -4, 5, 3);
          g.fillStyle = '#3a6fe0'; g.fillRect(-1, -4, 5, 3);
          g.fillStyle = '#ffd23d'; g.fillRect(6, -4, 5, 3);
          break;
        case 'card': case 'records':                      // 단말기·서류함
          box(20, 24, '#7d5730', '#4e3319');
          g.fillStyle = '#1c2a1c'; g.fillRect(-6, -10, 12, 8);
          g.fillStyle = '#8ef0b5'; g.fillRect(-4, -8, 8, 2);
          break;
        case 'fuel':                                      // 기름통
          box(18, 22, '#c0392b', '#7a1e14');
          g.fillStyle = '#f6ece0'; g.fillRect(-6, -8, 12, 5);
          break;
        case 'garbage': case 'leaves':                    // 거름·여물 통
          box(26, 16, '#6d4e30', '#3e2d1e');
          g.fillStyle = '#8a9a4a';
          for (const [bx,by] of [[-7,-9],[0,-11],[7,-9]]) { g.beginPath(); g.arc(bx, by, 4.5, 0, 6.283); g.fill(); }
          break;
        case 'download':                                  // 주문서 책상
          box(26, 14, '#9a6a3a', '#6a4522');
          g.fillStyle = '#f4efe2'; g.fillRect(-8, -8, 16, 8);
          g.fillStyle = '#8a6134'; g.fillRect(-6, -6, 12, 1.6); g.fillRect(-6, -3.4, 9, 1.6);
          break;
        case 'keypad':                                    // 자물쇠 상자
          box(22, 18, '#7d5730', '#4e3319');
          g.fillStyle = '#c9b26a'; g.beginPath(); g.arc(0, -4, 4.5, 0, 6.283); g.fill();
          g.fillStyle = '#4a3610'; g.beginPath(); g.arc(0, -4, 1.8, 0, 6.283); g.fill();
          break;
        case 'align': case 'calib':                       // 정비대 (렌치)
          box(24, 16, '#8a8578', '#55524a');
          g.strokeStyle = '#d9d4c8'; g.lineWidth = 3; g.lineCap = 'round';
          g.beginPath(); g.moveTo(-6, -6); g.lineTo(5, 2); g.stroke();
          g.beginPath(); g.arc(-7.5, -7.5, 3.5, 0.6, 4.2); g.stroke();
          break;
        case 'sample':                                    // 우유병
          box(22, 12, '#7d5730', '#4e3319');
          for (const bx of [-6, 0, 6]) {
            g.fillStyle = '#f4efe6'; g.fillRect(bx - 2.5, -12, 5, 12);
            g.fillStyle = '#c3b596'; g.fillRect(bx - 2.5, -12, 5, 3);
          }
          break;
        case 'divert':                                    // 수문 스위치판
          box(26, 18, '#5c452e', '#332412');
          for (const bx of [-7, 0, 7]) {
            g.fillStyle = '#241505'; g.fillRect(bx - 1.5, -10, 3, 10);
            g.fillStyle = '#d6b26a'; g.fillRect(bx - 3, -11, 6, 4);
          }
          break;
        case 'chart':                                     // 이젤 지도판
          g.strokeStyle = '#4e3319'; g.lineWidth = 3;
          g.beginPath(); g.moveTo(-9, 10); g.lineTo(0, -14); g.lineTo(9, 10); g.stroke();
          box(24, 18, '#e8dcc0', '#c9b896', -6);
          g.strokeStyle = '#7d9a4a'; g.lineWidth = 2;
          g.beginPath(); g.moveTo(-8, -6); g.lineTo(-2, -12); g.lineTo(4, -8); g.lineTo(8, -13); g.stroke();
          break;
        case 'temp':                                      // 온도계 기둥
          box(10, 22, '#7d5730', '#4e3319');
          g.fillStyle = '#efeae0'; g.fillRect(-2.5, -10, 5, 14);
          g.fillStyle = '#e0483f'; g.fillRect(-2.5, -2, 5, 6); g.beginPath(); g.arc(0, 5, 4, 0, 6.283); g.fill();
          break;
        case 'sort':                                      // 곡물 자루
          for (const [bx, c] of [[-8, '#e64b4b'], [0, '#3a6fe0'], [8, '#2ea44f']]) {
            g.fillStyle = '#2b1a0a'; g.beginPath(); g.ellipse(bx, 0, 6.5, 9, 0, 0, 6.283); g.fill();
            g.fillStyle = c; g.beginPath(); g.ellipse(bx, 0, 5, 7.5, 0, 0, 6.283); g.fill();
          }
          break;
        case 'shields':                                   // 울타리 패널
          box(26, 16, '#8a8578', '#55524a');
          for (let i = 0; i < 3; i++) { g.fillStyle = i === 1 ? '#c1475e' : '#4a5f45'; g.fillRect(-9 + i * 7, -8, 5, 5); }
          break;
        case 'asteroid':                                  // 까마귀 쫓기 종
          g.strokeStyle = '#4e3319'; g.lineWidth = 3.5;
          g.beginPath(); g.moveTo(0, 10); g.lineTo(0, -14); g.stroke();
          g.fillStyle = '#c9b26a'; g.beginPath(); g.arc(0, -14, 6, 3.14, 0); g.fill();
          break;
        case 'scan':                                      // 검진대
          box(28, 10, '#e8e2d4', '#bcb6a8');
          g.fillStyle = '#4aa8c8'; g.fillRect(-14, -2, 28, 2.5);
          break;
        default:
          box(20, 14, '#7d5730', '#4e3319');
      }
      g.restore();
    }
    // 숨는 가구 — 실내는 사물함, 야외는 건초수레. 벽에 붙어 있다.
    if (typeof HIDE_SPOTS !== 'undefined') for (const hs of HIDE_SPOTS) {
      const [ox, oy] = WALL_OFF[hs.wall] || [0, 0];
      g.save(); g.translate(hs.wx + ox * 1.1, hs.wy + oy * 1.1);
      if (hs.type === 'locker') this.drawLocker(g);
      else this.drawHayCart(g);
      g.restore();
    }
  },

  /** 사물함 — 두 짝 문, 환기 슬릿, 손잡이 */
  drawLocker(g) {
    g.fillStyle = 'rgba(0,0,0,.4)';
    g.beginPath(); g.ellipse(0, 22, 20, 6, 0, 0, 6.283); g.fill();
    g.fillStyle = '#2b1a0a'; g.fillRect(-18, -30, 36, 52);
    const gr = g.createLinearGradient(0, -28, 0, 20);
    gr.addColorStop(0, '#8a8578'); gr.addColorStop(1, '#55524a');
    g.fillStyle = gr; g.fillRect(-16, -28, 32, 48);
    g.fillStyle = '#3c3a34'; g.fillRect(-1, -28, 2, 48);      // 문 사이 틈
    g.fillStyle = 'rgba(20,18,14,.7)';
    for (const dy of [-20, -14]) { g.fillRect(-12, dy, 9, 2.2); g.fillRect(3, dy, 9, 2.2); }
    g.fillStyle = '#c9b26a';                                  // 손잡이
    g.fillRect(-5, -4, 3, 7); g.fillRect(2, -4, 3, 7);
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(-16, -28, 32, 6);
  },

  /** 건초수레 — 바퀴 달린 수레에 수북한 건초 */
  drawHayCart(g) {
    g.fillStyle = 'rgba(0,0,0,.4)';
    g.beginPath(); g.ellipse(0, 18, 28, 7, 0, 0, 6.283); g.fill();
    // 바퀴
    for (const wx of [-16, 16]) {
      g.fillStyle = '#2b1a0a'; g.beginPath(); g.arc(wx, 12, 8, 0, 6.283); g.fill();
      g.fillStyle = '#4e3319'; g.beginPath(); g.arc(wx, 12, 5.5, 0, 6.283); g.fill();
      g.fillStyle = '#2b1a0a'; g.beginPath(); g.arc(wx, 12, 1.8, 0, 6.283); g.fill();
    }
    // 수레 몸통
    g.fillStyle = '#2b1a0a'; g.fillRect(-24, -4, 48, 16);
    g.fillStyle = '#7d5730'; g.fillRect(-22, -2, 44, 12);
    g.fillStyle = '#5c452e'; for (const bx of [-14, -2, 10]) g.fillRect(bx, -2, 2.5, 12);
    // 건초
    g.fillStyle = '#2b1a0a';
    g.beginPath(); g.ellipse(0, -10, 26, 14, 0, 0, 6.283); g.fill();
    g.fillStyle = '#d9b25f';
    g.beginPath(); g.ellipse(0, -10, 23, 11.5, 0, 0, 6.283); g.fill();
    g.fillStyle = '#e8c87a';
    g.beginPath(); g.ellipse(-6, -14, 12, 6, -0.25, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(140,100,40,.55)'; g.lineWidth = 1.5;
    for (const [a, b, c, d] of [[-14,-8,-5,-13],[3,-16,10,-8],[-3,-5,7,-3]]) {
      g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke();
    }
  },

  drawProps(g) {
    const T = TILE;
    const rnd = this.seeded(777);
    const px = (v) => v * T;

    /* --- 기본 도형 --- */
    const shadow = (x, y, rx, ry) => {
      g.fillStyle = 'rgba(0,0,0,.30)';
      g.beginPath(); g.ellipse(px(x), px(y), rx, ry, 0, 0, 6.283); g.fill();
    };
    const box = (x, y, w, h, fill, stroke, r = 4) => {
      g.fillStyle = fill; g.beginPath(); g.roundRect(px(x), px(y), px(w), px(h), r); g.fill();
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2.4; g.stroke(); }
    };
    const circ = (x, y, r, fill, stroke) => {
      g.fillStyle = fill; g.beginPath(); g.arc(px(x), px(y), px(r), 0, 6.283); g.fill();
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2.4; g.stroke(); }
    };
    const line = (x1, y1, x2, y2, col, w = 2) => {
      g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
      g.beginPath(); g.moveTo(px(x1), px(y1)); g.lineTo(px(x2), px(y2)); g.stroke();
    };

    /* --- 목장 소품 --- */
    // 나무 궤짝: 판자결 + 대각 보강
    const crate = (x, y, w = 2, h = 2) => {
      shadow(x + w / 2, y + h - 0.1, px(w) * 0.46, px(h) * 0.16);
      box(x, y, w, h, '#8a6134', '#4e3218', 3);
      g.save(); g.beginPath(); g.rect(px(x), px(y), px(w), px(h)); g.clip();
      g.strokeStyle = 'rgba(70,44,20,.55)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(px(x), px(y)); g.lineTo(px(x + w), px(y + h));
      g.moveTo(px(x + w), px(y)); g.lineTo(px(x), px(y + h)); g.stroke();
      g.restore();
      g.fillStyle = 'rgba(255,224,180,.18)'; g.fillRect(px(x) + 3, px(y) + 3, px(w) - 6, 4);
    };
    // 건초더미: 둥근 원통 + 결 + 묶는 끈
    const hay = (x, y, r = 1.6) => {
      shadow(x, y + r * 0.75, px(r) * 1.05, px(r) * 0.34);
      circ(x, y, r, '#c69a48', '#7a5620');
      g.save();
      g.beginPath(); g.arc(px(x), px(y), px(r) - 1, 0, 6.283); g.clip();
      g.strokeStyle = 'rgba(122,86,32,.45)'; g.lineWidth = 1.6;
      for (let i = -3; i <= 3; i++) {
        g.beginPath(); g.arc(px(x), px(y), px(r) * (0.24 * Math.abs(i) + .18), 0, 6.283); g.stroke();
      }
      g.strokeStyle = 'rgba(255,236,190,.35)'; g.lineWidth = 2.2;
      for (let i = 0; i < 10; i++) {
        const a = rnd() * 6.283, rr = px(r) * (.3 + rnd() * .6);
        g.beginPath(); g.moveTo(px(x) + Math.cos(a) * rr, px(y) + Math.sin(a) * rr);
        g.lineTo(px(x) + Math.cos(a) * (rr + 6), px(y) + Math.sin(a) * (rr + 6)); g.stroke();
      }
      g.restore();
      g.strokeStyle = 'rgba(90,64,26,.8)'; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(px(x - r * .45), px(y - r)); g.lineTo(px(x - r * .45), px(y + r)); g.stroke();
      g.beginPath(); g.moveTo(px(x + r * .45), px(y - r)); g.lineTo(px(x + r * .45), px(y + r)); g.stroke();
    };
    // 사각 짚단
    const bale = (x, y, w = 2.2, h = 1.4) => {
      shadow(x + w / 2, y + h - .05, px(w) * .46, px(h) * .2);
      box(x, y, w, h, '#cba24f', '#7a5620', 4);
      g.save(); g.beginPath(); g.roundRect(px(x), px(y), px(w), px(h), 4); g.clip();
      g.strokeStyle = 'rgba(255,236,190,.30)'; g.lineWidth = 1.4;
      for (let i = 0; i < 9; i++) {
        const yy = px(y) + rnd() * px(h);
        g.beginPath(); g.moveTo(px(x), yy); g.lineTo(px(x + w), yy + (rnd() - .5) * 4); g.stroke();
      }
      g.strokeStyle = 'rgba(90,64,26,.75)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(px(x + w * .3), px(y)); g.lineTo(px(x + w * .3), px(y + h));
      g.moveTo(px(x + w * .7), px(y)); g.lineTo(px(x + w * .7), px(y + h)); g.stroke();
      g.restore();
    };
    // 곡물 자루
    const sack = (x, y, s0 = 1) => {
      const s = s0 * 1.5;
      shadow(x, y + .55 * s, 15 * s, 5 * s);
      g.fillStyle = '#b9a077'; g.strokeStyle = '#6b5836'; g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(px(x) - 13 * s, px(y) + 18 * s);
      g.quadraticCurveTo(px(x) - 18 * s, px(y) - 6 * s, px(x) - 6 * s, px(y) - 12 * s);
      g.lineTo(px(x) + 6 * s, px(y) - 12 * s);
      g.quadraticCurveTo(px(x) + 18 * s, px(y) - 6 * s, px(x) + 13 * s, px(y) + 18 * s);
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.14)';
      g.beginPath(); g.ellipse(px(x) - 5 * s, px(y) + 2 * s, 4 * s, 8 * s, -.2, 0, 6.283); g.fill();
      g.strokeStyle = '#6b5836'; g.lineWidth = 2.6;                    // 주둥이 끈
      g.beginPath(); g.moveTo(px(x) - 7 * s, px(y) - 12 * s); g.lineTo(px(x) + 7 * s, px(y) - 12 * s); g.stroke();
    };
    // 나무통(경유 드럼)
    const barrel = (x, y, r = .8, col = '#7d4a2a') => {
      shadow(x, y + r * .8, px(r) * 1.05, px(r) * .34);
      circ(x, y, r, col, '#3b2210');
      circ(x, y, r * .72, 'rgba(0,0,0,.18)');
      g.strokeStyle = 'rgba(220,180,120,.5)'; g.lineWidth = 2.4;
      g.beginPath(); g.arc(px(x), px(y), px(r) * .88, 0, 6.283); g.stroke();
      circ(x, y, r * .30, 'rgba(255,220,160,.25)');
    };
    // 여물통 (긴 나무 구유)
    const trough = (x, y, w = 4, h = 1.2) => {
      shadow(x + w / 2, y + h, px(w) * .46, px(h) * .3);
      box(x, y, w, h, '#6d4726', '#3d2410', 5);
      box(x + .12, y + .2, w - .24, h - .45, '#3f5d3a', null, 4);      // 안에 담긴 사료
      g.fillStyle = 'rgba(150,200,120,.45)';
      for (let i = 0; i < 12; i++) {
        g.beginPath(); g.arc(px(x + .2 + rnd() * (w - .4)), px(y + .25 + rnd() * (h - .6)), 2.2, 0, 6.283); g.fill();
      }
      g.fillStyle = 'rgba(255,220,170,.2)'; g.fillRect(px(x) + 4, px(y) + 3, px(w) - 8, 3);
    };
    // 울타리 기둥
    const post = (x, y, h = .9) => {
      shadow(x, y + h * .5, 8, 4);
      box(x - .16, y - h, .32, h * 1.4, '#7a5028', '#3e2611', 2);
      g.fillStyle = 'rgba(255,220,170,.25)'; g.fillRect(px(x) - 4, px(y - h), 3, px(h) * 1.4);
    };
    // 식물 (온실 화분·덤불)
    const bush = (x, y, r = .7, col = '#3f7a3a', col2 = '#59a24e') => {
      shadow(x, y + r * .7, px(r), px(r) * .3);
      circ(x, y, r, col);
      circ(x - r * .4, y - r * .35, r * .62, col2);
      circ(x + r * .42, y - r * .2, r * .55, col2);
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.beginPath(); g.arc(px(x - r * .3), px(y - r * .4), px(r) * .28, 0, 6.283); g.fill();
    };
    // 작업대 (연장 걸린 나무 테이블)
    const bench = (x, y, w = 4, h = 1.4) => {
      shadow(x + w / 2, y + h, px(w) * .46, px(h) * .28);
      box(x, y, w, h, '#8a5f33', '#452a12', 4);
      g.strokeStyle = 'rgba(60,36,14,.5)'; g.lineWidth = 1.6;
      for (let i = 1; i < w; i++) { g.beginPath(); g.moveTo(px(x + i), px(y)); g.lineTo(px(x + i), px(y + h)); g.stroke(); }
      g.fillStyle = 'rgba(255,226,180,.2)'; g.fillRect(px(x) + 3, px(y) + 3, px(w) - 6, 4);
    };
    // 물통
    const bucket = (x, y, col = '#8fb6c4') => {
      shadow(x, y + .3, 11, 4);
      g.fillStyle = col; g.strokeStyle = '#3f5a64'; g.lineWidth = 2.2;
      g.beginPath(); g.arc(px(x), px(y), 11, 0, 6.283); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.arc(px(x), px(y), 7, 0, 6.283); g.fill();
      g.strokeStyle = '#5b7a86'; g.lineWidth = 2;
      g.beginPath(); g.arc(px(x), px(y), 13, 3.5, 6.0); g.stroke();
    };
    // 등불
    const lantern = (x, y) => {
      shadow(x, y + .28, 9, 3.5);
      g.fillStyle = '#4a3a24'; g.beginPath(); g.roundRect(px(x) - 7, px(y) - 11, 14, 20, 3); g.fill();
      g.fillStyle = '#ffd97a'; g.beginPath(); g.roundRect(px(x) - 4.5, px(y) - 7, 9, 12, 2); g.fill();
      g.fillStyle = 'rgba(255,220,130,.16)'; g.beginPath(); g.arc(px(x), px(y), 26, 0, 6.283); g.fill();
      g.strokeStyle = '#4a3a24'; g.lineWidth = 2.2;
      g.beginPath(); g.arc(px(x), px(y) - 11, 5, 3.3, 6.1); g.stroke();
    };
    // 나무 의자
    const chair = (x, y) => {
      shadow(x, y + .3, 11, 4);
      box(x - .32, y - .32, .64, .64, '#8a5f33', '#452a12', 3);
      box(x - .32, y - .5, .64, .2, '#6d4726', '#3d2410', 2);
    };
    // 타이어 더미
    const tires = (x, y) => {
      shadow(x, y + .3, 16, 6);
      for (let i = 2; i >= 0; i--) {
        g.fillStyle = '#242028'; g.beginPath(); g.arc(px(x), px(y) - i * 4, 15, 0, 6.283); g.fill();
        g.fillStyle = '#3a343f'; g.beginPath(); g.arc(px(x), px(y) - i * 4, 6.5, 0, 6.283); g.fill();
      }
    };
    // 기름 얼룩 / 물웅덩이
    const stain = (x, y, r = 1, col = 'rgba(20,14,8,.16)') => {
      g.fillStyle = col;
      g.beginPath(); g.ellipse(px(x), px(y), px(r), px(r) * .62, .3, 0, 6.283); g.fill();
    };
    // 손수레
    const barrow = (x, y) => {
      shadow(x, y + .4, 22, 8);
      g.save(); g.translate(px(x), px(y));
      g.fillStyle = '#9aa88a'; g.strokeStyle = '#4a5540'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(-20, -12); g.lineTo(20, -8); g.lineTo(16, 10); g.lineTo(-16, 8); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#8a6134'; g.beginPath(); g.ellipse(0, -1, 13, 6.5, .1, 0, 6.283); g.fill();
      g.fillStyle = '#3a343f'; g.beginPath(); g.arc(-22, 2, 7.5, 0, 6.283); g.fill();
      g.fillStyle = '#6a6470'; g.beginPath(); g.arc(-22, 2, 3, 0, 6.283); g.fill();
      g.strokeStyle = '#7a5028'; g.lineWidth = 3.4;
      g.beginPath(); g.moveTo(18, -6); g.lineTo(30, -4); g.moveTo(16, 8); g.lineTo(28, 8); g.stroke();
      g.restore();
    };
    // 트랙터 (위에서 본 모습) — 차고를 채울 만큼 크게
    const tractor = (x, y, col = '#c0442f') => {
      shadow(x, y + 1, 100, 36);
      g.save(); g.translate(px(x), px(y)); g.scale(2.5, 2.5);
      g.fillStyle = '#2b2118';                                          // 바퀴
      for (const [wx, wy, ww, wh] of [[-26,-17,14,11],[-26,7,14,11],[16,-14,11,9],[16,6,11,9]]) {
        g.beginPath(); g.roundRect(wx, wy, ww, wh, 4); g.fill();
        g.strokeStyle = 'rgba(200,190,175,.28)'; g.lineWidth = 1.4;
        for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(wx + 3 + i * 4, wy); g.lineTo(wx + 3 + i * 4, wy + wh); g.stroke(); }
      }
      g.fillStyle = col; g.strokeStyle = '#5c1d13'; g.lineWidth = 2.4;   // 몸체
      g.beginPath(); g.roundRect(-30, -12, 56, 24, 6); g.fill(); g.stroke();
      g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.roundRect(-14, -9, 18, 18, 4); g.fill();
      g.fillStyle = '#3b4a5a'; g.beginPath(); g.roundRect(-26, -7, 12, 14, 3); g.fill();  // 좌석
      g.fillStyle = '#e8c76a'; g.beginPath(); g.arc(24, 0, 4.5, 0, 6.283); g.fill();      // 전조등
      g.strokeStyle = '#2b2118'; g.lineWidth = 3;                                          // 배기관
      g.beginPath(); g.moveTo(10, -12); g.lineTo(10, -22); g.stroke();
      g.restore();
    };

    /* ================= 방별 소품 ================= */

    /* 헛간 앞마당 (48,4 · 22×16) — 중앙 여물통 링 + 건초 + 헛간문 */
    circ(59, 12, 3.4, 'rgba(60,38,16,.35)');
    circ(59, 12, 3.0, '#7b5129', '#3f2410');
    circ(59, 12, 2.3, '#8f6132');
    circ(59, 12, 1.9, '#c69a48');                       // 안에 쌓인 여물
    g.strokeStyle = 'rgba(255,236,190,.5)'; g.lineWidth = 2;
    for (let i = 0; i < 22; i++) {
      const a = rnd() * 6.283, r0 = px(.4) + rnd() * px(1.4);
      g.beginPath(); g.moveTo(px(59) + Math.cos(a) * r0, px(12) + Math.sin(a) * r0);
      g.lineTo(px(59) + Math.cos(a) * (r0 + 9), px(12) + Math.sin(a) * (r0 + 9)); g.stroke();
    }
    g.strokeStyle = 'rgba(255,226,180,.22)'; g.lineWidth = 3;
    g.beginPath(); g.arc(px(59), px(12), px(2.65), 0, 6.283); g.stroke();
    for (let i = 0; i < 8; i++) {                       // 둘러선 여물 그릇
      const a = i / 8 * 6.283;
      circ(59 + Math.cos(a) * 2.6, 12 + Math.sin(a) * 2.6, .42, '#4a6b3c', '#2c3f22');
    }
    hay(51, 7, 1.5); hay(53.4, 8.4, 1.1); bale(65.5, 6, 2.4, 1.5); bale(66.2, 8, 2.4, 1.5);
    hay(52, 17, 1.4); bale(63, 16.5, 2.6, 1.6);
    trough(55, 17.4, 4, 1.2);
    // 헛간 큰 문 (남쪽 벽 안쪽)
    box(63, 19.1, 6, .8, '#8c2f22', '#4a170f', 3);
    line(63, 19.15, 69, 19.8, 'rgba(255,200,150,.35)', 2);
    line(66, 19.1, 66, 19.9, 'rgba(40,16,8,.7)', 3);

    /* 물레방아 (4,24 · 14×14) — 수로 + 큰 물레바퀴 */
    g.fillStyle = '#2d4a5c';                            // 수로
    g.fillRect(px(4), px(29.5), px(14), px(3));
    g.fillStyle = 'rgba(120,190,220,.22)';
    for (let i = 0; i < 26; i++) {
      g.beginPath(); g.ellipse(px(4.4 + rnd() * 13.2), px(29.8 + rnd() * 2.4), 5 + rnd() * 7, 1.6, 0, 0, 6.283); g.fill();
    }
    g.strokeStyle = 'rgba(20,40,52,.8)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(px(4), px(29.5)); g.lineTo(px(18), px(29.5));
    g.moveTo(px(4), px(32.5)); g.lineTo(px(18), px(32.5)); g.stroke();
    // 물레바퀴
    shadow(11, 31.6, 100, 26);
    circ(11, 31, 3.1, '#5a3a1c', '#301c0a');
    circ(11, 31, 2.55, '#7a5228');
    g.save(); g.translate(px(11), px(31));
    g.strokeStyle = '#3c2410'; g.lineWidth = 5;
    for (let i = 0; i < 10; i++) {                      // 살
      const a = i / 10 * 6.283;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * px(2.9), Math.sin(a) * px(2.9)); g.stroke();
    }
    g.fillStyle = '#8b5e2e'; g.strokeStyle = '#3c2410'; g.lineWidth = 2;
    for (let i = 0; i < 10; i++) {                      // 물받이 판
      const a = (i + .5) / 10 * 6.283;
      g.save(); g.rotate(a); g.translate(px(2.6), 0);
      g.beginPath(); g.roundRect(-6, -13, 12, 26, 2); g.fill(); g.stroke();
      g.restore();
    }
    g.restore();
    circ(11, 31, .55, '#3c2410', '#201206');
    // 곡물 빻는 맷돌·자루
    circ(15.5, 26.5, 1.1, '#7e7a70', '#4f4c45');
    circ(15.5, 26.5, .45, '#3e3b35');
    sack(6.6, 35.4, .85); sack(7.6, 26.5, .8);
    bucket(13.4, 34.4); bucket(14.8, 35.2, '#7aa8b8'); lantern(16.6, 34.6);
    stain(9, 36.6, 1.6, 'rgba(30,60,80,.28)'); stain(15.6, 36.2, 1.2, 'rgba(30,60,80,.24)');
    crate(5.6, 33.2, 1.8, 1.8); chair(12.2, 26.6);

    /* 북·남쪽 차고 (6,6 16×12 / 6,44 16×12) — 트랙터 + 드럼 + 작업대 */
    stain(12.5, 13.6, 2.2);
    tractor(12.5, 10.5, '#c0442f');
    barrel(8, 8, .8); barrel(9.4, 8.6, .7, '#6b5a2c');
    tires(8.2, 15.4); bucket(10.4, 16.2); lantern(20.6, 7.6);
    bench(16.5, 14.6, 4.2, 1.4);
    line(17, 15, 17, 13.6, '#9aa2a8', 3); line(18.2, 15, 18.9, 13.7, '#9aa2a8', 3);  // 벽에 건 연장
    crate(19.4, 7.4, 1.8, 1.8); barrow(8.6, 12.4);
    stain(12.5, 52.6, 2.2);
    tractor(12.5, 49.5, '#3f7a4a');
    barrel(8, 54, .8); barrel(9.4, 53.3, .7, '#6b5a2c');
    tires(20, 53.4); bucket(18, 54.4); lantern(7.4, 45.4);
    crate(20.2, 50.6, 1.8, 1.8); barrow(8.4, 46.6);
    bench(16.5, 46.4, 4.2, 1.4);
    line(17.4, 46.6, 17.4, 45.4, '#9aa2a8', 3); line(18.6, 46.6, 19.3, 45.5, '#9aa2a8', 3);

    /* 동물병원 (28,8 · 14×11) — 진료대 + 약장 + 우유통 */
    for (const bx of [29, 33.5]) {
      shadow(bx + 1.5, 18.1, 44, 12);
      box(bx, 14, 3, 4, '#e6e9e4', '#8f9a92', 5);
      box(bx + .25, 14.3, 2.5, 1.5, '#9fc9d8', null, 4);   // 머리쪽 시트
      g.strokeStyle = 'rgba(120,140,132,.6)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(px(bx), px(16.2)); g.lineTo(px(bx + 3), px(16.2)); g.stroke();
    }
    box(38, 10.2, 3, 1.6, '#d8dedd', '#8b968f', 4);       // 약장
    for (let i = 0; i < 6; i++) circ(38.35 + i * .45, 10.7, .16, ['#e05a5a','#5ab0e0','#e0c05a','#7ad07a','#c78ae0','#e0925a'][i]);
    circ(41, 12, .8, '#dfe6e4', '#93a09a'); circ(41, 12, .5, '#f6f9f8');   // 우유통
    circ(30.6, 11.2, .9, '#c9d6d0', '#8c9a94');
    line(28.4, 12.6, 30, 12.6, 'rgba(255,255,255,.25)', 3);
    box(34.6, 10, 2.4, 1.3, '#dfe6e4', '#93a09a', 4);    // 붕대 선반
    for (let i = 0; i < 4; i++) circ(34.9 + i * .6, 10.65, .22, '#f4efe4', '#c6bda9');
    chair(41, 16.4); bucket(29.2, 17.2, '#cfe0dd'); lantern(40.6, 9.4);

    /* 감시초소 (26,27 · 11×9) — 창문 판넬 + 망원경 + 책상 */
    box(27, 32, 6, 2, '#5a3a1e', '#301c0a', 4);
    for (let i = 0; i < 4; i++) {
      box(27.25 + i * 1.45, 32.25, 1.2, 1.5, '#2f4a56', '#7fb8c9', 3);
      g.fillStyle = 'rgba(160,220,240,.18)';
      g.fillRect(px(27.3 + i * 1.45), px(32.3), px(1.1), px(.5));
    }
    bench(33.6, 33.4, 2.6, 1.2);
    chair(30.4, 34.2); chair(31.8, 34.4); lantern(28, 34.6);
    crate(27.4, 29.6, 1.6, 1.6);
    circ(35.2, 29.6, .7, '#4a5560', '#252c33');          // 망원경 받침
    line(35.2, 29.6, 36.4, 28.6, '#7e8a94', 6);

    /* 사무실 (54,25 · 13×10) — 목장 지도 테이블 + 서류 */
    shadow(60.5, 31.2, 82, 16);
    box(58, 28, 5, 3, '#8a5f33', '#452a12', 5);
    box(58.3, 28.3, 4.4, 2.4, '#3f6a4a', '#2a4632', 4);   // 펼친 목장 지도
    g.strokeStyle = 'rgba(240,225,190,.45)'; g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(px(58.5), px(29.4)); g.lineTo(px(59.8), px(28.8)); g.lineTo(px(61), px(29.9)); g.lineTo(px(62.5), px(29.2));
    g.stroke();
    for (const [mx, my] of [[59.1,29.2],[60.6,30.1],[61.9,28.9]]) circ(mx, my, .16, '#e8c14a');
    box(55.4, 27, 1.8, 1.2, '#7a5028', '#3e2611', 3);     // 서류함
    box(64, 33.4, 1.6, 1.1, '#7a5028', '#3e2611', 3);
    chair(57.2, 30.2); chair(63.6, 30.2); lantern(65.4, 26.6);
    box(60.6, 26.2, 3.4, 1.4, '#5a3a1e', '#301c0a', 3);   // 벽 게시판
    for (let i = 0; i < 5; i++) box(60.85 + i * .62, 26.45, .45, .9, ['#e8e0cc','#d8ceb4','#e8e0cc','#cfe0d0','#e8e0cc'][i], null, 1);
    crate(55.4, 32.6, 1.6, 1.6);

    /* 농기구창고 (76,4 · 16×11) — 허수아비 + 연장 걸이 + 궤짝 */
    // 허수아비
    shadow(84, 10.4, 26, 9);
    line(84, 10.2, 84, 7.2, '#7a5028', 7);
    line(82.2, 8.4, 85.8, 8.4, '#7a5028', 5);
    circ(84, 6.7, .85, '#d9b25e', '#8a6a25');            // 밀짚 머리
    g.fillStyle = '#3c2a12';
    g.beginPath(); g.arc(px(83.75), px(6.6), 3, 0, 6.283); g.arc(px(84.35), px(6.6), 3, 0, 6.283); g.fill();
    box(83.1, 6.05, 1.8, .32, '#c79a3c', '#7a5620', 2);  // 모자 챙
    box(83.2, 7.4, 1.6, 2.2, '#6f8f4a', '#3d5228', 4);   // 옷
    for (let i = 0; i < 5; i++) line(82.2 - .1, 8.4 + i * .05, 81.7, 8.9 + i * .06, '#d9b25e', 2);
    // 연장 걸이 (벽)
    box(77, 5.5, 6, .5, '#5a3a1e', '#301c0a', 2);
    for (let i = 0; i < 5; i++) {
      const hx = 77.6 + i * 1.2;
      line(hx, 6, hx, 7.7, '#8a6a3a', 4);
      if (i % 2) { line(hx - .35, 7.7, hx + .35, 7.7, '#9aa2a8', 4); }      // 삽날
      else { for (let k = -1; k <= 1; k++) line(hx + k * .28, 7.6, hx + k * .28, 8.2, '#9aa2a8', 3); }  // 갈퀴
    }
    crate(88, 8, 2, 2); crate(90.2, 9.4, 1.8, 1.8); crate(77.5, 12, 2, 2);
    barrow(80.6, 12.4); bucket(87.4, 12.6); lantern(77.4, 9.6);
    bale(85.6, 12, 2.2, 1.4); tires(90.6, 12.6);

    /* 온실 (74,20 · 11×9) — 화단 이랑 + 새싹 + 물뿌리개 */
    for (const by of [21.4, 24.2, 27]) {
      box(74.6, by, 9.6, 1.5, '#4a3320', '#2c1d10', 4);
      for (let i = 0; i < 7; i++) bush(75.3 + i * 1.35, by + .75, .45);
    }
    bush(76.6, 25.2, .9, '#2f6b34', '#4e9445');
    circ(83.2, 22.6, .55, '#8fb6c4', '#4d6b78');         // 물뿌리개
    line(83.2, 22.6, 84.1, 22.2, '#8fb6c4', 5);
    bucket(75.2, 28.4); lantern(84.2, 27.6);
    for (const [bx2, by2] of [[83.6, 25.4],[82.4, 28.2]]) { circ(bx2, by2, .5, '#a9613a', '#6b3a20'); bush(bx2, by2 - .3, .42); }

    /* 망루 (88,26 · 11×10) — 나무 망루 + 지도 탁자 + 사다리 */
    shadow(93, 31.4, 62, 20);
    box(90.4, 27.4, 5.2, 5.2, '#8a5f33', '#452a12', 6);
    box(91, 28, 4, 4, '#6d4726', null, 5);
    g.strokeStyle = 'rgba(60,36,14,.55)'; g.lineWidth = 2;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(px(91), px(28 + i)); g.lineTo(px(95), px(28 + i)); g.stroke(); }
    for (const [cx2, cy2] of [[90.7,27.7],[95.3,27.7],[90.7,32.3],[95.3,32.3]]) circ(cx2, cy2, .32, '#5a3a1e', '#2c1a08');
    circ(93, 30, 1.1, '#3f6a4a', '#2a4632');             // 지도 탁자
    line(96.4, 27.6, 96.4, 32.4, '#7a5028', 5);          // 사다리
    line(97.4, 27.6, 97.4, 32.4, '#7a5028', 5);
    for (let i = 0; i < 5; i++) line(96.4, 28 + i, 97.4, 28 + i, '#9a6a38', 3);
    lantern(89.4, 28.4); bucket(89.2, 34.2); chair(93, 33.6);
    crate(94.6, 34.4, 1.7, 1.7); barrel(89.6, 31.4, .7, '#6b5a2c');

    /* 전기울타리 (74,42 · 13×11) — 울타리 줄 + 전기 상자 */
    for (let i = 0; i < 6; i++) post(75.2 + i * 2.1, 44.6);
    line(75.2, 43.9, 85.7, 43.9, 'rgba(190,200,210,.55)', 2);
    line(75.2, 44.3, 85.7, 44.3, 'rgba(190,200,210,.45)', 2);
    for (let i = 0; i < 6; i++) post(75.2 + i * 2.1, 51.4);
    line(75.2, 50.7, 85.7, 50.7, 'rgba(190,200,210,.55)', 2);
    line(75.2, 51.1, 85.7, 51.1, 'rgba(190,200,210,.45)', 2);
    box(79.2, 46.4, 1.8, 2.4, '#c9a63c', '#6b5416', 4);  // 전기 상자
    g.fillStyle = '#3a2c08'; g.font = `700 ${Math.round(T * .8)}px system-ui`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('⚡', px(80.1), px(47.6));
    bush(84.6, 48.4, .8, '#3c6b38', '#54934a');
    bush(76.4, 48.8, .7, '#3c6b38', '#54934a'); bush(82.6, 50, .55);
    trough(83.4, 46.4, 3, 1.1); bucket(77.2, 46.6); lantern(85.4, 44.8);
    hay(75.6, 49.6, 1.2);

    /* 방송실 (56,44 · 13×10) — 확성기 기둥 + 라디오 책상 */
    bench(59.6, 47.8, 4, 1.6);
    box(60, 48.1, 1.4, 1, '#4a5560', '#252c33', 3);      // 라디오
    for (let i = 0; i < 3; i++) circ(60.3 + i * .38, 48.85, .13, ['#e0d05a','#7ad07a','#e05a5a'][i]);
    line(61.2, 48.1, 61.9, 47.2, '#c9c9c9', 3);          // 안테나
    shadow(65.4, 51.4, 18, 7);
    line(65.4, 51.2, 65.4, 49.4, '#7a5028', 6);          // 확성기 기둥
    g.fillStyle = '#c9a63c'; g.strokeStyle = '#6b5416'; g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(px(64.8), px(49.4)); g.lineTo(px(66), px(49.4));
    g.lineTo(px(66.8), px(48.4)); g.lineTo(px(64), px(48.4));
    g.closePath(); g.fill(); g.stroke();
    crate(57, 51, 1.8, 1.8);
    chair(59.4, 49.6); lantern(67.4, 46);
    crate(66.6, 50.6, 1.7, 1.7); bucket(62.4, 51.6);
    line(61.9, 47.2, 64.6, 45.6, 'rgba(40,30,20,.55)', 2.4);   // 늘어진 전선

    /* 곡물창고 (36,40 · 16×15) — 자루 더미 + 궤짝 + 저울 */
    for (const [sx2, sy2, ss] of [[38.4,45.6,1],[40.2,45.2,.9],[39.2,47.4,1.05],[41.6,47.8,.85],[37.6,49.6,.95]])
      sack(sx2, sy2, ss);
    crate(43.6, 44.4, 2.2, 2.2); crate(45.8, 45.8, 2, 2); crate(47.6, 43.4, 2, 2);
    crate(44.4, 49.6, 2, 2);
    bale(37, 42, 2.4, 1.5);
    box(48.6, 50.4, 2.2, 1.6, '#6a6660', '#3b3934', 4);  // 저울
    box(49, 50, 1.4, .5, '#8d8a83', '#3b3934', 2);
    lantern(37.4, 43.4); bucket(46.6, 52.6); chair(43, 52.4);
    hay(50, 42.4, 1.3); sack(46.8, 51, .9);

    /* 발전기실 (22,41 · 12×11) — 발전기 2대 + 배전반 */
    for (const gx of [24, 31]) {
      shadow(gx + 1, 49.2, 30, 10);
      box(gx, 43, 2, 6, '#5e6b52', '#2f3628', 5);
      box(gx + .25, 43.4, 1.5, 1.6, '#3b4535', null, 3);
      g.strokeStyle = 'rgba(230,220,180,.28)'; g.lineWidth = 2;
      for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(px(gx + .2), px(45.4 + i * .55)); g.lineTo(px(gx + 1.8), px(45.4 + i * .55)); g.stroke(); }
      circ(gx + 1, 48.4, .3, '#e8c74a', '#6b5416');
    }
    box(27, 42.4, 3, 1.8, '#c9a63c', '#6b5416', 4);      // 배전반
    for (let i = 0; i < 4; i++) box(27.35 + i * .7, 42.8, .35, 1, '#3a2c08', null, 2);
    line(26, 43.3, 24.9, 43.3, '#2b2118', 3); line(30, 43.3, 31.1, 43.3, '#2b2118', 3);
    barrel(32.4, 50.4, .7, '#6b5a2c');
    stain(27.5, 47.6, 2, 'rgba(20,14,8,.14)');
    bucket(23.6, 51); lantern(23.2, 42.6); crate(29.4, 50.2, 1.6, 1.6);
  },

  /* ---------------- 메인 프레임 ---------------- */
  draw(state) {
    const g = this.g, me = state.me;
    // 캔버스가 아직 배치되지 않았거나(화면 전환·회전 순간) 크기가 0이면 그리지 않는다.
    // 0 크기로 그리면 안개 레이어 drawImage 가 매 프레임 예외를 던진다.
    if (!g || !(this.W > 0) || !(this.H > 0)) { this.resize(); return; }
    this.ensureMap();
    g.save();
    g.fillStyle = '#080b07'; g.fillRect(0, 0, this.W, this.H);

    // 카메라
    const sc = this.scale;
    let cx = me.x, cy = me.y;
    const halfW = this.W / (2 * sc), halfH = this.H / (2 * sc);
    if (WORLD_W > halfW * 2) cx = clamp(cx, halfW, WORLD_W - halfW); else cx = WORLD_W / 2;
    if (WORLD_H > halfH * 2) cy = clamp(cy, halfH, WORLD_H - halfH); else cy = WORLD_H / 2;
    this.cam.x = cx; this.cam.y = cy;
    let shx = 0, shy = 0;
    if (this.shake > 0) { shx = rnd(-this.shake, this.shake); shy = rnd(-this.shake, this.shake); this.shake *= 0.9; if (this.shake < 0.4) this.shake = 0; }

    g.translate(this.W / 2 + shx, this.H / 2 + shy);
    g.scale(sc, sc);
    g.translate(-cx, -cy);

    // 맵
    const vw = this.W / sc, vh = this.H / sc;
    const sx = clamp(cx - vw / 2, 0, WORLD_W), sy = clamp(cy - vh / 2, 0, WORLD_H);
    g.drawImage(this.mapCv, sx, sy, Math.min(vw, WORLD_W - sx), Math.min(vh, WORLD_H - sy),
                             sx, sy, Math.min(vw, WORLD_W - sx), Math.min(vh, WORLD_H - sy));

    // 시야 계산
    const R = state.visionR;
    const ghostView = state.ghost || state.spectate || state.lobby;
    let poly = null;
    if (!ghostView) {
      if (Math.hypot(me.x - this.visCache.x, me.y - this.visCache.y) > 5 || this.visCache.r !== R || !this.visCache.poly) {
        this.visCache = { x: me.x, y: me.y, r: R, poly: visibilityPolygon(me.x, me.y, R) };
      }
      poly = this.visCache.poly;
    }

    // 벤트
    for (const v of VENTS) {
      if (!ghostView && !this.inView(v.wx, v.wy, me, R, poly)) continue;
      const usable = state.canVent && Math.hypot(me.x - v.wx, me.y - v.wy) < 78;
      // 목장의 벤트 = 짚더미 아래 숨은 나무 뚜껑
      g.save(); g.translate(v.wx, v.wy);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(0, 4, 21, 13, 0, 0, 6.283); g.fill();
      g.fillStyle = '#5a3a1e'; g.beginPath(); g.ellipse(0, 0, 19, 12, 0, 0, 6.283); g.fill();
      g.strokeStyle = usable ? '#ffd23d' : '#3b2410'; g.lineWidth = usable ? 3 : 2.4;
      g.beginPath(); g.ellipse(0, 0, 19, 12, 0, 0, 6.283); g.stroke();
      g.strokeStyle = usable ? '#ffe58a' : '#8a6136'; g.lineWidth = 2.2;
      for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(-15, i * 6.2); g.lineTo(15, i * 6.2); g.stroke(); }
      g.fillStyle = usable ? '#ffd23d' : '#3b2410';                 // 손잡이 고리
      g.beginPath(); g.arc(0, 0, 3.2, 0, 6.283); g.fill();
      g.restore();
    }

    // 임무 표시
    for (const t of state.myTaskSpots) {
      const bob = Math.sin(performance.now() / 320 + t.wx) * 4;
      g.save(); g.translate(t.wx, t.wy - 34 + bob);
      g.fillStyle = t.next ? '#ffd23d' : 'rgba(255,210,61,.35)';
      g.beginPath(); g.moveTo(0, 10); g.lineTo(-9, -6); g.lineTo(9, -6); g.closePath(); g.fill();
      g.restore();
      // 소품 자체가 빛나게 (바닥 동그라미보다 '저 물건을 만져라'가 분명하다)
      const pulse = 0.5 + Math.sin(performance.now() / 400) * 0.3;
      g.save();
      g.shadowColor = `rgba(255,210,61,${t.next ? pulse : pulse * 0.4})`;
      g.shadowBlur = 18;
      g.strokeStyle = `rgba(255,210,61,${t.next ? 0.7 : 0.25})`; g.lineWidth = 2.5;
      g.beginPath(); g.roundRect(t.wx - 20, t.wy - 26, 40, 44, 9); g.stroke();
      g.restore();
    }

    // 사보타주 지점
    if (state.sabotage) {
      const spots = SAB_SPOTS[state.sabotage.kind] || [];
      for (const s of spots) {
        g.save(); g.translate(s.wx, s.wy);
        const pulse = 0.5 + Math.sin(performance.now() / 200) * 0.5;
        g.fillStyle = `rgba(255,70,70,${0.25 + pulse * 0.35})`;
        g.beginPath(); g.arc(0, 0, 30, 0, 6.283); g.fill();
        g.fillStyle = '#fff'; g.font = '700 22px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('⚠', 0, 0); g.restore();
      }
    }

    // 긴급 소집 = 헛간 종
    {
      const b = EMERGENCY_BTN;
      if (ghostView || this.inView(b.wx, b.wy, me, R, poly)) {
        g.save(); g.translate(b.wx, b.wy);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(0, 16, 18, 6, 0, 0, 6.283); g.fill();
        g.strokeStyle = '#6d4726'; g.lineWidth = 6; g.lineCap = 'round';   // 기둥과 가로대
        g.beginPath(); g.moveTo(0, 16); g.lineTo(0, -18); g.moveTo(-13, -18); g.lineTo(13, -18); g.stroke();
        g.fillStyle = '#d8a63a'; g.strokeStyle = '#7a5510'; g.lineWidth = 2.4;   // 종
        g.beginPath();
        g.moveTo(-11, 6); g.quadraticCurveTo(-11, -11, 0, -13);
        g.quadraticCurveTo(11, -11, 11, 6); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#b8862a'; g.beginPath(); g.roundRect(-12, 5, 24, 4, 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,.35)';
        g.beginPath(); g.ellipse(-4, -4, 2.6, 6, .2, 0, 6.283); g.fill();
        g.fillStyle = '#7a5510'; g.beginPath(); g.arc(0, 10, 3, 0, 6.283); g.fill();   // 추
        g.restore();
      }
    }

    // 잠긴 문 — 빗장이 흐르고 숨 쉬듯 깜빡인다
    for (const roomId in state.doors) {
      const r = ROOMS.find(x => x.id === roomId); if (!r) continue;
      const t = performance.now();
      const pulse = 0.55 + Math.sin(t / 260) * 0.28;
      g.save();
      g.strokeStyle = `rgba(255,70,60,${pulse})`; g.lineWidth = 7;
      g.setLineDash([14, 9]); g.lineDashOffset = -(t / 26) % 23;
      g.strokeRect(r.x * TILE + 3, r.y * TILE + 3, r.w * TILE - 6, r.h * TILE - 6);
      g.strokeStyle = `rgba(120,20,14,${pulse * .7})`; g.lineWidth = 11; g.setLineDash([]);
      g.strokeRect(r.x * TILE + 3, r.y * TILE + 3, r.w * TILE - 6, r.h * TILE - 6);
      g.restore();
    }

    // 시체
    for (const b of state.bodies) {
      if (!ghostView && !this.inView(b.x, b.y, me, R, poly)) continue;
      this.drawBody(g, b);
    }

    // 플레이어
    const drawList = state.others.filter(p => {
      if (p.id === state.me.id) return false;
      if (ghostView) return true;
      if (!p.alive) return false;                       // 유령은 산 사람에게 안 보임
      if (p.ventId || p.hideId) return false;
      if (!p.seen) return false;                        // 스냅샷에 없다 = 지금 없는 사람 (좌표가 낡음)
      return this.inView(p.x, p.y, me, R, poly);
    });
    // 근접한 건초더미 — 더미 자체가 살며시 빛나고 🌾 핀이 뜬다 (내 화면에만)
    if (!ghostView && me.alive && !me.ventId && !me.hideId && typeof HIDE_SPOTS !== 'undefined') {
      const OFF = { N: [0, -22], S: [0, 15], E: [20, 0], W: [-20, 0] };
      for (const hs of HIDE_SPOTS) {
        const d = Math.hypot(me.x - hs.wx, me.y - hs.wy);
        if (d > 120) continue;
        const near = d < 80;
        const [fx2, fy2] = OFF[hs.wall] || [0, 0];
        const cx2 = hs.wx + fx2 * 1.1, cy2 = hs.wy + fy2 * 1.1;
        g.save();
        g.shadowColor = `rgba(226,195,122,${near ? .8 : .35})`; g.shadowBlur = 22;
        g.strokeStyle = `rgba(226,195,122,${near ? .6 : .2})`; g.lineWidth = 2.5;
        if (hs.type === 'locker') { g.beginPath(); g.roundRect(cx2 - 19, cy2 - 32, 38, 56, 6); g.stroke(); }
        else { g.beginPath(); g.ellipse(cx2, cy2 - 6, 30, 24, 0, 0, 6.283); g.stroke(); }
        g.restore();
        if (near) {
          const bob = Math.sin(performance.now() / 300) * 4;
          g.font = '700 17px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(hs.type === 'locker' ? '🚪' : '🌾', cx2, cy2 - (hs.type === 'locker' ? 48 : 40) + bob);
        }
      }
    }
    // 벤트 뚜껑(내가 숨은 표시)은 바닥이므로 다른 캐릭터들 아래에 먼저
    if (me.ventId) this.drawInVent(g, me);
    // y 로 정렬해 아래(앞) 캐릭터가 위(뒤) 캐릭터를 가리게 한다.
    // 정렬이 없으면 뒤에 선 캐릭터가 앞 캐릭터의 발을 덮는 역전이 생긴다.
    const meHidden = !!me.hideId;
    const chars = [...drawList, ...((me.ventId || meHidden) ? [] : [state.me])].sort((a, b) => a.y - b.y);
    for (const p of chars) this.drawDuck(g, p, state, p.id === state.me.id);
    if (meHidden) {
      const hs = typeof HIDE_SPOTS !== 'undefined' ? HIDE_SPOTS.find(h => h.id === me.hideId) : null;
      if (hs?.type === 'locker') this.drawInLocker(g, state.me);
      else this.drawInHay(g, state.me);
    }

    /* 연출 */
    {
      const now = performance.now();
      const dt = Math.min(50, now - (this._fxT || now - 16.7)); this._fxT = now;
      // 걸음 먼지 — 보이는 사람만. 유령은 발이 땅에 안 닿으니 제외
      for (const p of [state.me, ...drawList]) {
        if (!p.moving || !p.alive || p.ventId) continue;
        if ((this.stepT[p.id] || 0) > now) continue;
        this.stepT[p.id] = now + 150;
        this.dustAt(p.x, p.y, p.dir < 0 ? -1 : 1);
      }
      this.updateFx(dt);
      this.drawFx(g);
    }

    g.restore();

    /* 안개(시야 밖 어둡게).
     * 주의: destination-out 을 메인 캔버스에 직접 쓰면 이미 그려진 맵·캐릭터까지
     * 함께 지워져 시야 안이 투명(= 검정)이 된다. 반드시 별도 레이어에서 뚫은 뒤 얹는다. */
    if (!ghostView && poly) {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const f = this.fogCv || (this.fogCv = document.createElement('canvas'));
      if (f.width !== this.cv.width || f.height !== this.cv.height) { f.width = this.cv.width; f.height = this.cv.height; }
      const fg = f.getContext('2d');
      fg.setTransform(1, 0, 0, 1, 0, 0);
      fg.clearRect(0, 0, f.width, f.height);
      fg.scale(dpr, dpr);
      fg.globalCompositeOperation = 'source-over';
      fg.fillStyle = 'rgba(8,12,7,0.94)';
      fg.fillRect(0, 0, this.W, this.H);
      fg.globalCompositeOperation = 'destination-out';
      fg.translate(this.W / 2 + shx, this.H / 2 + shy); fg.scale(sc, sc); fg.translate(-cx, -cy);
      const grad = fg.createRadialGradient(me.x, me.y, R * 0.55, me.x, me.y, R);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.75, 'rgba(0,0,0,0.96)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      fg.fillStyle = grad;
      fg.beginPath(); poly.forEach((p, i) => i ? fg.lineTo(p[0], p[1]) : fg.moveTo(p[0], p[1])); fg.closePath(); fg.fill();

      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(f, 0, 0);
      g.restore();
    }

    /* 이름·말풍선·배지 — 안개 '위'에 그린다.
     * 월드 패스에서 그리면 머리 위가 벽(시야 밖)일 때 안개에 덮여
     * 자기 닉네임조차 안 보였다. 라벨은 월드가 아니라 UI 다. */
    {
      g.save();
      g.translate(this.W / 2 + shx, this.H / 2 + shy);
      g.scale(sc, sc);
      g.translate(-cx, -cy);
      const labeled = [...drawList, ...((me.ventId || me.hideId) ? [] : [state.me])].sort((a, b) => a.y - b.y);
      for (const p of labeled) this.drawLabels(g, p, state, p.id === state.me.id);
      g.restore();
    }

    // 길안내 (안개 위에 그려야 보인다)
    if (state.guides?.length) this.drawGuides(g, state, cx, cy, sc, shx, shy);
  },

  /** 이름표 + 말풍선 + 늑대 배지 — 안개 위 라벨 패스에서 호출 */
  drawLabels(g, p, state, isMe) {
    const dead = !p.alive;
    g.save(); g.translate(p.x, p.y);
    if (state.duckMates?.includes(p.id) && !isMe) {
      g.fillStyle = '#ff5f6d'; g.font = '700 15px system-ui'; g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillText('🐺', 0, -46);
    }
    const shownName = p.morphName || p.name;
    if (shownName) {
      g.font = '700 13px "Pretendard", system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'bottom';
      const w = g.measureText(shownName).width;
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect(-w / 2 - 5, -46, w + 10, 17);
      g.fillStyle = dead ? '#9aa4b8' : (isMe ? '#ffd88a' : '#fff');   // 내 이름은 금색
      g.fillText(shownName, 0, -33);
    }
    if (p.bubble && Date.now() < p.bubble.until && p.alive) {
      const txt = p.bubble.text;
      g.font = '700 12.5px "Pretendard", system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = Math.min(g.measureText(txt).width, 150);
      const bw = tw + 18, bh = 24, by = -66;
      g.fillStyle = '#f6f1e6';
      g.strokeStyle = 'rgba(36,26,18,.9)'; g.lineWidth = 2;
      g.beginPath(); g.roundRect(-bw / 2, by - bh / 2, bw, bh, 11); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-5, by + bh / 2 - 1); g.lineTo(0, by + bh / 2 + 7); g.lineTo(6, by + bh / 2 - 1);
      g.closePath(); g.fill();
      g.fillStyle = '#2b2016';
      g.save(); g.beginPath(); g.rect(-bw / 2 + 4, by - bh / 2, bw - 8, bh); g.clip();
      g.fillText(txt, 0, by + 1); g.restore();
    }
    g.restore();
  },

  /* ---------------- 길안내 화살표 ----------------
   * 처음 하는 사람은 "전기실"이라고 써 있어도 전기실이 어딘지 모른다.
   * 화면 밖 목표는 가장자리 화살표로, 화면 안 목표는 링으로 알려준다. */
  drawGuides(g, state, cx, cy, sc, shx, shy) {
    const W = this.W, H = this.H, me = state.me;
    const pad = 46;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = Math.min(devicePixelRatio || 1, 2); g.scale(dpr, dpr);
    g.textAlign = 'center'; g.textBaseline = 'middle';

    for (const t of state.guides) {
      const sx = (t.wx - cx) * sc + W / 2 + shx;
      const sy = (t.wy - cy) * sc + H / 2 + shy;
      const dist = Math.round(Math.hypot(t.wx - me.x, t.wy - me.y) / TILE);
      const inside = sx > pad && sx < W - pad && sy > pad && sy < H - pad;

      if (inside) continue;                      // 화면 안이면 월드 마커로 충분

      // 화면 가장자리로 밀어낸 위치 계산
      const dx = sx - W / 2, dy = sy - H / 2;
      const ang = Math.atan2(dy, dx);
      const hw = W / 2 - pad, hh = H / 2 - pad;
      const scale = Math.min(hw / Math.abs(Math.cos(ang) || 1e-6), hh / Math.abs(Math.sin(ang) || 1e-6));
      const ex = W / 2 + Math.cos(ang) * scale, ey = H / 2 + Math.sin(ang) * scale;

      g.save();
      g.translate(ex, ey);
      // 배경 원
      g.fillStyle = 'rgba(8,14,28,.88)';
      g.strokeStyle = t.color; g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, 21, 0, 6.283); g.fill(); g.stroke();
      // 화살표
      g.save(); g.rotate(ang);
      g.fillStyle = t.color;
      g.beginPath(); g.moveTo(17, 0); g.lineTo(7, -6.5); g.lineTo(7, 6.5); g.closePath(); g.fill();
      g.restore();
      // 아이콘
      g.font = '700 15px system-ui'; g.fillStyle = '#fff';
      g.fillText(t.icon, 0, 0.5);
      g.restore();

      // 라벨 (방 이름 + 거리) — 화면 안쪽으로 붙인다
      const lx = ex - Math.cos(ang) * 34, ly = ey - Math.sin(ang) * 34;
      const label = `${t.label} ${dist}m`;
      g.font = '700 11.5px "Pretendard", system-ui, sans-serif';
      const w = g.measureText(label).width;
      g.fillStyle = 'rgba(8,14,28,.85)';
      g.beginPath(); g.roundRect(lx - w / 2 - 6, ly - 9, w + 12, 18, 9); g.fill();
      g.fillStyle = t.color;
      g.fillText(label, lx, ly);
    }
    g.restore();
  },

  inView(x, y, me, R, poly) {
    const d = Math.hypot(x - me.x, y - me.y);
    if (d > R) return false;
    if (d < 40) return true;
    return !lineBlocked(me.x, me.y, x, y);
  },

  /* ---------------- 양 몸체 (원점 기준) ----------------
   * 월드 렌더링과 킬 연출이 같은 그림을 쓰도록 분리해 둔다. */
  /** 양 캐릭터. 양털이 플레이어 색, 얼굴은 진회색(서퍽종) — 어떤 색 양털과도 대비된다.
   *  머리가 +x 쪽에 있어 앞으로 내밀어져 진행 방향을 알려준다. */
  charShape(g, col, o = {}) {
    const { dead = false, moving = false, t = 0 } = o;
    const OUT = '#241a12';                 // 모든 색 공통 외곽선
    const FACE = '#4a4351', FACE_D = '#2b2634', FACE_L = '#5d5566';
    const LEG = '#3b3542', HOOF = '#241f2b';

    /* 구스구스덕처럼 세로로 서서 정면을 본다.
     * 진행 방향은 호출부의 좌우 반전 + 눈동자 쏠림으로 표현한다. */

    /* ── 발 두 개 (짧고 뭉툭) ── */
    if (!dead) {
      const sw = moving ? Math.sin(t / 105) * 2.4 : 0;
      const foot = (x, off) => {
        g.fillStyle = OUT;
        g.beginPath(); g.roundRect(x - 4.4 + off, 10, 8.8, 12.4, 4.4); g.fill();
        g.fillStyle = LEG;
        g.beginPath(); g.roundRect(x - 3.2 + off, 10.6, 6.4, 11.2, 3.2); g.fill();
        g.fillStyle = HOOF;
        g.beginPath(); g.roundRect(x - 3.2 + off, 17.6, 6.4, 4.2, 2.1); g.fill();
      };
      foot(-6, sw); foot(6, -sw);
    }

    /* ── 몸통 양털 — 세로 서양배 실루엣 ──
     * 부풀린 같은 실루엣을 어둡게 먼저 깔아 이음매 없는 외곽선을 만든다. */
    const BUMPS = [[-9,-15,5.4],[0,-18,6],[9,-15,5.4],[-12,-6,5.2],[12,-6,5.2],
                   [-11,4,5.6],[11,4,5.6],[-6,10,5.6],[6,10,5.6],[0,11,5.8]];
    const fleece = (grow) => {
      g.beginPath();
      g.ellipse(0, -2, 12.6 + grow, 14.6 + grow, 0, 0, 6.283);
      for (const [bx, by, br] of BUMPS) { g.moveTo(bx + br + grow, by); g.arc(bx, by, br + grow, 0, 6.283); }
    };
    g.fillStyle = OUT; fleece(2.4); g.fill();
    g.fillStyle = col.hex; fleece(0); g.fill();
    // 음영 — 위 밝고 아래 어둡게
    g.save(); fleece(0); g.clip();
    const sh = g.createLinearGradient(0, -19, 0, 17);
    sh.addColorStop(0, 'rgba(255,255,255,.24)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(0,0,0,.26)');
    g.fillStyle = sh; g.fillRect(-22, -26, 44, 46);
    g.restore();

    /* ── 얼굴판 — 몸 위쪽에 정면으로 ── */
    const head = (grow) => { g.beginPath(); g.ellipse(0, -9.5, 9.6 + grow, 9.2 + grow, 0, 0, 6.283); };
    g.fillStyle = 'rgba(255,238,208,.35)'; head(1.1); g.fill();   // 털과 분리해 주는 밝은 테
    g.fillStyle = FACE; head(0); g.fill();
    g.save(); head(0); g.clip();
    g.fillStyle = FACE_L;                                          // 이마 쪽 밝게
    g.beginPath(); g.ellipse(0, -14, 9, 5.5, 0, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(0,0,0,.2)';                                // 턱 쪽 어둡게
    g.beginPath(); g.ellipse(0, -3.5, 8.5, 4, 0, 0, 6.283); g.fill();
    g.restore();

    /* ── 귀 — 얼굴 양옆으로 처진 잎사귀 ── */
    for (const sx of [-1, 1]) {
      g.fillStyle = OUT;
      g.beginPath(); g.ellipse(sx * 10.5, -7.5, 4.6, 3, sx * 0.5, 0, 6.283); g.fill();
      g.fillStyle = FACE;
      g.beginPath(); g.ellipse(sx * 10.7, -7.6, 3.3, 2, sx * 0.5, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.beginPath(); g.ellipse(sx * 11.2, -7.7, 1.7, 1, sx * 0.5, 0, 6.283); g.fill();
    }

    /* ── 정수리 양털 모자 ── */
    g.fillStyle = OUT;
    g.beginPath(); g.arc(-4, -17.5, 5.6, 0, 6.283); g.arc(2.5, -19, 5.9, 0, 6.283); g.arc(7.5, -16.5, 4.7, 0, 6.283); g.fill();
    g.fillStyle = col.hex;
    g.beginPath(); g.arc(-4, -17.5, 4, 0, 6.283); g.fill();
    g.beginPath(); g.arc(2.5, -19, 4.3, 0, 6.283); g.fill();
    g.beginPath(); g.arc(7.5, -16.5, 3.1, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(255,255,255,.28)';
    g.beginPath(); g.arc(1.5, -20.2, 2.2, 0, 6.283); g.fill();

    /* ── 눈 — 구스구스덕식 큰 왕눈 두 개 (살짝 겹침) ── */
    if (dead) {
      g.strokeStyle = '#efe8f2'; g.lineWidth = 2; g.lineCap = 'round';
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.moveTo(sx * 4.6 - 2.2, -12.2); g.lineTo(sx * 4.6 + 2.2, -7.8);
        g.moveTo(sx * 4.6 + 2.2, -12.2); g.lineTo(sx * 4.6 - 2.2, -7.8);
        g.stroke();
      }
    } else {
      const lookX = moving ? 1.5 : Math.sin(t / 900) * 1.0;
      const blink = (t % 4600) < 130 ? 0.12 : 1;
      // 흰자 (왼쪽이 살짝 크다 — 구스구스덕의 비대칭 왕눈)
      g.fillStyle = OUT;
      g.beginPath(); g.ellipse(-3.9, -10.2, 4.9, 5.6 * blink + 0.4, 0, 0, 6.283); g.fill();
      g.beginPath(); g.ellipse(4.3, -10.4, 4.3, 5.0 * blink + 0.4, 0, 0, 6.283); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(-3.9, -10.2, 4.1, 4.8 * blink, 0, 0, 6.283); g.fill();
      g.beginPath(); g.ellipse(4.3, -10.4, 3.5, 4.2 * blink, 0, 0, 6.283); g.fill();
      if (blink > 0.5) {
        g.fillStyle = '#171322';
        g.beginPath(); g.arc(-3.0 + lookX, -9.8, 1.75, 0, 6.283); g.fill();
        g.beginPath(); g.arc(5.1 + lookX, -10, 1.6, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(255,255,255,.95)';
        g.beginPath(); g.arc(-2.4 + lookX, -10.8, 0.75, 0, 6.283); g.fill();
        g.beginPath(); g.arc(5.7 + lookX, -11, 0.68, 0, 6.283); g.fill();
      }
      // 주둥이 + 콧구멍
      g.fillStyle = FACE_L;
      g.beginPath(); g.ellipse(0, -3.6, 3.6, 2.6, 0, 0, 6.283); g.fill();
      g.fillStyle = FACE_D;
      g.beginPath(); g.ellipse(-1.1, -3.7, 0.7, 1, 0.2, 0, 6.283); g.fill();
      g.beginPath(); g.ellipse(1.1, -3.7, 0.7, 1, -0.2, 0, 6.283); g.fill();
    }
  },

  /* ---------------- 양 캐릭터 ---------------- */
  drawDuck(g, p, state, isMe) {
    const col = colorOf(p.morphColor || p.color);
    const dead = !p.alive;
    const t = performance.now();
    const bob = p.moving ? Math.abs(Math.sin(t / 105)) * 4 : Math.sin(t / 620) * 1.4;
    const flip = p.dir < 0 ? -1 : 1;

    g.save();
    g.translate(p.x, p.y);
    if (dead) g.globalAlpha = 0.5;

    // 그림자
    g.fillStyle = 'rgba(0,0,0,.42)';
    g.beginPath(); g.ellipse(0, 22.5, 16, 5, 0, 0, 6.283); g.fill();

    if (dead) g.translate(0, -6 + Math.sin(t / 700) * 3);
    g.translate(0, -bob);
    g.scale(flip, 1);

    this.charShape(g, col, { dead, moving: p.moving, t });
    g.restore();

    /* 상태 배지 / 이름 */
    g.save(); g.translate(p.x, p.y);
    if (p.shielded) {
      g.strokeStyle = 'rgba(120,220,255,.85)'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(0, -2, 25 + Math.sin(t / 260) * 1.6, 0, 6.283); g.stroke();
    }
    g.restore();
  },

  /** 벤트 안에 있는 나 — 몸은 감추고, 어느 벤트에 들어 있는지만 알려 준다.
   *  아무것도 안 그리면 화면에 내가 사라져 방향 감각을 잃는다. */
  drawInVent(g, me) {
    const t = performance.now();
    g.save(); g.translate(me.x, me.y);
    // 살짝 열린 뚜껑 틈
    g.fillStyle = '#120c06';
    g.beginPath(); g.ellipse(0, 0, 20, 13, 0, 0, 6.283); g.fill();
    // 어둠 속에서 반짝이는 눈 두 개
    const blink = (t % 3400) < 140 ? 0.15 : 1;
    g.fillStyle = `rgba(255,225,140,${0.9 * blink})`;
    g.beginPath(); g.ellipse(-5, -1, 2.6, 2.6 * blink, 0, 0, 6.283); g.fill();
    g.beginPath(); g.ellipse(5, -1, 2.6, 2.6 * blink, 0, 0, 6.283); g.fill();
    // 여기 있다는 표시 (숨 쉬듯)
    g.strokeStyle = `rgba(255,210,61,${0.35 + Math.sin(t / 340) * 0.2})`; g.lineWidth = 2.5;
    g.beginPath(); g.ellipse(0, 0, 24 + Math.sin(t / 340) * 2.5, 16 + Math.sin(t / 340) * 1.7, 0, 0, 6.283); g.stroke();
    g.font = '700 11.5px "Pretendard", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(-30, -40, 60, 16);
    g.fillStyle = '#ffd23d'; g.fillText('숨는 중', 0, -27);
    g.restore();
  },

  /** 건초에 숨은 나 — 더미 위에 눈만 빼꼼. 남에게는 안 그려진다(서버 컬링) */
  /** 사물함 속의 나 — 문틈으로 눈만 */
  drawInLocker(g, me) {
    const t = performance.now();
    const blink = (t % 3600) < 140 ? 0.15 : 1;
    g.save(); g.translate(me.x, me.y - 8);
    g.fillStyle = 'rgba(8,6,4,.9)';
    g.fillRect(-2.2, -16, 4.4, 34);                       // 살짝 벌어진 문틈
    g.fillStyle = `rgba(255,235,170,${0.95 * blink})`;
    g.beginPath(); g.ellipse(0, -6, 1.6, 2.2 * blink, 0, 0, 6.283); g.fill();
    g.restore();
    g.font = '700 11.5px "Pretendard", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(me.x - 33, me.y - 56, 66, 16);
    g.fillStyle = '#c9c4b8'; g.fillText('🚪 숨는 중', me.x, me.y - 43);
  },

  drawInHay(g, me) {
    const t = performance.now();
    const breathe = 1 + Math.sin(t / 700) * 0.02;
    const blink = (t % 3800) < 140 ? 0.15 : 1;
    g.save(); g.translate(me.x, me.y);
    g.scale(1, breathe);                          // 숨쉬는 건초
    // 내 몸을 덮은 건초 무더기
    g.fillStyle = '#2b1a0a';
    g.beginPath(); g.ellipse(0, -2, 33, 24, 0, 0, 6.283); g.fill();
    g.fillStyle = '#d9b25f';
    g.beginPath(); g.ellipse(0, -2, 30, 21, 0, 0, 6.283); g.fill();
    g.fillStyle = '#e8c87a';
    g.beginPath(); g.ellipse(-6, -8, 15, 9, -0.3, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(140,100,40,.5)'; g.lineWidth = 1.5;
    for (const [sx, sy, ex, ey] of [[-16,0,-6,-8],[4,-14,12,-5],[-2,6,10,10]]) {
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
    }
    // 벌어진 틈 + 눈
    g.fillStyle = 'rgba(20,12,4,.85)';
    g.beginPath(); g.ellipse(0, -4, 11, 6.5, 0, 0, 6.283); g.fill();
    g.fillStyle = `rgba(255,235,170,${0.95 * blink})`;
    g.beginPath(); g.ellipse(-4.2, -4, 2.3, 2.3 * blink, 0, 0, 6.283); g.fill();
    g.beginPath(); g.ellipse(4.2, -4, 2.3, 2.3 * blink, 0, 0, 6.283); g.fill();
    g.restore();
    g.font = '700 11.5px "Pretendard", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(me.x - 33, me.y - 44, 66, 16);
    g.fillStyle = '#e2c37a'; g.fillText('🌾 숨는 중', me.x, me.y - 31);
  },

  /** 쓰러진 양 — 옆으로 누워 다리가 뻗어 있다.
   *  살아있는 양과 같은 외곽선·양털 실루엣을 써야 같은 게임의 그림으로 보인다. */
  drawBody(g, b) {
    const col = colorOf(b.color);
    const OUT = '#241a12', FACE = '#4a4351', FACE_D = '#2b2634', LEG = '#3b3542';
    g.save(); g.translate(b.x, b.y);

    // 핏자국
    g.fillStyle = 'rgba(120,16,26,.5)';
    g.beginPath(); g.ellipse(0, 11, 29, 13, 0, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(168,26,36,.45)';
    g.beginPath(); g.ellipse(9, 15, 13, 6.5, 0, 0, 6.283); g.fill();

    g.rotate(-0.42);

    // 위로 뻗은 짧고 뭉툭한 발 (살아있을 때와 같은 모양이어야 한 세트로 보인다)
    const foot = (x, y, ang) => {
      g.save(); g.translate(x, y); g.rotate(ang);
      g.fillStyle = OUT;
      g.beginPath(); g.roundRect(-4.4, -12.4, 8.8, 13.6, 4.4); g.fill();
      g.fillStyle = LEG;
      g.beginPath(); g.roundRect(-3.3, -11.6, 6.6, 12.4, 3.3); g.fill();
      g.fillStyle = '#241f2b';
      g.beginPath(); g.roundRect(-3.3, -11.6, 6.6, 4.2, 2.1); g.fill();
      g.restore();
    };
    foot(1, -6, 0.2); foot(10, -4, 0.46);

    // 양털 (누운 모양) — 살아있을 때와 같은 합집합 + 외곽선 방식
    const BUMPS = [[-10,-6,5],[0,-8.5,5.4],[9,-5,4.8],[12,4,4.4],[-12,5,4.6],[2,7,4.6]];
    const path = (grow) => {
      g.beginPath();
      g.ellipse(0, 0, 15 + grow, 10 + grow, 0, 0, 6.283);
      for (const [bx, by, br] of BUMPS) { g.moveTo(bx + br + grow, by); g.arc(bx, by, br + grow, 0, 6.283); }
    };
    g.fillStyle = OUT; path(2.4); g.fill();
    g.fillStyle = col.hex; path(0); g.fill();
    g.save(); path(0); g.clip();
    const sh = g.createLinearGradient(0, -12, 0, 12);
    sh.addColorStop(0, 'rgba(255,255,255,.18)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(0,0,0,.3)');
    g.fillStyle = sh; g.fillRect(-22, -20, 44, 36);
    g.restore();

    // 얼굴 (축 늘어짐) — 살아있을 때처럼 밝은 테로 몸에서 떼어 놓는다
    const head = (grow) => { g.beginPath(); g.ellipse(-16.5, -1, 8.4 + grow, 7.2 + grow, -0.22, 0, 6.283); };
    g.fillStyle = OUT; head(2.4); g.fill();
    g.fillStyle = 'rgba(255,238,208,.3)'; head(1.1); g.fill();
    g.fillStyle = FACE; head(0); g.fill();
    // 처진 귀
    g.fillStyle = OUT; g.beginPath(); g.ellipse(-9.5, 4.5, 3.6, 5.6, 0.7, 0, 6.283); g.fill();
    g.fillStyle = FACE_D; g.beginPath(); g.ellipse(-9.5, 4.4, 2.4, 4.2, 0.7, 0, 6.283); g.fill();
    // 주둥이 + 코
    g.fillStyle = '#5d5566';
    g.beginPath(); g.ellipse(-22.5, 1.5, 3.4, 2.6, -0.2, 0, 6.283); g.fill();
    g.fillStyle = FACE_D;
    g.beginPath(); g.ellipse(-23.6, 1.4, 1.8, 1.3, -0.2, 0, 6.283); g.fill();
    // X 눈
    g.strokeStyle = '#efe8f2'; g.lineWidth = 2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-18.5, -5.5); g.lineTo(-13.8, -0.8); g.moveTo(-13.8, -5.5); g.lineTo(-18.5, -0.8); g.stroke();
    g.restore();
  },

  /* ---------------- 미니맵 ---------------- */
  drawMinimap(cv, state, opts = {}) {
    const g = cv.getContext('2d');
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 8;
    const s = Math.min((r.width - pad * 2) / WORLD_W, (r.height - pad * 2) / WORLD_H);
    const ox = (r.width - WORLD_W * s) / 2, oy = (r.height - WORLD_H * s) / 2;
    g.fillStyle = '#0f130c'; g.fillRect(0, 0, r.width, r.height);
    g.save(); g.translate(ox, oy); g.scale(s, s);

    // 방 — 바닥 재질 색을 그대로 써서 큰 지도와 같은 인상을 준다
    for (const rm of ROOMS) {
      const pal = this.FLOORS[rm.floor] || this.FLOORS.dirt;
      g.fillStyle = pal.base; g.globalAlpha = .62;
      g.fillRect(rm.x * TILE, rm.y * TILE, rm.w * TILE, rm.h * TILE);
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(214,164,104,.65)'; g.lineWidth = 5;
      g.strokeRect(rm.x * TILE, rm.y * TILE, rm.w * TILE, rm.h * TILE);
    }
    for (const hl of HALLS) { g.fillStyle = 'rgba(92,70,48,.6)'; g.fillRect(hl.x * TILE, hl.y * TILE, hl.w * TILE, hl.h * TILE); }
    if (opts.camRooms) for (const id of opts.camRooms) {
      const rm = ROOMS.find(x => x.id === id); if (!rm) continue;
      g.fillStyle = 'rgba(95,208,255,.16)'; g.fillRect(rm.x * TILE, rm.y * TILE, rm.w * TILE, rm.h * TILE);
      g.strokeStyle = '#5fd0ff'; g.lineWidth = 8;
      g.strokeRect(rm.x * TILE, rm.y * TILE, rm.w * TILE, rm.h * TILE);
    }
    g.restore();

    // 방 이름 — 지도가 작아지면 글자가 서로 겹쳐 읽을 수 없게 된다.
    // 방 폭 안에 들어갈 때까지 줄이고, 그래도 안 되면 생략한다.
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const base = Math.max(8, 11 * (r.width / 380));
    for (const rm of ROOMS) {
      const boxW = rm.w * TILE * s - 6;
      let fs = base;
      for (; fs >= 6.5; fs -= 0.5) {
        g.font = `700 ${fs}px "MamongDisplay", "Pretendard", system-ui`;
        if (g.measureText(rm.name).width <= boxW) break;
      }
      if (fs < 6.5) continue;                       // 이 크기에선 도저히 안 들어간다
      const lx = ox + (rm.x + rm.w / 2) * TILE * s, ly = oy + (rm.y + rm.h / 2) * TILE * s;
      g.fillStyle = 'rgba(24,14,6,.75)'; g.fillText(rm.name, lx, ly + 1);
      g.fillStyle = 'rgba(255,240,214,.92)'; g.fillText(rm.name, lx, ly);
    }

    // 임무 마커
    if (opts.tasks) for (const t of opts.tasks) {
      g.fillStyle = t.next ? '#ffd23d' : 'rgba(255,210,61,.4)';
      g.beginPath(); g.arc(ox + t.wx * s, oy + t.wy * s, 4.5, 0, 6.283); g.fill();
    }
    // 사보타주
    if (state.sabotage) for (const sp of (SAB_SPOTS[state.sabotage.kind] || [])) {
      g.fillStyle = '#ff4444';
      g.beginPath(); g.arc(ox + sp.wx * s, oy + sp.wy * s, 6, 0, 6.283); g.fill();
    }
    // 관리실 모드: 방별 인원수 (서버가 계산해 준 값)
    if (opts.adminCounts) {
      const counts = opts.adminCounts;
      for (const rm of ROOMS) {
        const n = counts[rm.id] || 0; if (!n) continue;
        const cx = ox + (rm.x + rm.w / 2) * TILE * s, cy = oy + (rm.y + rm.h / 2) * TILE * s + 14;
        g.fillStyle = 'rgba(255,210,61,.95)'; g.beginPath(); g.arc(cx, cy, 10, 0, 6.283); g.fill();
        g.fillStyle = '#101828'; g.font = '700 12px system-ui'; g.fillText(String(n), cx, cy + 1);
      }
    }
    // 내 위치
    if (opts.me) {
      g.fillStyle = colorOf(opts.me.color).hex;
      g.beginPath(); g.arc(ox + opts.me.x * s, oy + opts.me.y * s, 6, 0, 6.283); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    }
    // 유령 시야: 전원 표시
    if (opts.showAll) for (const p of opts.showAll) {
      g.fillStyle = colorOf(p.color).hex; g.globalAlpha = p.alive ? 1 : .4;
      g.beginPath(); g.arc(ox + p.x * s, oy + p.y * s, 5, 0, 6.283); g.fill(); g.globalAlpha = 1;
    }
    return { ox, oy, s };
  },
};
