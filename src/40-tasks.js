/* ============================================================================
 *  마몽어스 · 임무 미니게임 (전부 터치/마우스 동시 대응)
 *  build(root, opt, done)  ·  done() 호출 시 임무 1단계 완료
 * ==========================================================================*/
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    if (k === 'style') Object.assign(e.style, props[k]);
    else if (k === 'cls') e.className = props[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), props[k]);
    else if (k === 'html') e.innerHTML = props[k];
    else e.setAttribute(k, props[k]);
  }
  kids.flat().forEach(c => c != null && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
}
/** 포인터 드래그 헬퍼 (컨테이너 기준 좌표 제공) */
function onDrag(el, { start, move, end }) {
  const pt = e => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, r }; };
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch {}
    if (start && start(pt(e), e) === false) return;
    const mv = ev => { ev.preventDefault(); move && move(pt(ev), ev); };
    const up = ev => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      end && end(pt(ev), ev);
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = (a, b) => a + Math.random() * (b - a);
const pickN = (arr, n) => { const c = [...arr]; const o = []; while (o.length < n && c.length) o.push(...c.splice((Math.random() * c.length) | 0, 1)); return o; };

const MiniGames = {

/* ─── 1. 전선 잇기 ────────────────────────────────────────────────────────*/
wiring: {
  title: '전선을 색깔에 맞춰 연결하세요',
  build(root, opt, done) {
    const cols = ['#e64b4b', '#ffd23d', '#3a6fe0', '#e8ecf5'];
    const left = pickN([0,1,2,3], 4), right = pickN([0,1,2,3], 4);
    const wrap = h('div', { cls:'mg-wire' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'mg-wire-svg');
    const colL = h('div', { cls:'mg-wire-col' }), colR = h('div', { cls:'mg-wire-col' });
    const lEls = left.map(c => h('div', { cls:'mg-node', 'data-c': c, style:{ background: cols[c] } }));
    const rEls = right.map(c => h('div', { cls:'mg-node r', 'data-c': c, style:{ background: cols[c] } }));
    lEls.forEach(e => colL.appendChild(e)); rEls.forEach(e => colR.appendChild(e));
    wrap.append(svg, colL, colR); root.appendChild(wrap);

    const linked = new Set();
    let cur = null, curLine = null;
    const center = el => { const a = el.getBoundingClientRect(), b = wrap.getBoundingClientRect();
      return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 }; };
    const mkLine = (p, color) => {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', p.x); l.setAttribute('y1', p.y); l.setAttribute('x2', p.x); l.setAttribute('y2', p.y);
      l.setAttribute('stroke', color); l.setAttribute('stroke-width', 9); l.setAttribute('stroke-linecap', 'round');
      svg.appendChild(l); return l;
    };
    onDrag(wrap, {
      start(p, e) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || !el.classList.contains('mg-node') || el.classList.contains('r') || el.classList.contains('done')) return false;
        cur = el; const c = center(el);
        curLine = mkLine(c, cols[+el.dataset.c]);
      },
      move(p) { if (curLine) { curLine.setAttribute('x2', p.x); curLine.setAttribute('y2', p.y); } },
      end(p, e) {
        if (!cur) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && el.classList.contains('mg-node') && el.classList.contains('r') && !el.classList.contains('done')
            && el.dataset.c === cur.dataset.c) {
          const c = center(el);
          curLine.setAttribute('x2', c.x); curLine.setAttribute('y2', c.y);
          cur.classList.add('done'); el.classList.add('done');
          linked.add(cur.dataset.c); Sfx.taskStep();
          if (linked.size === 4) setTimeout(done, 380);
        } else { curLine.remove(); }
        cur = null; curLine = null;
      },
    });
  },
},

