/* 효과음 실측 — 브라우저의 OfflineAudioContext 로 소리를 실제 렌더해 파형을 잰다.
 * "고쳤습니다"가 아니라 숫자로 확인하기 위한 도구.  npm run serve 후  node tools/shot-sfx.mjs
 *
 * 재는 것
 *  · 최대/실효 음량 — 안 들리거나(무음) 찢어지지(클리핑) 않는지
 *  · 길이           — 의도한 만큼 울리는지
 *  · 잡음성          순음(삐—)이면 0에 가깝고, 실제 물체 소리면 1에 가깝다
 *                    ← 이번 작업의 핵심 지표. 발소리·부스럭이 여기서 높아야 성공이다
 *  · 밝기           — 초당 영교차 수. 짚(바스락)은 높고 흙(퍽)은 낮아야 한다
 * 렌더한 소리는 test-shots/sfx/*.wav 로 저장해 직접 들어볼 수 있게 한다.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

/* 기대치를 소리의 성격에 맞게 건다.
 *  noisy   — 순음이 아니어야 한다 (자기상관 낮음). 바스락·자박거리는 소리에만 의미가 있다
 *  bright  — 초당 영교차 범위. 재질 구분이 실제로 되는지는 이 값으로 봐야 한다
 *  ⚠️ 둔탁한 소리(흙 발소리)나 공명하는 소리(문 삐걱)는 자기상관이 높은 게 정상이다.
 *     여기에 noisy 를 걸었더니 멀쩡한 소리가 실패로 떴다 — 지표를 소리에 맞춰야 한다 */
const SOUNDS = [
  ['step-straw',  `stepIn('cafe')`,   { noisy: true, bright:[120, 900], label:'발소리 짚' }],
  ['step-dirt',   `stepIn('upeng')`,  {              bright:[0, 60],    label:'발소리 흙' }],
  ['step-plank',  `stepIn('store')`,  {              bright:[15, 160],  label:'발소리 널빤지' }],
  ['step-tile',   `stepIn('medbay')`, {              bright:[35, 400],  label:'발소리 타일' }],
  ['step-gravel', `Sfx.step(10,10)`,  { noisy: true, bright:[80, 900],  label:'발소리 자갈' }],
  ['bleat',       `Sfx.bleat()`,      { tonal: true,  label:'양 울음' }],
  ['gameStart',   `Sfx.gameStart()`,  {               label:'게임 시작' }],
  ['rustle',      `Sfx.rustle()`,     { noisy: true,  label:'건초 부스럭' }],
  ['creak',       `Sfx.creak()`,      {               label:'사물함 문' }],
  ['vent',        `Sfx.vent()`,       {               label:'벤트' }],
  ['bell',        `Sfx.bell()`,       { tonal: true,  label:'헛간 종' }],
  ['kill',        `Sfx.kill()`,       {               label:'살해' }],
  ['bodyFound',   `Sfx.bodyFound()`,  { tonal: true,  label:'시체 발견' }],
  ['eject',       `Sfx.eject()`,      {               label:'추방' }],
  ['sabotage',    `Sfx.sabotage()`,   {               label:'사보타주' }],
  ['alarm',       `Sfx.alarm()`,      {               label:'경보' }],
  ['taskDone',    `Sfx.taskDone()`,   { tonal: true,  label:'임무 완료' }],
  ['fixed',       `Sfx.fixed()`,      { tonal: true,  label:'복구' }],
  ['win',         `Sfx.win()`,        {               label:'승리' }],
  ['lose',        `Sfx.lose()`,       {               label:'패배' }],
  ['click',       `Sfx.click()`,      {               label:'버튼' }],
  ['vote',        `Sfx.vote()`,       {               label:'투표' }],
  ['chat',        `Sfx.chat()`,       {               label:'채팅' }],
  ['alert',       `Sfx.alert()`,      {               label:'알림' }],
  // 방귀는 '끊김'이 생명이다. 매끈한 소리는 2~6Hz 로 나오므로 8Hz 만 넘어도 구분되지만,
  // 실측이 26~38Hz 로 흔들리니 상한은 넉넉히 둔다 (경계에 붙여 두면 언젠가 헛경보가 뜬다)
  ['fart',        `Sfx.fart()`,       { flutter:[8, 48], label:'방귀' }],
];

