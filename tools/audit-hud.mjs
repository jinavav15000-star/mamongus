/* HUD 전수 점검 — 화면 크기 4종 × 게임 상태 5종에서
 *   ① 화면 밖으로 나간 버튼   ② 버튼끼리 겹침   ③ 손가락으로 누르기엔 작은 버튼(44px 미만)
 * 를 자동으로 찾는다. 눈으로 스크린샷을 훑으면 놓치는 것들이다.
 *   npm run serve 후  node tools/audit-hud.mjs
 *
 * ⚠️ 버튼 위치를 CSS 로 옮겼거나 HUD 요소를 새로 넣었으면 반드시 돌릴 것.
 *    이 저장소는 가로모드 보정·안전영역 때문에 레이아웃이 잘 깨진다.
 */
import { chromium } from 'playwright';

const SIZES = [
  ['아이폰SE 가로',  667, 375],
  ['갤럭시 가로',    740, 360],
  ['아이폰14 가로',  844, 390],
  ['태블릿',        1024, 700],
];

/* 각 상태에서 '보여야 하는' 조작 요소들 */
const STATES = [
  { id:'lobby', name:'대기실', setup: async p => {} },
  { id:'play-goose', name:'게임(양)', setup: async p => {
      await p.evaluate(() => Game.start()); await p.waitForTimeout(1500);
      await p.evaluate(() => { document.querySelectorAll('button').forEach(x=>{ if(x.textContent.includes('시작하기')) x.click(); }); });
      await p.evaluate(() => { G.myRole = 'goose'; UI.buildActionButtons(); });
    } },
  { id:'play-wolf', name:'게임(늑대·버튼최다)', setup: async p => {
      await p.evaluate(() => Game.start()); await p.waitForTimeout(1500);
      await p.evaluate(() => { document.querySelectorAll('button').forEach(x=>{ if(x.textContent.includes('시작하기')) x.click(); }); });
      await p.evaluate(() => { G.myRole = 'morphling'; UI.buildActionButtons(); });
    } },
  { id:'ghost', name:'유령 관전', setup: async p => {
      await p.evaluate(() => Game.start()); await p.waitForTimeout(1500);
      await p.evaluate(() => { document.querySelectorAll('button').forEach(x=>{ if(x.textContent.includes('시작하기')) x.click(); }); });
      await p.evaluate(() => {
        const me = Host.P[G.myId];
        if (isDuck(me.role)) { const bot = G.order.map(i=>Host.P[i]).find(q=>q.isBot);
          const r = bot.role; bot.role = me.role; me.role = r; Host.sendPrivateAll(); }
        Host.doDeath(Host.P[G.myId], G.order[1]); Host.afterDeath();
      });
      await p.waitForTimeout(900);
      await p.evaluate(() => { UI.closeAllModals(); Game.spectNext(1); });
    } },
  { id:'meeting', name:'회의', setup: async p => {
      await p.evaluate(() => Game.start()); await p.waitForTimeout(1500);
      await p.evaluate(() => { document.querySelectorAll('button').forEach(x=>{ if(x.textContent.includes('시작하기')) x.click(); }); });
      await p.evaluate(() => Host.startMeeting(G.myId, null));
      await p.waitForTimeout(900);
    } },
  { id:'hunt', name:'늑대 사냥 모드', setup: async p => {
      await p.evaluate(() => Game.setSetting('mode','hunt'));
      await p.waitForTimeout(400);
      await p.evaluate(() => Game.start()); await p.waitForTimeout(1500);
      await p.evaluate(() => { document.querySelectorAll('button').forEach(x=>{ if(x.textContent.includes('시작하기')) x.click(); }); });
    } },
];

const b = await chromium.launch();
const problems = [];
let checked = 0;