/* ─── 2. 출근 카드 찍기 ────────────────────────────────────────────────────────*/
card: {
  title: '카드를 천천히 일정한 속도로 긁으세요',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-card-box' });
    const slot = h('div', { cls:'mg-card-slot' });
    const card = h('div', { cls:'mg-card' }, h('div', { cls:'mg-card-chip' }), h('span', {}, 'MAMONG ID'));
    const msg = h('div', { cls:'mg-msg' }, '카드를 오른쪽으로 밀어주세요');
    slot.appendChild(card); box.append(slot, msg); root.appendChild(box);
    let dragging = false, x0 = 0, t0 = 0, maxX = 0, samples = [];
    onDrag(slot, {
      start(p) { const r = card.getBoundingClientRect(), sr = slot.getBoundingClientRect();
        if (p.x > r.right - sr.left + 30) return false;
        dragging = true; x0 = p.x; t0 = performance.now(); samples = []; maxX = slot.clientWidth - card.offsetWidth - 8; },
      move(p) { if (!dragging) return;
        const dx = clamp(p.x - x0, 0, maxX);
        card.style.transform = `translateX(${dx}px)`;
        samples.push({ t: performance.now(), x: dx });
      },
      end(p) {
        if (!dragging) return; dragging = false;
        const dx = clamp(p.x - x0, 0, maxX);
        if (dx < maxX * 0.9) { msg.textContent = '너무 짧습니다. 끝까지 밀어주세요'; msg.className = 'mg-msg bad'; reset(); return; }
        const dur = (samples.at(-1).t - samples[0].t) / 1000;
        const speed = maxX / dur;
        // 속도 변동성 검사
        let jitter = 0;
        for (let i = 2; i < samples.length; i++) {
          const v1 = (samples[i].x - samples[i-1].x) / Math.max(1, samples[i].t - samples[i-1].t);
          const v2 = (samples[i-1].x - samples[i-2].x) / Math.max(1, samples[i-1].t - samples[i-2].t);
          jitter += Math.abs(v1 - v2);
        }
        jitter /= Math.max(1, samples.length);
        if (speed > 900)      { msg.textContent = '너무 빠릅니다'; msg.className = 'mg-msg bad'; reset(); }
        else if (speed < 110) { msg.textContent = '너무 느립니다'; msg.className = 'mg-msg bad'; reset(); }
        else if (jitter > 1.4){ msg.textContent = '일정한 속도로 밀어주세요'; msg.className = 'mg-msg bad'; reset(); }
        else { msg.textContent = '✔ 인식 완료'; msg.className = 'mg-msg good'; Sfx.taskStep(); setTimeout(done, 500); }
      },
    });
    function reset() { Sfx.tone(220, 0.15, 'square', 0, 160, .4); setTimeout(() => { card.style.transition = 'transform .25s'; card.style.transform = 'translateX(0)'; setTimeout(() => card.style.transition = '', 260); }, 250); }
  },
},

/* ─── 3. 거름 치우기 ──────────────────────────────────────────────────────*/
garbage: {
  title: '레버를 아래로 끝까지 내리고 유지하세요',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-garb' });
    const tube = h('div', { cls:'mg-garb-tube' });
    const trash = h('div', { cls:'mg-garb-trash' });
    for (let i = 0; i < 12; i++) trash.appendChild(h('div', { cls:'mg-garb-bit', style:{ left: rnd(4, 78) + '%', top: rnd(2, 70) + '%', transform:`rotate(${rnd(0,360)}deg)` } }));
    const flap = h('div', { cls:'mg-garb-flap' });
    tube.append(trash, flap);
    const rail = h('div', { cls:'mg-lever-rail' });
    const lever = h('div', { cls:'mg-lever' }, h('span', {}, '⬇'));
    rail.appendChild(lever);
    box.append(tube, rail); root.appendChild(box);

    let y = 0, held = false, prog = 0, maxY = 0, raf;
    onDrag(rail, {
      start(p) { maxY = rail.clientHeight - lever.offsetHeight - 6; held = true; },
      move(p) { y = clamp(p.y - lever.offsetHeight / 2, 0, maxY); lever.style.transform = `translateY(${y}px)`; },
      end() { held = false; },
    });
    (function loop() {
      const open = held && y >= maxY - 6;
      flap.style.transform = open ? 'rotateX(78deg)' : 'rotateX(0deg)';
      if (open) { prog += 1 / 60; trash.style.transform = `translateY(${Math.min(120, prog * 62)}%)`; }
      else if (!held) { y = Math.max(0, y - 6); lever.style.transform = `translateY(${y}px)`; }
      if (prog >= 2.1) { Sfx.taskStep(); return done(); }
      raf = requestAnimationFrame(loop);
    })();
    root._cleanup = () => cancelAnimationFrame(raf);
  },
},

/* ─── 4. 경유 채우기 ────────────────────────────────────────────────────────*/
fuel: {
  title: '손잡이를 누른 채 경유를 가득 채우세요',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-fuel' });
    const gauge = h('div', { cls:'mg-gauge' }); const fill = h('div', { cls:'mg-gauge-fill' });
    gauge.appendChild(fill);
    for (let i = 1; i < 5; i++) gauge.appendChild(h('div', { cls:'mg-gauge-tick', style:{ bottom: i * 20 + '%' } }));
    const btn = h('button', { cls:'mg-bigbtn' }, '⛽ 누르고 있기');
    box.append(gauge, btn); root.appendChild(box);
    let p = 0, held = false, raf;
    const dn = e => { e.preventDefault(); held = true; btn.classList.add('held'); };
    const up = () => { held = false; btn.classList.remove('held'); };
    btn.addEventListener('pointerdown', dn); btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up); btn.addEventListener('pointercancel', up);
    (function loop() {
      if (held) p = Math.min(1, p + 0.0075); else p = Math.max(0, p - 0.004);
      fill.style.height = (p * 100) + '%';
      if (p >= 1) { Sfx.taskStep(); return done(); }
      raf = requestAnimationFrame(loop);
    })();
    root._cleanup = () => cancelAnimationFrame(raf);
  },
},