const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto('http://localhost:8899/sfx.html?v=' + Date.now());
await p.waitForTimeout(600);

const rows = await p.evaluate(async (list) => {
  const SR = 44100, LEN = 3;
  const out = [];
  for (const [name, code] of list) {
    const oc = new OfflineAudioContext(1, SR * LEN, SR);
    // 게임 코드가 쓰는 컨텍스트를 오프라인으로 갈아 끼운다
    Sfx.ctx = oc;
    Sfx.master = oc.createGain();
    Sfx.master.gain.value = 0.32;
    Sfx.master.connect(oc.destination);
    Sfx._bufs = {};
    try { eval(code); } catch (e) { out.push({ name, err: e.message }); continue; }
    const buf = await oc.startRendering();
    const d = buf.getChannelData(0);

    let peak = 0, sum = 0, zc = 0, lastAudible = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
      if (i && (d[i] >= 0) !== (d[i - 1] >= 0)) zc++;
    }
    const rms = Math.sqrt(sum / d.length);
    const thr = peak * 0.02;
    for (let i = d.length - 1; i >= 0; i--) if (Math.abs(d[i]) > thr) { lastAudible = i; break; }

    // 잡음성 — 자기상관이 낮을수록 '순음이 아니다' = 실제 물체 소리
    // 가장 큰 구간 4096 샘플에서 lag 40~1200 의 정규화 자기상관 최댓값을 본다
    let peakAt = 0;
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) === peak) { peakAt = i; break; }
    const s = Math.min(Math.max(0, peakAt - 512), Math.max(0, d.length - 4096));
    const w = d.slice(s, s + 4096);
    let e0 = 0; for (let i = 0; i < w.length; i++) e0 += w[i] * w[i];
    let best = 0, bestLag = 0;
    if (e0 > 1e-9) {
      for (let lag = 40; lag < 1200; lag++) {
        let c = 0;
        for (let i = 0; i + lag < w.length; i++) c += w[i] * w[i + lag];
        const n = c / e0;
        if (n > best) { best = n; bestLag = lag; }
      }
    }
    // 음높이 — 자기상관이 가장 잘 맞는 주기. 음정이 뚜렷한 소리에서만 의미가 있다
    const pitchHz = best > 0.35 && bestLag ? Math.round(SR / bestLag) : 0;
    // 끊김(진폭 변조) 속도 — 소리 크기가 초당 몇 번 열렸다 닫히는가.
    // 방귀의 '뿌르륵'이 실제로 있는지 재는 값. 매끈한 소리는 0에 가깝다.
    let amHz = 0;
    {
      const W = 128, env = [];
      for (let i = 0; i + W < lastAudible; i += W) {
        let s2 = 0; for (let k = 0; k < W; k++) s2 += d[i + k] * d[i + k];
        env.push(Math.sqrt(s2 / W));
      }
      if (env.length > 4) {
        const mean = env.reduce((a, x) => a + x, 0) / env.length;
        let cross = 0;
        for (let i = 1; i < env.length; i++) if (env[i - 1] <= mean && env[i] > mean) cross++;
        amHz = Math.round(cross / (lastAudible / SR));
      }
    }
    out.push({ name, peak, rms, durMs: Math.round(lastAudible / SR * 1000), amHz, pitchHz,
               zcr: Math.round(zc / LEN), tonality: +best.toFixed(3),
               wav: (() => {                       // 16bit PCM WAV 로 인코딩해 돌려준다
                 const n = Math.min(d.length, Math.round((lastAudible + SR * 0.05)));
                 const ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
                 const W = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
                 W(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); W(8, 'WAVEfmt ');
                 v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
                 v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true);
                 v.setUint16(32, 2, true); v.setUint16(34, 16, true);
                 W(36, 'data'); v.setUint32(40, n * 2, true);
                 for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
                 let bin = ''; const u8 = new Uint8Array(ab);
                 for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
                 return btoa(bin);
               })() });
  }
  return out;
}, SOUNDS.map(([n, c]) => [n, c]));

