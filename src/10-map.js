/* ============================================================================
 *  덕몽어스 · MAP MODULE
 *  - 방/복도를 사각형으로 정의 → 타일 그리드로 래스터화
 *  - 타일 충돌 판정, 벽 선분 추출(머지), 2D 가시성 폴리곤(레이캐스트)
 * ==========================================================================*/
const TILE = 32;
const GW = 102, GH = 60;                 // grid width / height (tiles)
const WORLD_W = GW * TILE, WORLD_H = GH * TILE;

/* ---- 방 정의 (타일 좌표) --------------------------------------------------*/
const ROOMS = [
  { id:'upeng',  name:'상부엔진', x: 6, y: 6, w:16, h:12 },
  { id:'react',  name:'리액터',   x: 4, y:24, w:14, h:14 },
  { id:'loweng', name:'하부엔진', x: 6, y:44, w:16, h:12 },
  { id:'secur',  name:'보안실',   x:26, y:27, w:11, h: 9 },
  { id:'medbay', name:'의무실',   x:28, y: 8, w:14, h:11 },
  { id:'cafe',   name:'카페테리아',x:48, y: 4, w:22, h:16 },
  { id:'weapon', name:'무기고',   x:76, y: 4, w:16, h:11 },
  { id:'oxygen', name:'산소실',   x:74, y:20, w:11, h: 9 },
  { id:'navig',  name:'조종실',   x:88, y:26, w:11, h:10 },
  { id:'shield', name:'실드실',   x:74, y:42, w:13, h:11 },
  { id:'comms',  name:'통신실',   x:56, y:44, w:13, h:10 },
  { id:'store',  name:'창고',     x:36, y:40, w:16, h:15 },
  { id:'elect',  name:'전기실',   x:22, y:41, w:12, h:11 },
  { id:'admin',  name:'관리실',   x:54, y:25, w:13, h:10 },
];

/* ---- 복도 (겹쳐서 방을 연결) ---------------------------------------------*/
const HALLS = [
  { x:21, y:10, w: 8, h: 4 },   // 상부엔진 ─ 의무실
  { x:41, y:11, w: 8, h: 4 },   // 의무실 ─ 카페테리아
  { x:69, y: 7, w: 8, h: 4 },   // 카페테리아 ─ 무기고
  { x:78, y:14, w: 4, h: 7 },   // 무기고 ─ 산소실
  { x:83, y:22, w: 6, h: 4 },   // 산소실 ─ 조종실
  { x:90, y:35, w: 4, h:10 },   // 조종실 ─ (남쪽)
  { x:85, y:44, w: 7, h: 4 },   // (남쪽) ─ 실드실
  { x:68, y:46, w: 7, h: 4 },   // 실드실 ─ 통신실
  { x:51, y:46, w: 6, h: 4 },   // 통신실 ─ 창고
  { x:33, y:45, w: 4, h: 4 },   // 창고 ─ 전기실
  { x:50, y:19, w: 4, h: 5 },   // 카페테리아 ↓
  { x:42, y:21, w:12, h: 4 },   // ↳ 서쪽 통로
  { x:42, y:24, w: 4, h:17 },   // 긴 세로 복도 ─ 창고
  { x:45, y:30, w:10, h: 4 },   // 세로복도 ─ 관리실
  { x:58, y:34, w: 4, h:11 },   // 관리실 ─ 통신실
  { x:17, y:30, w:10, h: 4 },   // 리액터 ─ 보안실
  { x:30, y:18, w: 4, h:10 },   // 의무실 ─ 보안실
  { x:10, y:17, w: 4, h: 8 },   // 상부엔진 ─ 리액터
  { x:10, y:37, w: 4, h: 8 },   // 리액터 ─ 하부엔진
  { x:21, y:46, w: 4, h: 4 },   // 하부엔진 ─ 전기실
  { x:29, y:35, w: 4, h: 7 },   // 보안실 ─ 전기실
];

/* ---- 그리드 래스터화 ------------------------------------------------------*/
const grid = new Uint8Array(GW * GH);      // 1 = 통행 가능
const roomOf = new Int8Array(GW * GH).fill(-1);
const gi = (x, y) => y * GW + x;

function paint(r, roomIdx) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      grid[gi(x, y)] = 1;
      if (roomIdx >= 0) roomOf[gi(x, y)] = roomIdx;
    }
  }
}
ROOMS.forEach((r, i) => paint(r, i));
HALLS.forEach(h => paint(h, -1));