/* ─── 5. 까마귀 쫓기 (시각 임무) ─────────────────────────────────────────*/
asteroid: {
  title: '까마귀 12마리를 쫓아내세요',
  build(root, opt, done) {
    const cv = h('canvas', { cls:'mg-canvas' });
    const hud = h('div', { cls:'mg-msg' }, '남은 까마귀 12');
    root.append(cv, hud);
    const g = cv.getContext('2d');
    let W = 0, H = 0, rocks = [], hits = 0, raf, shots = [];
    const resize = () => { const r = cv.getBoundingClientRect(); W = cv.width = r.width * devicePixelRatio; H = cv.height = r.height * devicePixelRatio; g.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); };
    setTimeout(resize, 0); window.addEventListener('resize', resize);
    const spawn = () => rocks.push({ x: rnd(20, cv.getBoundingClientRect().width - 20), y: -20, vx: rnd(-.4,.4), vy: rnd(.9, 2.0), r: rnd(12, 22), a: rnd(0, 6.28), va: rnd(-.04, .04) });
    for (let i = 0; i < 5; i++) { spawn(); rocks.at(-1).y = rnd(-200, 60); }
    cv.addEventListener('pointerdown', e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      shots.push({ x: r.width / 2, y: r.height - 14, tx: x, ty: y, t: 0 });
      Sfx.tone(1400, 0.05, 'square', 0, 600, .3);
      for (let i = rocks.length - 1; i >= 0; i--) {
        const k = rocks[i];
        if (Math.hypot(k.x - x, k.y - y) < k.r + 16) {
          rocks.splice(i, 1); hits++; Sfx.noise(0.12, 1800, .5, 300);
          hud.textContent = '남은 까마귀 ' + Math.max(0, 12 - hits);
          if (hits >= 12) { Sfx.taskStep(); setTimeout(done, 260); }
          break;
        }
      }
    });
    (function loop() {
      const r = cv.getBoundingClientRect(); const w = r.width, hgt = r.height;
      const now = performance.now();
      // 해질녘 하늘 → 밀밭
      const sky = g.createLinearGradient(0, 0, 0, hgt);
      sky.addColorStop(0, '#2c3f63'); sky.addColorStop(.55, '#7a6a52'); sky.addColorStop(.75, '#b98f45');
      g.fillStyle = sky; g.fillRect(0, 0, w, hgt);
      g.fillStyle = '#8f6d2c'; g.fillRect(0, hgt * .74, w, hgt * .26);
      g.strokeStyle = 'rgba(226,190,120,.5)'; g.lineWidth = 2;      // 밀 이삭
      for (let i = 0; i < 46; i++) {
        const sx = (i * 37) % w, sy = hgt * .74 + ((i * 53) % (hgt * .26));
        g.beginPath(); g.moveTo(sx, sy + 9); g.lineTo(sx + Math.sin(now / 700 + i) * 3, sy - 3); g.stroke();
      }
      if (rocks.length < 6 && Math.random() < 0.03) spawn();
      for (const k of rocks) {
        k.x += k.vx; k.y += k.vy; k.a += k.va;
        if (k.y > hgt + 40) { k.y = -20; k.x = rnd(20, w - 20); }
        // 까마귀 — 날갯짓하는 검은 새
        const flap = Math.sin(now / 110 + k.a * 9) * 0.6;
        const s = k.r / 16;
        g.save(); g.translate(k.x, k.y); g.scale(s, s);
        g.fillStyle = '#15131c';
        g.beginPath(); g.ellipse(0, 0, 12, 6.5, 0, 0, 6.283); g.fill();      // 몸통
        g.beginPath(); g.arc(11, -3, 5, 0, 6.283); g.fill();                 // 머리
        g.fillStyle = '#e0a13a';
        g.beginPath(); g.moveTo(15, -3); g.lineTo(23, -1); g.lineTo(15, 1); g.closePath(); g.fill();  // 부리
        g.fillStyle = '#15131c';                                             // 날개
        for (const dir of [-1, 1]) {
          g.beginPath(); g.moveTo(0, -1);
          g.quadraticCurveTo(-6, dir * (14 + flap * 10), -20, dir * (7 + flap * 12));
          g.quadraticCurveTo(-8, dir * 3, 0, 3); g.closePath(); g.fill();
        }
        g.fillStyle = '#15131c';                                             // 꼬리
        g.beginPath(); g.moveTo(-10, -3); g.lineTo(-22, 0); g.lineTo(-10, 3); g.closePath(); g.fill();
        g.fillStyle = '#ffd45e'; g.beginPath(); g.arc(12, -4, 1.5, 0, 6.283); g.fill();  // 눈
        g.restore();
      }
      // 허수아비 + 던진 돌
      g.save(); g.translate(w / 2, hgt - 8);
      g.strokeStyle = '#6d4726'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -34); g.moveTo(-14, -24); g.lineTo(14, -24); g.stroke();
      g.fillStyle = '#6f8f4a'; g.beginPath(); g.roundRect(-9, -26, 18, 20, 4); g.fill();
      g.fillStyle = '#d9b25e'; g.beginPath(); g.arc(0, -34, 8, 0, 6.283); g.fill();
      g.fillStyle = '#3c2a12'; g.beginPath(); g.arc(-2.6, -35, 1.6, 0, 6.283); g.arc(2.6, -35, 1.6, 0, 6.283); g.fill();
      g.fillStyle = '#c79a3c'; g.beginPath(); g.roundRect(-11, -42, 22, 4, 2); g.fill();
      g.restore();
      for (let i = shots.length - 1; i >= 0; i--) { const s = shots[i]; s.t += .16;
        const p = Math.min(1, s.t * 2);
        g.fillStyle = `rgba(120,105,88,${1 - s.t})`;
        g.beginPath(); g.arc(s.x + (s.tx - s.x) * p, s.y + (s.ty - s.y) * p - Math.sin(p * 3.14) * 26, 4.5, 0, 6.283); g.fill();
        if (s.t > 1) shots.splice(i, 1); }
      raf = requestAnimationFrame(loop);
    })();
    root._cleanup = () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  },
},

