/* 음성 실동작 검증 — 진짜 브라우저 2개를 P2P 로 연결해 서로 말을 시킨다.
 *   npm run serve 후  node tools/voice-test.mjs
 *
 * 확인하는 것
 *  1) 동시 통화(가장 중요) — 둘 다 마이크 버튼을 누르고 있어도 서로의 말이 들리는가
 *  2) 거리 감쇠          — 멀어지면 정말로 안 들리는가 (0 이어야 한다)
 *  3) 유령 차단          — 죽은 사람 목소리가 산 사람에게 새지 않는가
 *  4) 이중 재생 없음      — <audio> 태그가 WebAudio 와 겹쳐 울리지 않는가
 *                          (겹치면 위 2·3 번이 전부 무력화된다. 실제로 그랬었다)
 *
 * 가짜 마이크(크롬 내장 비프음)를 쓰므로 사람 목소리는 필요 없다.
 * 실제로 소리가 흘렀는지는 수신 그래프에 분석기를 달아 신호 세기로 잰다.
 */
import { chromium } from 'playwright';

const FLAGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
               '--autoplay-policy=no-user-gesture-required'];

const b = await chromium.launch({ args: FLAGS });
const ctx = await b.newContext({ permissions: ['microphone'] });
const host = await ctx.newPage();
const guest = await ctx.newPage();
const errs = [];
for (const [nm, pg] of [['host', host], ['guest', guest]]) {
  pg.on('pageerror', e => errs.push(`${nm} PAGEERROR: ${e.message}`));
  pg.on('console', m => m.type() === 'error' && errs.push(`${nm} CON: ${m.text()}`));
}

const URL = 'http://localhost:8899/index.html';
await host.goto(URL + '?v=' + Date.now());
await guest.goto(URL + '?v=' + Date.now());
await host.waitForTimeout(2200);

/* 방 만들고 참가 */
await host.evaluate(() => { localStorage.setItem('duckus_name', '방장'); Game.createRoom(); });
await host.waitForTimeout(4000);
const code = await host.evaluate(() => Net.code);
if (!code) { console.log('❌ 방 코드를 못 받았다 (PeerJS 시그널링 서버 연결 실패)'); await b.close(); process.exit(1); }
console.log('방 코드:', code);

await guest.evaluate(c => { localStorage.setItem('duckus_name', '손님'); Net.uid = 'guest-uid'; Game.joinRoom(c); }, code);
await guest.waitForTimeout(6000);

const joined = await host.evaluate(() => G.order.length);
console.log('접속 인원:', joined);
if (joined < 2) { console.log('❌ 손님이 못 들어왔다'); await b.close(); process.exit(1); }

/* 양쪽 음성 켜기 → 서로 호출이 붙을 때까지 대기 */
await host.evaluate(async () => { Sfx.init(); await Voice.enable(); Game.announceVoice(); });
await guest.evaluate(async () => { Sfx.init(); await Voice.enable(); Game.announceVoice(); });
await host.waitForTimeout(1500);
await host.evaluate(() => Game.connectVoice());
await guest.evaluate(() => Game.connectVoice());
await host.waitForTimeout(4000);

const linked = async pg => pg.evaluate(() => Voice.nodes.size);
console.log('연결된 상대 수 — 방장:', await linked(host), '· 손님:', await linked(guest));
if (!(await linked(host)) || !(await linked(guest))) {
  console.log('❌ 음성 연결이 안 붙었다 (TURN 없이 막힌 환경일 수 있다)');
  await b.close(); process.exit(1);
}

/* 수신 신호를 실제로 재기 위해 분석기를 끼운다 (게인 뒤 = 최종적으로 들리는 소리) */
const attach = pg => pg.evaluate(() => {
  const n = [...Voice.nodes.values()][0];
  if (!n.gain) return 'element';                 // 아이폰 경로 — 태그 volume 이 곧 음량
  const an = Voice.ctx.createAnalyser(); an.fftSize = 2048;
  n.gain.connect(an);                            // 분기만 (원래 출력은 그대로)
  window.__an = an; window.__buf = new Float32Array(an.fftSize);
  return 'webaudio';
});
console.log('재생 경로:', await attach(host), '/', await attach(guest));