const walkableTile = (tx, ty) =>
  tx >= 0 && ty >= 0 && tx < GW && ty < GH && grid[gi(tx, ty)] === 1;

const walkablePx = (px, py) => walkableTile((px / TILE) | 0, (py / TILE) | 0);

/** 월드 좌표 → 방 이름 (복도면 '복도') */
function roomNameAt(px, py) {
  const tx = (px / TILE) | 0, ty = (py / TILE) | 0;
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return '복도';
  const r = roomOf[gi(tx, ty)];
  return r < 0 ? '복도' : ROOMS[r].name;
}
function roomIdAt(px, py) {
  const tx = (px / TILE) | 0, ty = (py / TILE) | 0;
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return null;
  const r = roomOf[gi(tx, ty)];
  return r < 0 ? null : ROOMS[r].id;
}

/* ---- 원형 충돌 이동 (축 분리 + 4점 샘플) ---------------------------------*/
const R_PAD = 10;                                   // 캐릭터 충돌 반경
function fits(px, py) {
  return walkablePx(px - R_PAD, py - R_PAD) && walkablePx(px + R_PAD, py - R_PAD)
      && walkablePx(px - R_PAD, py + R_PAD) && walkablePx(px + R_PAD, py + R_PAD);
}
/** 벽을 따라 미끄러지는 이동. {x,y} 반환 */
function moveWithCollision(x, y, dx, dy) {
  let nx = x, ny = y;
  if (dx) { if (fits(nx + dx, ny)) nx += dx; else { const s = Math.sign(dx); for (let k = Math.abs(dx) | 0; k > 0; k--) if (fits(nx + s * k, ny)) { nx += s * k; break; } } }
  if (dy) { if (fits(nx, ny + dy)) ny += dy; else { const s = Math.sign(dy); for (let k = Math.abs(dy) | 0; k > 0; k--) if (fits(nx, ny + s * k)) { ny += s * k; break; } } }
  return { x: nx, y: ny };
}

/* ---- 벽 선분 추출 (인접 동일방향 병합) -----------------------------------*/
const WALLS = [];   // {x1,y1,x2,y2}  월드 픽셀
(function buildWalls() {
  // 가로 경계: y 라인마다 위/아래 통행성이 다른 구간
  for (let y = 0; y <= GH; y++) {
    let run = -1;
    for (let x = 0; x <= GW; x++) {
      const a = walkableTile(x, y - 1), b = walkableTile(x, y);
      const edge = x < GW && (a !== b);
      if (edge && run < 0) run = x;
      if (!edge && run >= 0) { WALLS.push({ x1: run * TILE, y1: y * TILE, x2: x * TILE, y2: y * TILE }); run = -1; }
    }
  }
  // 세로 경계
  for (let x = 0; x <= GW; x++) {
    let run = -1;
    for (let y = 0; y <= GH; y++) {
      const a = walkableTile(x - 1, y), b = walkableTile(x, y);
      const edge = y < GH && (a !== b);
      if (edge && run < 0) run = y;
      if (!edge && run >= 0) { WALLS.push({ x1: x * TILE, y1: run * TILE, x2: x * TILE, y2: y * TILE }); run = -1; }
    }
  }
  for (const w of WALLS) { w.minx = Math.min(w.x1, w.x2); w.maxx = Math.max(w.x1, w.x2); w.miny = Math.min(w.y1, w.y2); w.maxy = Math.max(w.y1, w.y2); }
})();

/* ---- 가시성 폴리곤 --------------------------------------------------------*/
function raySeg(ox, oy, dx, dy, s) {
  const sdx = s.x2 - s.x1, sdy = s.y2 - s.y1;
  const den = dx * sdy - dy * sdx;
  if (Math.abs(den) < 1e-9) return Infinity;
  const t2 = ((s.x1 - ox) * dy - (s.y1 - oy) * dx) / den;
  if (t2 < 0 || t2 > 1) return Infinity;
  const t1 = Math.abs(sdx) > Math.abs(sdy)
    ? (s.x1 + sdx * t2 - ox) / dx
    : (s.y1 + sdy * t2 - oy) / dy;
  return t1 > 0.001 ? t1 : Infinity;
}