/* ─── 6. 주문서 받기/보내기 ──────────────────────────────────────────*/
download: {
  title: '사료 주문서를 주고받습니다',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-dl' });
    const label = h('div', { cls:'mg-dl-label' }, opt.up ? '주문서 보내는 중' : '주문서 받는 중');
    const bar = h('div', { cls:'mg-bar' }); const fill = h('div', { cls:'mg-bar-fill' }); bar.appendChild(fill);
    const pct = h('div', { cls:'mg-msg' }, '대기 중');
    const btn = h('button', { cls:'mg-bigbtn' }, opt.up ? '⬆ 보내기 시작' : '⬇ 받기 시작');
    box.append(label, bar, pct, btn); root.appendChild(box);
    let raf, running = false, p = 0;
    btn.addEventListener('click', () => {
      if (running) return; running = true; btn.disabled = true; btn.textContent = '전송 중…';
      const t0 = performance.now();
      (function loop() {
        p = Math.min(1, (performance.now() - t0) / 6200);
        fill.style.width = (p * 100) + '%'; pct.textContent = Math.floor(p * 100) + '%';
        if (p >= 1) { Sfx.taskStep(); return done(); }
        raf = requestAnimationFrame(loop);
      })();
    });
    root._cleanup = () => cancelAnimationFrame(raf);
  },
},

/* ─── 7. 키패드 (순서대로) ───────────────────────────────────────────────*/
keypad: {
  title: '1부터 10까지 순서대로 누르세요',
  build(root, opt, done) {
    const grid = h('div', { cls:'mg-keypad' });
    const order = pickN([...Array(10).keys()], 10);
    const cells = Array.from({ length: 10 }, (_, i) => h('button', { cls:'mg-key' }, String(order.indexOf(i) + 1)));
    // 무작위 위치 배치
    pickN([...Array(10).keys()], 10).forEach((slot, i) => { cells[i].style.order = slot; });
    cells.forEach(c => grid.appendChild(c));
    const msg = h('div', { cls:'mg-msg' }, '다음: 1');
    root.append(grid, msg);
    let next = 1;
    cells.forEach(c => c.addEventListener('click', () => {
      const v = +c.textContent;
      if (v === next) { c.classList.add('ok'); c.disabled = true; next++; Sfx.taskStep();
        msg.textContent = next > 10 ? '완료' : '다음: ' + next;
        if (next > 10) setTimeout(done, 300);
      } else { Sfx.tone(200, .16, 'square', 0, 140, .4); next = 1; msg.textContent = '틀렸습니다! 다음: 1';
        cells.forEach(x => { x.classList.remove('ok'); x.disabled = false; }); grid.classList.add('shake'); setTimeout(() => grid.classList.remove('shake'), 380); }
    }));
  },
},