for (const [szName, w, h] of SIZES) {
  for (const st of STATES) {
    const p = await b.newPage({ viewport:{ width:w, height:h } });
    const errs = [];
    p.on('pageerror', e => errs.push('PAGE: ' + e.message));
    p.on('console', m => m.type() === 'error' && errs.push('CON: ' + m.text()));
    await p.goto('http://localhost:8899/index.html?v=' + Date.now());
    await p.waitForTimeout(2000);
    await p.evaluate(() => Game.createRoom());
    await p.waitForTimeout(3200);
    await p.evaluate(() => { for (let i=0;i<3;i++) Host.addBot(); });
    await p.waitForTimeout(400);
    await p.evaluate(() => { Voice.enabled = true; });   // 마이크 버튼을 켜진 상태로
    await st.setup(p);
    await p.waitForTimeout(600);

    const found = await p.evaluate(() => {
      const vis = el => {
        if (!el) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      // 화면에 떠 있는 '누를 수 있는 것' 전부 (모달 안은 제외 — 모달은 자체 스크롤이 있다)
      const els = [...document.querySelectorAll('#screen-game button, #screen-meeting button, #btn-mic, #spectate-bar, .stick')]
        .filter(e => vis(e) && !e.closest('.modal') && !e.closest('#screen-lobby'))
        .map(e => ({ el: e, id: e.id || e.className.split(' ')[0],
                     r: e.getBoundingClientRect(),
                     txt: (e.textContent || '').trim().slice(0, 10) }));
      const out = { off: [], overlap: [], small: [], covered: [], count: els.length };
      for (const a of els) {
        if (a.r.right > innerWidth + 1 || a.r.left < -1 || a.r.bottom > innerHeight + 1 || a.r.top < -1)
          out.off.push({ id:a.id, txt:a.txt, box:[Math.round(a.r.left),Math.round(a.r.top),Math.round(a.r.right),Math.round(a.r.bottom)] });
        // 조이스틱은 손가락 위치로 옮겨 다니므로 크기 검사에서 뺀다
        if (a.id !== 'stick' && Math.min(a.r.width, a.r.height) < 40)
          out.small.push({ id:a.id, txt:a.txt, size:[Math.round(a.r.width),Math.round(a.r.height)] });
        // 가려짐 — 화면엔 보이는데 다른 층이 덮고 있어 손가락이 닿지 않는 버튼.
        // (겹침 검사로는 안 잡힌다. z-index 를 잘못 주면 이렇게 조용히 죽는다)
        const cx = a.r.left + a.r.width/2, cy = a.r.top + a.r.height/2;
        if (cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight) {
          const top = document.elementFromPoint(cx, cy);
          if (top && top !== a.el && !a.el.contains(top) && !top.contains(a.el))
            out.covered.push({ id:a.id, txt:a.txt, by: top.id || top.className.toString().split(' ')[0] });
        }
      }
      for (let i = 0; i < els.length; i++) for (let j = i+1; j < els.length; j++) {
        const a = els[i].r, c = els[j].r;
        if (els[i].el.contains(els[j].el) || els[j].el.contains(els[i].el)) continue;
        const ox = Math.min(a.right,c.right) - Math.max(a.left,c.left);
        const oy = Math.min(a.bottom,c.bottom) - Math.max(a.top,c.top);
        if (ox > 2 && oy > 2) out.overlap.push({ a: els[i].id + '·' + els[i].txt, b: els[j].id + '·' + els[j].txt,
                                                 area: Math.round(ox*oy) });
      }
      return out;
    });
    checked++;
    const tag = `${szName}(${w}x${h}) · ${st.name}`;
    for (const o of found.off)     problems.push(`❌ 화면 밖: [${tag}] ${o.id} "${o.txt}" ${JSON.stringify(o.box)}`);
    for (const o of found.overlap) problems.push(`❌ 겹침:   [${tag}] ${o.a} ↔ ${o.b} (${o.area}px²)`);
    for (const o of found.small)   problems.push(`⚠️ 작은버튼: [${tag}] ${o.id} "${o.txt}" ${o.size.join('x')}`);
    for (const o of found.covered) problems.push(`❌ 가려짐: [${tag}] ${o.id} "${o.txt}" ← ${o.by} 가 덮음 (안 눌림)`);
    for (const e of errs)          problems.push(`❌ 콘솔:   [${tag}] ${e}`);
    if (st.id === 'ghost' || st.id === 'hunt' || (st.id === 'play-wolf' && w === 740))
      await p.screenshot({ path:`test-shots/hud-${st.id}-${w}x${h}.png` });
    await p.close();
  }
}
await b.close();

console.log(`\nHUD 점검 — 화면 ${SIZES.length}종 × 상태 ${STATES.length}종 = ${checked}가지 조합`);
console.log('─'.repeat(70));
if (!problems.length) console.log('  ✅ 화면 밖으로 나간 버튼 없음 · 겹침 없음 · 작은 버튼 없음 · 콘솔 오류 없음');
else problems.forEach(x => console.log('  ' + x));
console.log('─'.repeat(70));
process.exit(problems.some(x => x.startsWith('  ❌') || x.includes('❌')) ? 1 : 0);