/** 최종 출력 신호 세기(RMS) — 0 이면 안 들리는 것 */
const level = pg => pg.evaluate(async () => {
  if (!window.__an) return null;
  let peak = 0;
  // 짧게 재면 말소리가 잠깐 끊긴 순간(DTX)에 걸려 '안 들린다'로 오판한다
  for (let i = 0; i < 45; i++) {                 // 450ms 동안 최댓값
    window.__an.getFloatTimeDomainData(window.__buf);
    for (const v of window.__buf) peak = Math.max(peak, Math.abs(v));
    await new Promise(r => setTimeout(r, 10));
  }
  return +peak.toFixed(4);
});

const setPos = (pg, mine, other, opt = {}) => pg.evaluate(([mine, other, opt]) => {
  const ids = Object.keys(Voice.nodes);
  const peer = [...Voice.nodes.keys()][0];
  Voice.update(mine, { [peer]: other }, !!opt.meeting,
               new Set(opt.speakerDead ? [peer] : []), !!opt.iAmDead);
}, [mine, other, opt]);

const near = { x: 1000, y: 1000 }, close = { x: 1000, y: 1020 }, far = { x: 1000, y: 2000 };
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond, extra }); };

/* ── 1) 둘 다 마이크를 누른 채로 서로 들리는가 ── */
await host.evaluate(() => Voice.setTalking(true));
await guest.evaluate(() => Voice.setTalking(true));
await setPos(host, near, close); await setPos(guest, near, close);
await host.waitForTimeout(600);
const hBoth = await level(host), gBoth = await level(guest);
check('동시에 말할 때 방장이 손님 소리를 듣는다', hBoth > 0.002, hBoth);
check('동시에 말할 때 손님이 방장 소리를 듣는다', gBoth > 0.002, gBoth);

/* ── 2) 한쪽만 말할 때와 비교 (동시라고 작아지면 안 된다) ── */
await guest.evaluate(() => Voice.setTalking(false));
await host.waitForTimeout(500);
await setPos(guest, near, close);
const gAlone = await level(guest);
check('한쪽만 말할 때와 세기가 비슷하다 (반쪽 통화 아님)',
      gAlone > 0.002 && Math.abs(gBoth - gAlone) < Math.max(gAlone, gBoth) * 0.6,
      { 동시: gBoth, 혼자: gAlone });
await guest.evaluate(() => Voice.setTalking(true));

/* ── 3) 멀어지면 안 들린다 ── */
await setPos(guest, near, far);
await guest.waitForTimeout(500);
const gFar = await level(guest);
check('멀리 있는 사람 목소리는 들리지 않는다 (380px 밖)', gFar < 0.002, gFar);

/* ── 4) 유령 목소리는 산 사람에게 안 들린다 ── */
await setPos(guest, near, close, { speakerDead: true });
await guest.waitForTimeout(500);
const gGhost = await level(guest);
check('유령 목소리가 산 사람에게 새지 않는다', gGhost < 0.002, gGhost);

/* ── 5) 이중 재생 차단 (2·4번이 성립하는 근거) ── */
const tags = await guest.evaluate(() => [...Voice.nodes.values()].map(n =>
  ({ muted: n.audio.muted, paused: n.audio.paused })));
check('<audio> 태그가 음소거되어 이중 재생이 없다', tags.every(t => t.muted), tags);

/* ── 6) 유령끼리는 거리 무시하고 들린다 ── */
await setPos(guest, near, far, { speakerDead: true, iAmDead: true });
await guest.waitForTimeout(500);
const gGhostPair = await level(guest);
check('유령끼리는 맵 반대편이라도 들린다', gGhostPair > 0.002, gGhostPair);

console.log('\n음성 실동작 검증');
console.log('─'.repeat(60));
for (const r of results)
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}` + (r.extra !== undefined ? `  (${JSON.stringify(r.extra)})` : ''));
if (errs.length) { console.log('\n콘솔 오류:'); errs.forEach(e => console.log('   ' + e)); }
console.log('─'.repeat(60));
const bad = results.filter(r => !r.ok).length + errs.length;
console.log(bad ? `  ❌ ${bad}건 실패` : '  ✅ 전부 통과');
await b.close();
process.exit(bad ? 1 : 0);