/* ─── 8. 트랙터 정비 ───────────────────────────────────────────────────────*/
align: {
  title: '출력을 중앙선에 맞추세요',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-align' });
    const lane = h('div', { cls:'mg-align-lane' });
    const line = h('div', { cls:'mg-align-center' });
    const handle = h('div', { cls:'mg-align-handle' });
    lane.append(line, handle); box.appendChild(lane); root.appendChild(box);
    const msg = h('div', { cls:'mg-msg' }, '핸들을 잡고 붉은 선에 맞추세요'); root.appendChild(msg);
    let y = 0, H = 0, hold = 0, raf, dragging = false;
    setTimeout(() => { H = lane.clientHeight - handle.offsetHeight; y = rnd(0.05, 0.42) * H; if (Math.random()<.5) y = rnd(0.58,0.95)*H; handle.style.top = y + 'px'; }, 0);
    onDrag(lane, {
      start() { dragging = true; }, end() { dragging = false; },
      move(p) { H = lane.clientHeight - handle.offsetHeight; y = clamp(p.y - handle.offsetHeight / 2, 0, H); handle.style.top = y + 'px'; },
    });
    (function loop() {
      const centered = Math.abs(y - H / 2) < H * 0.045;
      handle.classList.toggle('ok', centered);
      if (centered) { hold += 1 / 60; msg.textContent = `유지 중… ${(1.2 - hold).toFixed(1)}s`; msg.className='mg-msg good'; }
      else { hold = Math.max(0, hold - 0.03); if (!dragging) { } msg.textContent = '핸들을 잡고 붉은 선에 맞추세요'; msg.className='mg-msg'; }
      if (hold >= 1.2) { Sfx.taskStep(); return done(); }
      raf = requestAnimationFrame(loop);
    })();
    root._cleanup = () => cancelAnimationFrame(raf);
  },
},

/* ─── 9. 우유 검사 ───────────────────────────────────────────────────────*/
sample: {
  title: '우유를 검사하고 상한 병을 골라내세요',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-sample' });
    const tubes = Array.from({ length: 5 }, (_, i) => {
      const t = h('div', { cls:'mg-tube' }); t.appendChild(h('div', { cls:'mg-tube-liq' })); t.appendChild(h('span', {}, String(i + 1))); return t;
    });
    const rack = h('div', { cls:'mg-rack' }); tubes.forEach(t => rack.appendChild(t));
    const btn = h('button', { cls:'mg-bigbtn' }, '🥛 검사 시작');
    const msg = h('div', { cls:'mg-msg' }, '분석을 시작하세요');
    box.append(rack, btn, msg); root.appendChild(box);
    const target = (Math.random() * 5) | 0;
    let phase = 0, timer;
    btn.addEventListener('click', () => {
      if (phase) return; phase = 1; btn.disabled = true; btn.textContent = '분석 중…';
      let t = 0;
      timer = setInterval(() => {
        t++; msg.textContent = `분석 중 ${Math.min(100, t * 4)}%`;
        tubes.forEach((tb, i) => tb.classList.toggle('scan', i === (t % 5)));
        if (t >= 25) { clearInterval(timer); phase = 2; tubes.forEach(tb => tb.classList.remove('scan'));
          tubes[target].classList.add('anomaly'); msg.textContent = '상한 병을 고르세요'; btn.textContent = '분석 완료'; }
      }, 130);
    });
    tubes.forEach((tb, i) => tb.addEventListener('click', () => {
      if (phase !== 2) return;
      if (i === target) { Sfx.taskStep(); tb.classList.add('picked'); setTimeout(done, 400); }
      else { Sfx.tone(200, .16, 'square', 0, 140, .4); msg.textContent = '다시 확인하세요'; }
    }));
    root._cleanup = () => clearInterval(timer);
  },
},

/* ─── 10. O2 필터 청소 ───────────────────────────────────────────────────*/
leaves: {
  title: '나뭇잎을 배출구로 끌어다 버리세요',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-leaves' });
    const bin = h('div', { cls:'mg-leaf-bin' }, '배출구');
    box.appendChild(bin);
    let left = 6;
    const msg = h('div', { cls:'mg-msg' }, '남은 잎 6');
    for (let i = 0; i < 6; i++) {
      const lf = h('div', { cls:'mg-leaf' , style:{ left: rnd(6, 55) + '%', top: rnd(8, 72) + '%', transform:`rotate(${rnd(0,360)}deg)` }}, '🍃');
      box.appendChild(lf);
      let ox = 0, oy = 0;
      onDrag(lf, {
        start(p, e) { const r = lf.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top; lf.style.zIndex = 20; },
        move(p, e) { const b = box.getBoundingClientRect(); lf.style.left = (e.clientX - b.left - ox) + 'px'; lf.style.top = (e.clientY - b.top - oy) + 'px'; },
        end(p, e) {
          const br = bin.getBoundingClientRect();
          if (e.clientX > br.left && e.clientX < br.right && e.clientY > br.top && e.clientY < br.bottom) {
            lf.remove(); left--; msg.textContent = '남은 잎 ' + left; Sfx.taskStep();
            if (left === 0) setTimeout(done, 300);
          }
        },
      });
    }
    root.append(box, msg);
  },
},

