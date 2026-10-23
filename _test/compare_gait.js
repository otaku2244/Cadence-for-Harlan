'use strict';
// ============================================================
// 对照实验：作者原生 gait vs 我们改过的参数
//
// 目的（2026-10-10）：
//   diff 证实 vendor/jiwen.js 与作者最新版 **MD5 完全一致**，
//   我们从未改过引擎源码。问题 100% 出在参数选择上。
//
//   作者源码里有一组成对机制（注释「改1/改2/改3」）：
//     改1 valenceDeltaScaling     防情绪在极端位无限累积   → 我们没开
//     改2 valenceConnectionDrift  connection 高→心情下沉  → 我们开了 0.05（作者示例 0.003）
//     改3 valenceDiminishWindow   同方向 delta 边际递减     → 我们没开
//   只开改2 不配改1/改3 = 只留下沉、砍掉刹车 → valence 锁死 -1.00。
//
// 本脚本跑四组，看 valence 到底能不能"流动"。
//
// ⚠️ 只读 .env + vendor，不写任何线上文件。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = '/root/jiwen-bridge';
const envTxt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const get = (k, d) => {
  const m = envTxt.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : d;
};
const num = (k, d) => parseFloat(get(k, d));

const BASE = {
  connectionRate: num('CONNECTION_RATE', '0.0025'),
  valenceSetpoint: num('VALENCE_SETPOINT', '-0.05'),
  valenceActivityThreshold: num('VALENCE_ACTIVITY_THRESHOLD', '-0.25'),
  activityConnectionRelief: num('ACTIVITY_CONNECTION_RELIEF', '0'),
  poiseDefendThreshold: num('POISE_DEFEND_THRESHOLD', '1.0'),
  poiseDefendRate: num('POISE_DEFEND_RATE', '0.004'),
  connectionAccel: num('CONNECTION_ACCEL', '1.5'),
  accelDelay: num('ACCEL_DELAY', '30'),
};

console.log('=== 线上 .env 实际取值 ===');
console.log('  CONNECTION_RATE=' + BASE.connectionRate +
  '  VALENCE_SETPOINT=' + BASE.valenceSetpoint +
  '  VALENCE_ACTIVITY_THRESHOLD=' + BASE.valenceActivityThreshold);
console.log();

const { createJiwen } = require(path.join(ROOT, 'vendor/jiwen.js'));
const MIN_PER_TICK = 5;

// 配置矩阵
const CONFIGS = [
  { name: '① 现状 线上',        driftRate: 0.05,  driftThreshold: 0.20, deltaScaling: false },
  { name: '② 作者示例值',        driftRate: 0.003, driftThreshold: 0.20, deltaScaling: false },
  { name: '③ 作者示例+改1',      driftRate: 0.003, driftThreshold: 0.20, deltaScaling: true  },
  { name: '④ driftRate=0 关闭',  driftRate: 0,     driftThreshold: 0.20, deltaScaling: false },
];

// 场景：她整日不出现，c 自然累积到饱和（最坏情况），跑 48h
const TOTAL = 2880;

async function runCase(cfg) {
  const jiwen = createJiwen({
    getLastMessage: () => null,
    connectionRateFn: () => BASE.connectionRate,
    onSave: async () => {},
    onLoad: async () => ({ connection: 0, poise: 0, valence: 0, arousal: 0, immersion: 0 }),
    rates: {
      valenceSetpoint: BASE.valenceSetpoint,
      connectionAccel: BASE.connectionAccel,
      accelDelay: BASE.accelDelay,
      poiseDefendThreshold: BASE.poiseDefendThreshold,
      poiseDefendRate: BASE.poiseDefendRate,
      activityConnectionRelief: BASE.activityConnectionRelief,
      valenceConnectionDriftThreshold: cfg.driftThreshold,
      valenceConnectionDriftRate: cfg.driftRate,
      valenceDeltaScaling: cfg.deltaScaling,
    },
    thresholds: { valenceActivity: BASE.valenceActivityThreshold },
    verbose: false,
  });

  let minVal = 0, maxVal = 0, firstLow = null, stuckAt = null;
  const hourly = [];
  const extraArgs = path.join(ROOT, '_test');

  for (let t = 0; t < TOTAL; t += MIN_PER_TICK) {
    await jiwen.tick(MIN_PER_TICK);
    const s = await jiwen.getState();
    const v = Number(s.valence) || 0;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
    if (firstLow === null && v <= BASE.valenceActivityThreshold) firstLow = t;
    if (stuckAt === null && v <= -0.999) stuckAt = t;
    if (t % 120 === 0) hourly.push({ t, v: Number(v.toFixed(2)), c: Number((s.connection || 0).toFixed(2)) });
  }
  return { minVal, maxVal, firstLow, stuckAt, hourly };
}

(async () => {
  console.log('════ 场景：她整日不出现，跑 48 小时 ════');
  console.log('配置                    |  最低v  | 首达-0.25 |  锁死时刻  | 结局');
  console.log('------------------------|---------|-----------|-----------|--------');
  const results = {};
  for (const cfg of CONFIGS) {
    const r = await runCase(cfg);
    results[cfg.name] = r;
    const verdict = r.stuckAt !== null ? '🔒 锁死' : (r.firstLow === null ? '○ 未触发' : '✔ 流动');
    console.log(
      cfg.name.padEnd(23) + ' | ' +
      r.minVal.toFixed(3).padStart(7) + ' | ' +
      String(r.firstLow === null ? '—' : r.firstLow + 'min').padStart(9) + ' | ' +
      String(r.stuckAt === null ? '—' : r.stuckAt + 'min').padStart(9) + ' | ' + verdict
    );
  }
  console.log();

  console.log('════ valence 轨迹（每 2 小时采样）════');
  for (const [name, r] of Object.entries(results)) {
    console.log('  ' + name);
    console.log('    ' + r.hourly.map(h => (h.t / 60) + 'h:' + h.v.toFixed(2)).join('  '));
  }
  console.log();

  console.log('════ c 轨迹（每 2 小时采样，各行应相同）════');
  console.log('    ' + results[CONFIGS[0].name].hourly.map(h => (h.t / 60) + 'h:' + h.c).join('  '));
})();
