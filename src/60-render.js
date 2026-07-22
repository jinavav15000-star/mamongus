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

  /* ---------------- 정적 맵 프리렌더 ---------------- */
  buildMap() {
    const c = document.createElement('canvas');
    c.width = WORLD_W; c.height = WORLD_H;
    const g = c.getContext('2d');

    g.fillStyle = '#04060d'; g.fillRect(0, 0, WORLD_W, WORLD_H);

    // 바닥
    const tint = ['#151d33','#17203a','#141b2f','#182238','#151e36'];
    for (let ty = 0; ty < GH; ty++) for (let tx = 0; tx < GW; tx++) {
      if (!walkableTile(tx, ty)) continue;
      const ri = roomOf[gi(tx, ty)];
      g.fillStyle = ri < 0 ? '#10182b' : tint[ri % tint.length];
      g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      if ((tx + ty) % 2 === 0) { g.fillStyle = 'rgba(255,255,255,.014)'; g.fillRect(tx * TILE, ty * TILE, TILE, TILE); }
    }
    // 바닥 그리드
    g.strokeStyle = 'rgba(120,160,220,.055)'; g.lineWidth = 1;
    g.beginPath();
    for (let tx = 0; tx <= GW; tx++) { g.moveTo(tx * TILE, 0); g.lineTo(tx * TILE, WORLD_H); }
    for (let ty = 0; ty <= GH; ty++) { g.moveTo(0, ty * TILE); g.lineTo(WORLD_W, ty * TILE); }
    g.stroke();

    // 방 소품
    this.drawProps(g);

    // 벽
    g.lineCap = 'round';
    g.strokeStyle = '#0a0e1a'; g.lineWidth = 11;
    g.beginPath(); for (const w of WALLS) { g.moveTo(w.x1, w.y1); g.lineTo(w.x2, w.y2); } g.stroke();
    g.strokeStyle = '#3d5a8c'; g.lineWidth = 4;
    g.beginPath(); for (const w of WALLS) { g.moveTo(w.x1, w.y1); g.lineTo(w.x2, w.y2); } g.stroke();
    g.strokeStyle = 'rgba(140,200,255,.30)'; g.lineWidth = 1.5;
    g.beginPath(); for (const w of WALLS) { g.moveTo(w.x1, w.y1 - 1.5); g.lineTo(w.x2, w.y2 - 1.5); } g.stroke();

    // 방 이름
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const r of ROOMS) {
      g.font = `700 ${Math.min(30, r.w * 2.1)}px "Pretendard", system-ui, sans-serif`;
      g.fillStyle = 'rgba(150,190,240,.16)';
      g.fillText(r.name, (r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE);
    }
    this.mapCv = c;
  },

  drawProps(g) {
    const rect = (x, y, w, h, fill, stroke) => {
      g.fillStyle = fill; g.fillRect(x * TILE, y * TILE, w * TILE, h * TILE);
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.strokeRect(x * TILE, y * TILE, w * TILE, h * TILE); }
    };
    const circ = (x, y, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(x * TILE, y * TILE, r * TILE, 0, 6.283); g.fill(); };
    // 카페테리아 중앙 테이블
    circ(59, 12, 3.2, '#2a3550'); circ(59, 12, 2.7, '#33405f');
    // 리액터 코어
    circ(11, 31, 3.0, '#3a2020'); circ(11, 31, 2.2, '#7a2b2b'); circ(11, 31, 1.3, '#d84c4c');
    // 엔진
    rect(8, 9, 4, 6, '#2b3550', '#46587f'); rect(16, 9, 4, 6, '#2b3550', '#46587f');
    rect(8, 47, 4, 6, '#2b3550', '#46587f'); rect(16, 47, 4, 6, '#2b3550', '#46587f');
    // 의무실 침대
    rect(29, 14, 3, 4, '#2f3a58', '#4a5c85'); rect(33, 14, 3, 4, '#2f3a58', '#4a5c85');
    // 창고 화물
    for (const [x, y] of [[38,45],[41,45],[44,45],[38,49],[41,49],[47,44]]) rect(x, y, 2, 2, '#3a3020', '#6a5730');
    // 무기고 포탑
    circ(84, 9, 2.0, '#2b3550'); circ(84, 9, 1.2, '#5a7aa8');
    // 실드
    circ(80, 47, 2.6, '#20303a'); circ(80, 47, 1.8, '#2a5560');
    // 관리실 테이블
    rect(58, 28, 5, 3, '#2f3a58', '#4a5c85');
    // 전기실 패널
    rect(24, 43, 2, 6, '#3a3320', '#7a6a30'); rect(31, 43, 2, 6, '#3a3320', '#7a6a30');
    // 보안실 모니터월
    rect(27, 32, 6, 2, '#1c2a3a', '#3a5a7a');
    // 조종실 콘솔
    rect(90, 30, 6, 2, '#1c2a3a', '#3a5a7a');
    // 통신실
    rect(60, 48, 4, 3, '#26304a', '#44567f');
    // 산소실 나무
    circ(77, 25, 1.4, '#1e4030'); circ(80, 24, 1.2, '#255038');
  },

  /* ---------------- 메인 프레임 ---------------- */
  draw(state) {
    const g = this.g, me = state.me;
    g.save();
    g.fillStyle = '#02040a'; g.fillRect(0, 0, this.W, this.H);

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
    const ghostView = state.ghost || state.spectate;
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
      g.save(); g.translate(v.wx, v.wy);
      g.fillStyle = '#0d1424'; g.beginPath(); g.ellipse(0, 3, 20, 13, 0, 0, 6.283); g.fill();
      g.strokeStyle = usable ? '#ffd23d' : '#4a5f85'; g.lineWidth = usable ? 3 : 2;
      g.beginPath(); g.ellipse(0, 0, 19, 12, 0, 0, 6.283); g.stroke();
      g.strokeStyle = usable ? '#ffd23d' : '#3c5075'; g.lineWidth = 2;
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(-14, i * 4.6); g.lineTo(14, i * 4.6); g.stroke(); }
      g.restore();
    }

    // 임무 표시
    for (const t of state.myTaskSpots) {
      const bob = Math.sin(performance.now() / 320 + t.wx) * 4;
      g.save(); g.translate(t.wx, t.wy - 34 + bob);
      g.fillStyle = t.next ? '#ffd23d' : 'rgba(255,210,61,.35)';
      g.beginPath(); g.moveTo(0, 10); g.lineTo(-9, -6); g.lineTo(9, -6); g.closePath(); g.fill();
      g.restore();
      g.strokeStyle = t.next ? 'rgba(255,210,61,.55)' : 'rgba(255,210,61,.2)'; g.lineWidth = 2;
      g.beginPath(); g.arc(t.wx, t.wy, 26 + Math.sin(performance.now() / 400) * 3, 0, 6.283); g.stroke();
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

    // 긴급 버튼
    {
      const b = EMERGENCY_BTN;
      if (ghostView || this.inView(b.wx, b.wy, me, R, poly)) {
        g.save(); g.translate(b.wx, b.wy);
        g.fillStyle = '#1a2136'; g.beginPath(); g.arc(0, 0, 24, 0, 6.283); g.fill();
        g.fillStyle = '#d23c3c'; g.beginPath(); g.arc(0, -2, 17, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(-5, -8, 6, 0, 6.283); g.fill();
        g.restore();
      }
    }

    // 잠긴 문
    for (const roomId in state.doors) {
      const r = ROOMS.find(x => x.id === roomId); if (!r) continue;
      g.strokeStyle = 'rgba(255,60,60,.75)'; g.lineWidth = 7; g.setLineDash([14, 9]);
      g.strokeRect(r.x * TILE + 3, r.y * TILE + 3, r.w * TILE - 6, r.h * TILE - 6);
      g.setLineDash([]);
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
      if (p.ventId) return false;
      return this.inView(p.x, p.y, me, R, poly);
    });
    for (const p of drawList) this.drawDuck(g, p, state, false);
    // 나 자신
    this.drawDuck(g, state.me, state, true);

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
      fg.fillStyle = 'rgba(2,4,10,0.94)';
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

    // 길안내 (안개 위에 그려야 보인다)
    if (state.guides?.length) this.drawGuides(g, state, cx, cy, sc, shx, shy);
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
    const FACE = '#3d3844', FACE_D = '#262230', LEG = '#332e3a';

    // 다리 (걸을 때 앞뒤로 교차)
    if (!dead) {
      const fa = moving ? Math.sin(t / 105) * 4.5 : 0;
      g.strokeStyle = LEG; g.lineWidth = 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-7, 10); g.lineTo(-7 + fa, 18); g.stroke();
      g.beginPath(); g.moveTo(6, 10); g.lineTo(6 - fa, 18); g.stroke();
    }
    // 꼬리 양털 뭉치
    g.fillStyle = col.hex; g.strokeStyle = col.dark; g.lineWidth = 2.2;
    g.beginPath(); g.arc(-15, 0, 4.6, 0, 6.283); g.fill(); g.stroke();

    // 몸통 양털 — 타원 + 테두리 뭉게 혹으로 구름 실루엣
    g.fillStyle = col.hex; g.strokeStyle = col.dark; g.lineWidth = 2.6;
    g.beginPath(); g.ellipse(-1, 2, 14.5, 12.5, 0, 0, 6.283); g.fill(); g.stroke();
    g.lineWidth = 2.2;
    for (const [bx, by, br] of [[-11,-7,5],[-2,-10,5.6],[7,-7,5],[-13,6,4.6],[9,7,4.6],[-4,12,5]]) {
      g.beginPath(); g.arc(bx, by, br, 0, 6.283); g.fill(); g.stroke();
    }
    // 혹 사이 경계선 지우기 (안쪽을 다시 칠함)
    g.fillStyle = col.hex;
    g.beginPath(); g.ellipse(-1, 1, 13, 11, 0, 0, 6.283); g.fill();
    // 양털 음영
    g.fillStyle = 'rgba(255,255,255,.16)';
    g.beginPath(); g.ellipse(-4, -3, 8, 6, -0.3, 0, 6.283); g.fill();

    // 뒤 귀 (얼굴에 가려 끝만 보임)
    g.fillStyle = FACE_D;
    g.beginPath(); g.ellipse(2, -12, 5, 2.6, -0.5, 0, 6.283); g.fill();

    // 얼굴 (진행 방향 쪽으로 내민 진회색 머리)
    g.fillStyle = FACE; g.strokeStyle = FACE_D; g.lineWidth = 2.2;
    g.beginPath(); g.ellipse(9, -9, 8.6, 9.6, 0.18, 0, 6.283); g.fill(); g.stroke();
    // 앞 귀 (아래로 처진 잎사귀 모양)
    g.fillStyle = FACE; g.strokeStyle = FACE_D; g.lineWidth = 1.8;
    g.beginPath(); g.ellipse(1.5, -6.5, 3.1, 5.4, 0.5, 0, 6.283); g.fill(); g.stroke();
    // 머리 위 양털 모자
    g.fillStyle = col.hex; g.strokeStyle = col.dark; g.lineWidth = 2;
    g.beginPath(); g.arc(6, -16.5, 4.4, 0, 6.283); g.fill(); g.stroke();
    g.beginPath(); g.arc(11.5, -17.5, 3.8, 0, 6.283); g.fill(); g.stroke();
    // 콧등 하이라이트
    g.fillStyle = 'rgba(255,255,255,.10)';
    g.beginPath(); g.ellipse(12, -5.5, 4, 4.6, 0.2, 0, 6.283); g.fill();

    // 눈 (어두운 얼굴 위 흰 눈 — 멀리서도 또렷)
    if (dead) {
      g.strokeStyle = '#e8e2ee'; g.lineWidth = 1.8; g.lineCap = 'round';
      g.beginPath(); g.moveTo(5.5, -12.5); g.lineTo(10, -8); g.moveTo(10, -12.5); g.lineTo(5.5, -8); g.stroke();
    } else {
      const lookX = moving ? 1.1 : Math.sin(t / 900) * 0.8;
      g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(8, -10.5, 3.9, 4.4, 0, 0, 6.283); g.fill();
      g.fillStyle = '#151220';
      g.beginPath(); g.arc(8.9 + lookX, -10, 2, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.beginPath(); g.arc(9.6 + lookX, -11, 0.8, 0, 6.283); g.fill();
      // 코
      g.fillStyle = FACE_D;
      g.beginPath(); g.ellipse(15.5, -4.5, 1.8, 1.3, 0.3, 0, 6.283); g.fill();
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
    g.beginPath(); g.ellipse(0, 19, 16, 6, 0, 0, 6.283); g.fill();

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
    if (isMe) {
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.setLineDash([4, 5]);
      g.beginPath(); g.arc(0, -2, 27, 0, 6.283); g.stroke(); g.setLineDash([]);
    }
    if (state.duckMates?.includes(p.id) && !isMe) {
      g.fillStyle = '#ff5f6d'; g.font = '700 15px system-ui'; g.textAlign = 'center';
      g.fillText('🐺', 0, -44);
    }
    const shownName = p.morphName || p.name;      // 변신술사는 이름까지 위장된다
    if (shownName) {
      g.font = '700 13px "Pretendard", system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'bottom';
      const w = g.measureText(shownName).width;
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect(-w / 2 - 5, -46, w + 10, 17);
      g.fillStyle = dead ? '#9aa4b8' : '#fff';
      g.fillText(shownName, 0, -33);
    }
    g.restore();
  },

  /** 쓰러진 양 — 옆으로 누워 다리가 뻗어 있다 */
  drawBody(g, b) {
    const col = colorOf(b.color);
    const FACE = '#3d3844', FACE_D = '#262230', LEG = '#332e3a';
    g.save(); g.translate(b.x, b.y);
    // 핏자국
    g.fillStyle = 'rgba(140,20,30,.55)';
    g.beginPath(); g.ellipse(0, 10, 26, 12, 0, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(180,30,40,.45)';
    g.beginPath(); g.ellipse(8, 14, 12, 6, 0, 0, 6.283); g.fill();
    g.rotate(-0.45);
    // 뻗은 다리 (뻣뻣하게 위로)
    g.strokeStyle = LEG; g.lineWidth = 3.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(2, -6); g.lineTo(8, -15); g.stroke();
    g.beginPath(); g.moveTo(8, -4); g.lineTo(15, -11); g.stroke();
    // 양털 몸통 (옆으로 누움)
    g.fillStyle = col.hex; g.strokeStyle = col.dark; g.lineWidth = 2.4;
    g.beginPath(); g.ellipse(0, 0, 16, 11, 0, 0, 6.283); g.fill(); g.stroke();
    g.lineWidth = 2;
    for (const [bx, by, br] of [[-10,-6,4.6],[0,-8,5],[9,-5,4.4],[12,4,4.2],[-12,5,4.2]]) {
      g.beginPath(); g.arc(bx, by, br, 0, 6.283); g.fill(); g.stroke();
    }
    g.fillStyle = col.hex;
    g.beginPath(); g.ellipse(0, 0, 14.5, 9.5, 0, 0, 6.283); g.fill();
    // 얼굴 (진회색, 축 늘어짐)
    g.fillStyle = FACE; g.strokeStyle = FACE_D; g.lineWidth = 2;
    g.beginPath(); g.ellipse(-15, -1, 7.4, 8, -0.25, 0, 6.283); g.fill(); g.stroke();
    // 처진 귀
    g.beginPath(); g.ellipse(-9, 4, 2.6, 4.6, 0.7, 0, 6.283); g.fill(); g.stroke();
    // X 눈 (어두운 얼굴 위 밝게)
    g.strokeStyle = '#e8e2ee'; g.lineWidth = 1.7;
    g.beginPath(); g.moveTo(-16, -7); g.lineTo(-12, -3); g.moveTo(-12, -7); g.lineTo(-16, -3); g.stroke();
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
    g.fillStyle = '#070b16'; g.fillRect(0, 0, r.width, r.height);
    g.save(); g.translate(ox, oy); g.scale(s, s);

    // 방
    for (const rm of ROOMS) {
      g.fillStyle = 'rgba(60,95,150,.28)';
      g.fillRect(rm.x * TILE, rm.y * TILE, rm.w * TILE, rm.h * TILE);
      g.strokeStyle = 'rgba(120,180,255,.5)'; g.lineWidth = 5;
      g.strokeRect(rm.x * TILE, rm.y * TILE, rm.w * TILE, rm.h * TILE);
    }
    for (const hl of HALLS) { g.fillStyle = 'rgba(60,95,150,.22)'; g.fillRect(hl.x * TILE, hl.y * TILE, hl.w * TILE, hl.h * TILE); }
    if (opts.camRooms) for (const id of opts.camRooms) {
      const rm = ROOMS.find(x => x.id === id); if (!rm) continue;
      g.fillStyle = 'rgba(95,208,255,.16)'; g.fillRect(rm.x * TILE, rm.y * TILE, rm.w * TILE, rm.h * TILE);
      g.strokeStyle = '#5fd0ff'; g.lineWidth = 8;
      g.strokeRect(rm.x * TILE, rm.y * TILE, rm.w * TILE, rm.h * TILE);
    }
    g.restore();

    // 방 이름
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${Math.max(8, 11 * (r.width / 380))}px "Pretendard", system-ui`;
    for (const rm of ROOMS) {
      g.fillStyle = 'rgba(190,220,255,.72)';
      g.fillText(rm.name, ox + (rm.x + rm.w / 2) * TILE * s, oy + (rm.y + rm.h / 2) * TILE * s);
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