/* ─── 11. 전력 분배 ──────────────────────────────────────────────────────*/
divert: {
  title: '모든 스위치를 위로 올리세요',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-divert' });
    const n = 6; const sw = [];
    for (let i = 0; i < n; i++) {
      const s = h('div', { cls:'mg-switch' }); const k = h('div', { cls:'mg-switch-knob' }); s.appendChild(k);
      let up = Math.random() < 0.35; if (up) s.classList.add('up');
      s.addEventListener('click', () => { s.classList.toggle('up'); Sfx.click(); check(); });
      sw.push(s); box.appendChild(s);
    }
    const msg = h('div', { cls:'mg-msg' }, '');
    root.append(box, msg);
    function check() {
      const up = sw.filter(s => s.classList.contains('up')).length;
      msg.textContent = `${up} / ${n}`;
      if (up === n) { Sfx.taskStep(); setTimeout(done, 320); }
    }
    check();
  },
},

/* ─── 12. 양떼 몰기 ──────────────────────────────────────────────────────*/
chart: {
  title: '길을 따라 양을 몰고 가세요',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-chart' });
    const cv = h('canvas', { cls:'mg-canvas' }); box.appendChild(cv); root.appendChild(box);
    const g = cv.getContext('2d');
    let pts = [], ship = { x: 0, y: 0 }, idx = 0, W = 0, H = 0, raf;
    const resize = () => { const r = cv.getBoundingClientRect(); W = r.width; H = r.height;
      cv.width = W * devicePixelRatio; cv.height = H * devicePixelRatio; g.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
      if (!pts.length) { for (let i = 0; i < 5; i++) pts.push({ x: 40 + (W - 80) * (i / 4), y: 40 + rnd(0, H - 80) }); ship = { ...pts[0] }; } };
    setTimeout(resize, 0); window.addEventListener('resize', resize);
    let dragging = false;
    onDrag(cv, {
      start(p) { if (Math.hypot(p.x - ship.x, p.y - ship.y) < 42) { dragging = true; return; } return false; },
      move(p) { if (!dragging) return; ship.x = clamp(p.x, 0, W); ship.y = clamp(p.y, 0, H);
        if (idx < pts.length && Math.hypot(ship.x - pts[idx].x, ship.y - pts[idx].y) < 26) { idx++; Sfx.taskStep();
          if (idx >= pts.length) { setTimeout(done, 320); } } },
      end() { dragging = false; },
    });
    (function loop() {
      g.fillStyle = '#4e6d3b'; g.fillRect(0, 0, W, H);                 // 목초지
      g.strokeStyle = 'rgba(126,168,88,.5)'; g.lineWidth = 2; g.lineCap = 'round';
      for (let i = 0; i < 70; i++) {
        const sx = (i * 71) % W, sy = (i * 113) % H;
        g.beginPath(); g.moveTo(sx, sy + 4); g.quadraticCurveTo(sx + 2, sy, sx + 4, sy - 3); g.stroke();
      }
      g.strokeStyle = 'rgba(90,70,44,.55)'; g.lineWidth = 12; g.setLineDash([]); // 흙길
      g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke();
      g.strokeStyle = 'rgba(230,215,180,.35)'; g.lineWidth = 2; g.setLineDash([7, 7]);
      g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); g.setLineDash([]);
      pts.forEach((p, i) => { g.beginPath(); g.arc(p.x, p.y, 13, 0, 6.283);
        g.fillStyle = i < idx ? '#2ea44f' : (i === idx ? '#ffd23d' : 'rgba(255,255,255,.22)'); g.fill(); });
      // 몰고 가는 양
      g.save(); g.translate(ship.x, ship.y);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(0, 12, 13, 4.5, 0, 0, 6.283); g.fill();
      g.strokeStyle = '#332e3a'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-5, 6); g.lineTo(-5, 13); g.moveTo(5, 6); g.lineTo(5, 13); g.stroke();
      g.fillStyle = '#f3efe6'; g.strokeStyle = '#c3bcae'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(-1, 0, 12, 10, 0, 0, 6.283); g.fill(); g.stroke();
      for (const [bx, by, br] of [[-9,-6,4.4],[-1,-9,5],[7,-6,4.4],[-10,5,4],[8,6,4]]) {
        g.beginPath(); g.arc(bx, by, br, 0, 6.283); g.fill(); g.stroke();
      }
      g.fillStyle = '#f3efe6'; g.beginPath(); g.ellipse(-1, 0, 10.5, 8.5, 0, 0, 6.283); g.fill();
      g.fillStyle = '#3d3844';
      g.beginPath(); g.ellipse(8, -7, 7, 7.6, .18, 0, 6.283); g.fill();
      g.beginPath(); g.ellipse(1, -5, 2.6, 4.4, .5, 0, 6.283); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(7.5, -8.5, 3, 3.4, 0, 0, 6.283); g.fill();
      g.fillStyle = '#151220'; g.beginPath(); g.arc(8.4, -8, 1.6, 0, 6.283); g.fill();
      g.restore();
      raf = requestAnimationFrame(loop);
    })();
    root._cleanup = () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  },
},

