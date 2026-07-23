/* 미니게임 18종을 하나씩 띄워 캡처한다.  npm run serve 후  node tools/shot-mg.mjs */
import { chromium } from 'playwright';
const KINDS = ['wiring','card','garbage','fuel','asteroid','download','keypad','align','sample',
               'leaves','divert','chart','calib','temp','records','sort','shields','scan'];
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:900,height:560} });
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto('http://localhost:8899/index.html?v=' + Date.now());
await p.waitForTimeout(2200);
for (const k of KINDS) {
  await p.evaluate((kind) => {
    UI.closeAllModals();
    const root = h('div', {});
    const m = UI.modal({ title: kind, body: root });
    m.bd.insertBefore(h('div', { cls:'mg-msg', style:{ marginBottom:'10px' } }, MiniGames[kind].title), root);
    MiniGames[kind].build(root, { up:false, step:0 }, () => {});
  }, k);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `test-shots/mg-${k}.png` });
}
await b.close();
console.log('saved', KINDS.length);
