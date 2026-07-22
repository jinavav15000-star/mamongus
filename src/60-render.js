/* ============================================================================
 *  덕몽어스 · 렌더러
 * ==========================================================================*/
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
  },

  inView(x, y, me, R, poly) {
    const d = Math.hypot(x - me.x, y - me.y);
    if (d > R) return false;
    if (d < 40) return true;
    return !lineBlocked(me.x, me.y, x, y);
  },

  /* ---------------- 오리 캐릭터 ---------------- */
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

    // 발
    if (!dead) {
      g.fillStyle = '#e08a20';
      const fa = p.moving ? Math.sin(t / 105) * 5 : 0;
      g.beginPath(); g.ellipse(-6 + fa, 17, 5.5, 3.2, 0, 0, 6.283); g.fill();
      g.beginPath(); g.ellipse(6 - fa, 17, 5.5, 3.2, 0, 0, 6.283); g.fill();
    }

    // 몸통
    g.fillStyle = col.hex;
    g.strokeStyle = col.dark; g.lineWidth = 2.6;
    g.beginPath(); g.ellipse(0, 2, 15, 17, 0, 0, 6.283); g.fill(); g.stroke();
    // 배 하이라이트
    g.fillStyle = 'rgba(255,255,255,.20)';
    g.beginPath(); g.ellipse(2, 7, 8.5, 9, 0, 0, 6.283); g.fill();
    // 날개
    g.fillStyle = col.dark;
    g.beginPath(); g.ellipse(-10, 4, 5, 9, 0.25, 0, 6.283); g.fill();

    // 머리
    g.fillStyle = col.hex; g.strokeStyle = col.dark; g.lineWidth = 2.4;
    g.beginPath(); g.arc(3, -13, 11, 0, 6.283); g.fill(); g.stroke();
    // 부리
    g.fillStyle = '#f2a02c'; g.strokeStyle = '#c47b12'; g.lineWidth = 1.6;
    g.beginPath(); g.ellipse(13, -11, 7, 4.2, 0, 0, 6.283); g.fill(); g.stroke();
    // 눈
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(6, -16, 4.4, 5, 0, 0, 6.283); g.fill();
    if (dead) {
      g.strokeStyle = '#222'; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(3.5, -18.5); g.lineTo(8.5, -13.5); g.moveTo(8.5, -18.5); g.lineTo(3.5, -13.5); g.stroke();
    } else {
      g.fillStyle = '#151824';
      const lookX = p.moving ? 1.2 : Math.sin(t / 900) * 0.9;
      g.beginPath(); g.arc(6.8 + lookX, -15.6, 2.3, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(7.6 + lookX, -16.6, 0.9, 0, 6.283); g.fill();
    }
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
      g.fillText('🦆', 0, -44);
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

  drawBody(g, b) {
    const col = colorOf(b.color);
    g.save(); g.translate(b.x, b.y);
    // 핏자국
    g.fillStyle = 'rgba(140,20,30,.55)';
    g.beginPath(); g.ellipse(0, 10, 26, 12, 0, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(180,30,40,.45)';
    g.beginPath(); g.ellipse(8, 14, 12, 6, 0, 0, 6.283); g.fill();
    // 쓰러진 오리 (반쪽 몸통)
    g.rotate(-0.45);
    g.fillStyle = col.hex; g.strokeStyle = col.dark; g.lineWidth = 2.4;
    g.beginPath(); g.ellipse(0, 0, 16, 12, 0, 0, 6.283); g.fill(); g.stroke();
    g.beginPath(); g.arc(-13, -4, 9, 0, 6.283); g.fill(); g.stroke();
    g.fillStyle = '#f2a02c'; g.beginPath(); g.ellipse(-22, -3, 6, 3.6, 0, 0, 6.283); g.fill();
    // 뼈
    g.fillStyle = '#e8e2d0';
    g.beginPath(); g.ellipse(9, 4, 4, 2.6, 0.4, 0, 6.283); g.fill();
    // X 눈
    g.strokeStyle = '#1b1b1b'; g.lineWidth = 1.7;
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
    // 관리실 모드: 방별 인원수
    if (opts.admin) {
      const counts = {};
      for (const p of opts.adminPlayers || []) { const id = roomIdAt(p.x, p.y); if (id) counts[id] = (counts[id] || 0) + 1; }
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