/** 시점(ox,oy)에서 반경 R 안의 가시 폴리곤. [[x,y],...] */
function visibilityPolygon(ox, oy, R) {
  const near = [];
  for (const w of WALLS) {
    if (w.maxx < ox - R || w.minx > ox + R || w.maxy < oy - R || w.miny > oy + R) continue;
    near.push(w);
  }
  const angles = [];
  for (const w of near) {
    for (const [px, py] of [[w.x1, w.y1], [w.x2, w.y2]]) {
      const a = Math.atan2(py - oy, px - ox);
      angles.push(a - 0.00035, a, a + 0.00035);
    }
  }
  // 시야 원 보간 (선분이 적을 때 원형 유지)
  const STEPS = 44;
  for (let i = 0; i < STEPS; i++) angles.push((i / STEPS) * Math.PI * 2 - Math.PI);
  angles.sort((a, b) => a - b);

  const pts = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = R;
    for (const w of near) { const t = raySeg(ox, oy, dx, dy, w); if (t < best) best = t; }
    pts.push([ox + dx * best, oy + dy * best]);
  }
  return pts;
}

/** 두 점 사이 벽 차단 여부 */
function lineBlocked(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy); if (len < 1) return false;
  const ux = dx / len, uy = dy / len;
  const minx = Math.min(ax, bx), maxx = Math.max(ax, bx), miny = Math.min(ay, by), maxy = Math.max(ay, by);
  for (const w of WALLS) {
    if (w.maxx < minx || w.minx > maxx || w.maxy < miny || w.miny > maxy) continue;
    const t = raySeg(ax, ay, ux, uy, w);
    if (t < len - 0.5) return true;
  }
  return false;
}

/* ---- 벤트 네트워크 --------------------------------------------------------*/
const VENTS = [
  { id:'v1',  room:'upeng',  x:10, y:15, net:'A' },
  { id:'v2',  room:'react',  x: 7, y:27, net:'A' },
  { id:'v3',  room:'loweng', x:10, y:47, net:'A' },
  { id:'v4',  room:'cafe',   x:67, y:17, net:'B' },
  { id:'v5',  room:'weapon', x:89, y: 7, net:'B' },
  { id:'v6',  room:'navig',  x:96, y:33, net:'B' },
  { id:'v7',  room:'medbay', x:39, y:16, net:'C' },
  { id:'v8',  room:'secur',  x:34, y:29, net:'C' },
  { id:'v9',  room:'elect',  x:24, y:49, net:'C' },
  { id:'v10', room:'store',  x:49, y:52, net:'D' },
  { id:'v11', room:'comms',  x:66, y:51, net:'D' },
  { id:'v12', room:'shield', x:84, y:50, net:'D' },
  { id:'v13', room:'admin',  x:64, y:27, net:'E' },
  { id:'v14', room:'oxygen', x:82, y:26, net:'E' },
].map(v => ({ ...v, wx: v.x * TILE + TILE / 2, wy: v.y * TILE + TILE / 2 }));

const ventNeighbors = (id) => {
  const v = VENTS.find(a => a.id === id);
  return v ? VENTS.filter(a => a.net === v.net && a.id !== id) : [];
};