/* ─── 13. 물레방아 보정 ────────────────────────────────────────────────────*/
calib: {
  title: '표시가 초록 구간에 올 때 멈추세요 (3회)',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-calib' });
    const dials = [0, 1, 2].map(() => {
      const d = h('div', { cls:'mg-dial' });
      d.appendChild(h('div', { cls:'mg-dial-zone' }));
      d.appendChild(h('div', { cls:'mg-dial-needle' }));
      box.appendChild(d); return d;
    });
    const btn = h('button', { cls:'mg-bigbtn' }, '⏹ 멈추기');
    const msg = h('div', { cls:'mg-msg' }, '1 / 3');
    root.append(box, btn, msg);
    let cur = 0, a = 0, speed = 3.4, raf, stopped = [false, false, false];
    btn.addEventListener('click', () => {
      if (cur >= 3) return;
      const norm = ((a % 360) + 360) % 360;
      if (norm > 330 || norm < 30) {
        dials[cur].classList.add('ok'); stopped[cur] = true; cur++; a = 0; speed = 3.4 + cur * 0.7; Sfx.taskStep();
        msg.textContent = cur >= 3 ? '완료' : `${cur + 1} / 3`; msg.className = 'mg-msg good';
        if (cur >= 3) setTimeout(done, 400);
      } else { Sfx.tone(200, .16, 'square', 0, 140, .4); msg.textContent = '빗나갔습니다. 다시!'; msg.className = 'mg-msg bad'; a = 0; }
    });
    (function loop() {
      if (cur < 3) { a += speed; dials[cur].querySelector('.mg-dial-needle').style.transform = `rotate(${a}deg)`; }
      raf = requestAnimationFrame(loop);
    })();
    root._cleanup = () => cancelAnimationFrame(raf);
  },
},

/* ─── 14. 온도 조정 ──────────────────────────────────────────────────────*/
temp: {
  title: '목표 온도에 맞추세요',
  build(root, opt, done) {
    const target = Math.round(rnd(-15, 60));
    const box = h('div', { cls:'mg-temp' });
    const bar = h('div', { cls:'mg-temp-bar' }); const fill = h('div', { cls:'mg-temp-fill' });
    const mark = h('div', { cls:'mg-temp-target' }); bar.append(fill, mark);
    const read = h('div', { cls:'mg-temp-read' }, '0.0 °C');
    const ctl = h('div', { cls:'mg-temp-ctl' });
    const down = h('button', { cls:'mg-rbtn' }, '❄ 냉각'); const up = h('button', { cls:'mg-rbtn' }, '🔥 가열');
    ctl.append(down, up);
    box.append(h('div', { cls:'mg-msg' }, `목표: ${target} °C (±1.5)`), bar, read, ctl); root.appendChild(box);
    const T0 = -25, T1 = 75;
    mark.style.bottom = ((target - T0) / (T1 - T0) * 100) + '%';
    let v = rnd(-10, 50), dir = 0, hold = 0, raf;
    const bind = (b, d) => { const on = e => { e.preventDefault(); dir = d; }; const off = () => dir = 0;
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off); };
    bind(down, -1); bind(up, 1);
    (function loop() {
      v = clamp(v + dir * 0.42, T0, T1);
      fill.style.height = ((v - T0) / (T1 - T0) * 100) + '%';
      read.textContent = v.toFixed(1) + ' °C';
      const ok = Math.abs(v - target) <= 1.5;
      read.className = 'mg-temp-read' + (ok ? ' good' : '');
      hold = ok ? hold + 1 / 60 : 0;
      if (hold >= 1.0) { Sfx.taskStep(); return done(); }
      raf = requestAnimationFrame(loop);
    })();
    root._cleanup = () => cancelAnimationFrame(raf);
  },
},

/* ─── 15. 출입 기록 정리 (짝 맞추기) ─────────────────────────────────────*/
records: {
  title: '같은 기호끼리 짝을 맞추세요',
  build(root, opt, done) {
    const syms = ['◆','●','▲','★','✚','◼'];
    const deck = pickN([...syms, ...syms], 12);
    const grid = h('div', { cls:'mg-mem' });
    let open = [], locked = false, found = 0;
    deck.forEach(s => {
      const c = h('div', { cls:'mg-mem-card' }, h('span', {}, s));
      c.addEventListener('click', () => {
        if (locked || c.classList.contains('open') || c.classList.contains('done')) return;
        c.classList.add('open'); Sfx.click(); open.push(c);
        if (open.length === 2) {
          locked = true;
          const [a, b] = open;
          if (a.textContent === b.textContent) {
            setTimeout(() => { a.classList.add('done'); b.classList.add('done'); open = []; locked = false; found++;
              Sfx.taskStep(); if (found === 6) setTimeout(done, 320); }, 320);
          } else setTimeout(() => { a.classList.remove('open'); b.classList.remove('open'); open = []; locked = false; }, 700);
        }
      });
      grid.appendChild(c);
    });
    root.appendChild(grid);
  },
},