mkdirSync('test-shots/sfx', { recursive: true });
const meta = Object.fromEntries(SOUNDS.map(([n, , o]) => [n, o]));
let fail = 0;
const bad = [];
console.log('\n이름            한글        최대   실효    길이   밝기(zcr)  잡음성  끊김   음높이');
console.log('─'.repeat(90));
for (const r of rows) {
  if (r.err) { console.log(`${r.name}  ❌ ${r.err}`); fail++; continue; }
  writeFileSync(`test-shots/sfx/${r.name}.wav`, Buffer.from(r.wav, 'base64'));
  const m = meta[r.name] || {};
  const flags = [];
  if (r.peak < 0.02) { flags.push('무음'); bad.push(`${r.name}: 너무 작다 (peak ${r.peak.toFixed(3)})`); }
  if (r.peak > 0.999) { flags.push('클리핑'); bad.push(`${r.name}: 클리핑 (peak ${r.peak.toFixed(3)})`); }
  if (r.durMs < 20) { flags.push('너무짧음'); bad.push(`${r.name}: ${r.durMs}ms`); }
  if (m.noisy && r.tonality > 0.6) { flags.push('아직전자음'); bad.push(`${r.name}: 잡음성 부족 (${r.tonality})`); }
  if (m.tonal && r.tonality < 0.3) { flags.push('음정없음'); bad.push(`${r.name}: 음정이 흐리다 (${r.tonality})`); }
  if (m.flutter && (r.amHz < m.flutter[0] || r.amHz > m.flutter[1])) {
    flags.push('끊김이상'); bad.push(`${r.name}: 끊김 ${r.amHz}Hz — 기대 ${m.flutter[0]}~${m.flutter[1]}Hz`);
  }
  if (m.bright && (r.zcr < m.bright[0] || r.zcr > m.bright[1])) {
    flags.push('음색이상'); bad.push(`${r.name}: 밝기 ${r.zcr} — 기대 ${m.bright[0]}~${m.bright[1]}`);
  }
  console.log(
    r.name.padEnd(14) + (m.label || '').padEnd(11) +
    r.peak.toFixed(3).padStart(6) + r.rms.toFixed(4).padStart(8) +
    (r.durMs + 'ms').padStart(8) + String(r.zcr).padStart(9) +
    r.tonality.toFixed(3).padStart(9) + (r.amHz + 'Hz').padStart(7) +
    (r.pitchHz ? r.pitchHz + 'Hz' : '-').padStart(8) + '  ' + flags.join(' '));
}
console.log('─'.repeat(82));

/* 재질 구분이 '실제로' 되는지 — 절대값보다 이 비교가 본질이다.
 * 짚을 밟는 소리와 흙을 밟는 소리가 비슷해지면 바닥별 발소리는 있으나 마나다. */
const get = n => rows.find(r => r.name === n) || {};
const straw = get('step-straw').zcr, dirt = get('step-dirt').zcr, gravel = get('step-gravel').zcr;
if (straw && dirt) {
  const ratio = (straw / Math.max(1, dirt)).toFixed(1);
  const okRatio = straw > dirt * 3;
  console.log(`  바닥 구분: 짚 ${straw} vs 흙 ${dirt} = ${ratio}배 ${okRatio ? '✅' : '❌'} · 자갈 ${gravel}`);
  if (!okRatio) bad.push(`짚과 흙의 발소리가 비슷하다 (${ratio}배) — 재질 구분이 안 된다`);
}
console.log(`  ${rows.length}종 렌더 · test-shots/sfx/*.wav 로 저장 (직접 들어볼 수 있음)`);
if (bad.length) { console.log('\n⚠️  확인 필요:'); bad.forEach(x => console.log('   ' + x)); }
else console.log('  ✅ 무음·클리핑 없음 · 잡음성/음정 기대치 충족');
await b.close();
process.exit(fail || bad.length ? 1 : 0);
