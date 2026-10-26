'use strict';
// ============================================================
// driftRate 候选值实测 v2
//
// v1 的错：vendor 的 tick() / getState() 都是 **async**，v1 里没 await
//         → 状态压根没推进，所有读数恒为 0。
//
// 背景（2026-10-10）：
//   线上 VALENCE_CONNECTION_DRIFT_RATE=0.05 → valence 被钉死在 -1.00。
//   真因：drift = driftRate × mins × connection，c 长期 0.55~1.00，
//         唯一回升力是 valenceRegress=0.005/min + 判定器 delta(+0.08/次)。
//         净下沉 -0.045/min = 回归的 9 倍。
//
// ⚠️ 只读 .env + vendor，不写任何线上文件。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = '/root/cadence';
const envTxt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const get = (k, d) => {
  const m = envTxt.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : d;
};
const num = (k, d) => parseFloat(get(k, d));

const ENV = {
  connectionRate: num('CONNECTION_RATE', '0.0025'),
  valenceSetpoint: num('VALENCE_SETPOINT', '-0.05'),
  valenceActivityThreshold: num('VALENCE_ACTIVITY_THRESHOLD', '-0.25'),
  driftThreshold: num('VALENCE_CONNECTION_DRIFT_THRESHOLD', '0.20'),
  driftRate: num('VALENCE_CONNECTION_DRIFT_RATE', '0.05'),
  activityConnectionRelief: num('ACTIVITY_CONNECTION_RELIEF', '0'),
  poiseDefendThreshold: num('POISE_DEFEND_THRESHOLD', '1.0'),
  poiseDefendRate: num('POISE_DEFEND_RATE', '0.004'),
  connectionAccel: num('CONNECTION_ACCEL', '1.5'),
  accelDelay: num('ACCEL_DELAY', '30'),
};

console.log('=== 线上 .env 实际取值 ===');
console.log('  driftRate(线上) = ' + ENV.driftRate + '   driftThreshold = ' + ENV.driftThreshold);
console.log('  valenceSetpoint = ' + ENV.valenceSetpoint + '   valenceRegress(引擎默认) = 0.005');
console.log();

const { createCadence } = require(path.join(ROOT, 'vendor/cadence.js'));

const CANDIDATES = [0.05, 0.010, 0.008, 0.006];
const MIN_PER_TICK = 5;

// 场景：
//   A  整日不出现（只靠 tick 自然涨 c）
//   B  c 稳定 0.90（模拟今天 07:00~09:00 真实状态）
//   C  真实双峰（前 16h 低位 0.25，后 8h 堆积到 1.0）
const SCENARIOS = {
  A_自然累积_24h: { total: 1440, cFn: null },
  B_高位c090_12h: { total: 720, cFn: (t) => 0.90 },
  C_双峰_24h: { total: 1440, cFn: (t) => (t < 960 ? 0.25 : 0.70 + (t - 960) / 3000) },
};

async function runCase(driftRate, scenario) {
  let live = null;
  const cadence = createCadence({
    getLastMessage: () => null,
    connectionRateFn: () => ENV.connectionRate,
    onSave: async () => { /* 不用 onSave，改从 getState 读 */ },
    onLoad: async () => ({ connection: 0, poise: 0, valence: 0, arousal: 0, immersion: 0 }),
    rates: {
      valenceSetpoint: ENV.valenceSetpoint,
      connectionAccel: ENV.connectionAccel,
      accelDelay: ENV.accelDelay,
      poiseDefendThreshold: ENV.poiseDefendThreshold,
      poiseDefendRate: ENV.poiseDefendRate,
      activityConnectionRelief: ENV.activityConnectionRelief,
      valenceConnectionDriftThreshold: ENV.driftThreshold,
      valenceConnectionDriftRate: driftRate,
    },
    thresholds: { valenceActivity: ENV.valenceActivityThreshold },
    verbose: false,
  });

  let minVal = 0, maxVal = 0, firstLow = null, trigCount = 0;
  const samples = [];

  for (let t = 0; t < scenario.total; t += MIN_PER_TICK) {
    await cadence.tick(MIN_PER_TICK);
    const s = await cadence.getState();
    live = s;

    // 场景强制 c（覆盖 tick 的自然累积）
    if (scenario.cFn) {
      s.connection = scenario.cFn(t);
    }

    const v = Number(s.valence) || 0;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
    if (firstLow === null && v <= ENV.valenceActivityThreshold) firstLow = t;
    if (t % 60 === 0) samples.push(t + 'm:' + v.toFixed(2));
  }

  return { driftRate, minVal, maxVal, firstLow, samples, trigCount };
}

(async () => {
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    console.log('════ 场景 ' + name + ' ════');
    console.log('driftRate |  最低v  |  最高v  | 首达-0.25 |  结局');
    console.log('----------|---------|---------|-----------|--------');
    for (const dr of CANDIDATES) {
      const r = await runCase(dr, sc);
      const verdict = r.minVal <= -0.99 ? '🔒 锁死 -1.00'
        : (r.firstLow === null ? '○ 未达触发线' : '✔ 流动');
      console.log(
        String(dr).padEnd(9) + ' | ' +
        r.minVal.toFixed(3).padStart(7) + ' | ' +
        r.maxVal.toFixed(3).padStart(7) + ' | ' +
        String(r.firstLow === null ? '—' : r.firstLow + 'min').padStart(9) + ' | ' + verdict
      );
    }
    console.log();
  }

  console.log('════ 逐小时轨迹（场景 B_高位c090_12h）════');
  for (const dr of [0.05, 0.010, 0.008, 0.006]) {
    const r = await runCase(dr, SCENARIOS.B_高位c090_12h);
    console.log('  driftRate=' + String(dr).padEnd(6) + ' → ' + r.samples.join('  '));
  }
  console.log();

  console.log('════ 关键对照：c=0.90 时，每 5 分钟 valence 变化量 ════');
  console.log('  回升力（回归）      = +0.005 × 5 = +0.0250 / 5min');
  for (const dr of CANDIDATES) {
    const down = dr * 5 * 0.90;
    const net = 0.025 - down;
    console.log('  driftRate=' + String(dr).padEnd(6) +
      ' 下沉 = -' + down.toFixed(4).padStart(7) +
      '  → 净 ' + (net >= 0 ? '+' : '') + net.toFixed(4) + ' / 5min' +
      (net < -0.01 ? '  ❌ 锁死' : (net < 0 ? '  ⚠️ 缓沉' : '  ✔ 回升')));
  }
})();