/* ─── 16. 곡물 분류 ──────────────────────────────────────────────────────*/
sort: {
  title: '곡물 자루를 같은 색 통에 넣으세요',
  build(root, opt, done) {
    const cols = [['#e64b4b','빨강'], ['#3a6fe0','파랑'], ['#2ea44f','초록']];
    const box = h('div', { cls:'mg-sort' });
    const bins = h('div', { cls:'mg-bins' });
    const binEls = cols.map(([c, n]) => h('div', { cls:'mg-bin', style:{ borderColor:c, color:c } }, n));
    binEls.forEach(b => bins.appendChild(b));
    const area = h('div', { cls:'mg-sort-area' });
    box.append(area, bins); root.appendChild(box);
    let left = 6;
    const msg = h('div', { cls:'mg-msg' }, '남은 자루 6'); root.appendChild(msg);
    for (let i = 0; i < 6; i++) {
      const ci = i % 3;
      const bx = h('div', { cls:'mg-crate', style:{ background: cols[ci][0], left: rnd(4, 70) + '%', top: rnd(6, 62) + '%' } }, '🌾');
      area.appendChild(bx);
      let ox = 0, oy = 0;
      onDrag(bx, {
        start(p, e) { const r = bx.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top; bx.style.zIndex = 30; },
        move(p, e) { const b = area.getBoundingClientRect(); bx.style.left = (e.clientX - b.left - ox) + 'px'; bx.style.top = (e.clientY - b.top - oy) + 'px'; },
        end(p, e) {
          const t = binEls[ci].getBoundingClientRect();
          if (e.clientX > t.left && e.clientX < t.right && e.clientY > t.top && e.clientY < t.bottom) {
            bx.remove(); left--; msg.textContent = '남은 자루 ' + left; Sfx.taskStep();
            if (!left) setTimeout(done, 300);
          } else { Sfx.tone(200, .12, 'square', 0, 150, .3); }
        },
      });
    }
  },
},

/* ─── 17. 울타리 점검 (시각 임무) ─────────────────────────────────────────*/
shields: {
  title: '붉게 켜진 울타리 칸을 모두 고치세요',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-shield' });
    const cells = [];
    for (let i = 0; i < 21; i++) { const c = h('div', { cls:'mg-hex' }); cells.push(c); box.appendChild(c); }
    root.appendChild(box);
    const lit = new Set(pickN([...Array(21).keys()], 7));
    lit.forEach(i => cells[i].classList.add('lit'));
    let left = lit.size;
    const msg = h('div', { cls:'mg-msg' }, `남은 칸 ${left}`); root.appendChild(msg);
    cells.forEach((c, i) => c.addEventListener('click', () => {
      if (!c.classList.contains('lit')) return;
      c.classList.remove('lit'); c.classList.add('fixed'); left--; Sfx.taskStep();
      msg.textContent = `남은 칸 ${left}`;
      if (!left) setTimeout(done, 320);
    }));
  },
},

/* ─── 18. 건강 검진 (시각 임무 · 대기형) ────────────────────────────────*/
scan: {
  title: '검진대 위에 올라서세요',
  build(root, opt, done) {
    const box = h('div', { cls:'mg-scan' });
    const pad = h('div', { cls:'mg-scan-pad' });
    const beam = h('div', { cls:'mg-scan-beam' });
    const duck = h('div', { cls:'mg-scan-duck' }, '🐑');
    pad.append(duck, beam); box.appendChild(pad);
    const info = h('div', { cls:'mg-scan-info' });
    const btn = h('button', { cls:'mg-bigbtn' }, '🩺 검진 시작');
    box.append(info, btn); root.appendChild(box);
    let raf, t0 = 0, running = false;
    btn.addEventListener('click', () => {
      if (running) return; running = true; btn.disabled = true; btn.textContent = '검진 중…';
      t0 = performance.now();
      (function loop() {
        const p = Math.min(1, (performance.now() - t0) / 9000);
        beam.style.top = (10 + Math.abs(Math.sin(p * Math.PI * 4)) * 70) + '%';
        info.innerHTML = `<div>진행 ${Math.floor(p*100)}%</div><div>체중 ${(48 + Math.sin(p*12)*3).toFixed(1)} kg</div><div>혈압 ${(110 + Math.sin(p*9)*8).toFixed(0)}</div>`;
        if (p >= 1) { Sfx.taskStep(); return done(); }
        raf = requestAnimationFrame(loop);
      })();
    });
    root._cleanup = () => cancelAnimationFrame(raf);
  },
},

};