/* ---- 임무 지점 ------------------------------------------------------------*/
/* kind: 미니게임 ID / long: 장기임무(여러 단계) / vis: 시각임무 */
const TASK_SPOTS = [
  { id:'t_wire_e',  room:'elect',  x:26, y:43, kind:'wiring',   name:'배선 연결',      part:true },
  { id:'t_wire_c',  room:'cafe',   x:51, y: 6, kind:'wiring',   name:'배선 연결',      part:true },
  { id:'t_wire_n',  room:'navig',  x:90, y:28, kind:'wiring',   name:'배선 연결',      part:true },
  { id:'t_wire_s',  room:'secur',  x:28, y:29, kind:'wiring',   name:'배선 연결',      part:true },
  { id:'t_wire_a',  room:'admin',  x:56, y:27, kind:'wiring',   name:'배선 연결',      part:true },

  { id:'t_card',    room:'admin',  x:64, y:32, kind:'card',     name:'카드 인식' },
  { id:'t_swipe2',  room:'cafe',   x:67, y: 6, kind:'keypad',   name:'매니폴드 해제' },
  { id:'t_gar_c',   room:'cafe',   x:49, y:18, kind:'garbage',  name:'쓰레기 배출',    chainNext:'t_gar_s' },
  { id:'t_gar_s',   room:'store',  x:50, y:53, kind:'garbage',  name:'쓰레기 배출',    chainHidden:true },
  { id:'t_fuel1',   room:'store',  x:38, y:42, kind:'fuel',     name:'연료 충전',      chainNext:'t_fuel2' },
  { id:'t_fuel2',   room:'upeng',  x: 8, y: 8, kind:'fuel',     name:'연료 충전',      chainHidden:true, chainNext:'t_fuel3' },
  { id:'t_fuel3',   room:'loweng', x: 8, y:54, kind:'fuel',     name:'연료 충전',      chainHidden:true },
  { id:'t_align1',  room:'upeng',  x:20, y:16, kind:'align',    name:'엔진 정렬' },
  { id:'t_align2',  room:'loweng', x:20, y:46, kind:'align',    name:'엔진 정렬' },
  { id:'t_ast',     room:'weapon', x:80, y: 6, kind:'asteroid', name:'소행성 격추',    vis:true },
  { id:'t_shield',  room:'shield', x:78, y:44, kind:'shields',  name:'실드 정비',      vis:true },
  { id:'t_scan',    room:'medbay', x:31, y:11, kind:'scan',     name:'신체 스캔',      vis:true },
  { id:'t_sample',  room:'medbay', x:38, y:10, kind:'sample',   name:'샘플 분석' },
  { id:'t_dl',      room:'comms',  x:58, y:46, kind:'download', name:'데이터 다운로드', chainNext:'t_up' },
  { id:'t_up',      room:'admin',  x:60, y:33, kind:'download', name:'데이터 업로드',  chainHidden:true, up:true },
  { id:'t_leaf',    room:'oxygen', x:76, y:22, kind:'leaves',   name:'O2 필터 청소' },
  { id:'t_div1',    room:'elect',  x:32, y:50, kind:'divert',   name:'전력 분배' },
  { id:'t_div2',    room:'react',  x: 6, y:35, kind:'divert',   name:'전력 분배' },
  { id:'t_chart',   room:'navig',  x:96, y:28, kind:'chart',    name:'항로 설정' },
  { id:'t_cal',     room:'react',  x:15, y:26, kind:'calib',    name:'분배기 보정' },
  { id:'t_temp1',   room:'loweng', x:18, y:53, kind:'temp',     name:'온도 조정' },
  { id:'t_temp2',   room:'oxygen', x:83, y:27, kind:'temp',     name:'온도 조정' },
  { id:'t_secur',   room:'secur',  x:35, y:34, kind:'records',  name:'보안 기록 정리' },
  { id:'t_shoot',   room:'weapon', x:90, y:13, kind:'keypad',   name:'무기고 잠금해제' },
  { id:'t_store',   room:'store',  x:44, y:53, kind:'sort',     name:'화물 분류' },
].map(t => ({ ...t, wx: t.x * TILE + TILE / 2, wy: t.y * TILE + TILE / 2 }));

/* ---- 사보타주 지점 --------------------------------------------------------*/
const SAB_SPOTS = {
  lights:  [{ room:'elect',  x:28, y:45 }],
  comms:   [{ room:'comms',  x:63, y:47 }],
  reactor: [{ room:'react',  x: 6, y:30 }, { room:'react',  x:16, y:30 }],
  oxygen:  [{ room:'oxygen', x:79, y:21 }, { room:'admin',  x:57, y:31 }],
};
for (const k in SAB_SPOTS) SAB_SPOTS[k].forEach(s => { s.wx = s.x * TILE + TILE / 2; s.wy = s.y * TILE + TILE / 2; s.key = k; });

/* ---- 특수 지점 ------------------------------------------------------------*/
const EMERGENCY_BTN = { wx: 59 * TILE, wy: 12 * TILE };
const ADMIN_TABLE   = { wx: 60 * TILE, wy: 29 * TILE };
const VITALS_PANEL  = { wx: 33 * TILE + 16, wy: 51 * TILE };   // 전기실
const CAMERA_PANEL  = { wx: 30 * TILE, wy: 33 * TILE };        // 보안실

/* ---- 스폰 위치 (카페테리아 원형) -----------------------------------------*/
function spawnPoints(n) {
  const cx = 59 * TILE, cy = 12 * TILE, rad = 130;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad };
  });
}

/* ---- 감시 카메라가 비추는 방 ---------------------------------------------*/
const CAM_ROOMS = ['upeng', 'loweng', 'store', 'medbay'];

/* ---- 문(사보타주 잠금) 대상 방 -------------------------------------------*/
const DOOR_ROOMS = ['cafe','elect','medbay','store','upeng','loweng','secur','comms','oxygen','navig','shield','weapon','admin','react'];
