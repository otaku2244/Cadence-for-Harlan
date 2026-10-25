'use strict';
// 不同 poiseDefendThreshold 下，27 格的档位实际分布（跑 24 小时）。
// 目的：验证「只改阈值能不能让档 2 / 档 3 真正出现」。
const path = require('path');
const fs = require('fs');
const { loadEnvFile } = require('../lib/env.js');
loadEnvFile(path.join(__dirname, '..', '.env'));
const { createCadence } = require('../vendor/cadence.js');
const { createToneGrid } = require('../vendor/tone-grid.js');

const num = (k, d) => { const v = process.env[k]; return v === undefined || v === '' ? d : parseFloat(v); };
const toneCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'tone-harlan.json'), 'utf8'));

function normalizeTiers(profiles) {
  const out = {};
  for (const cluster of Object.keys(profiles || {})) {
    const tiers = { ...profiles[cluster] };
    const fallback = tiers['3'] || [];
    for (const k of ['4', '5']) if (!Array.isArray(tiers[k]) || !tiers[k].length) tiers[k] = fallback;
    out[cluster] = tiers;
  }
  return out;
}
// 与 vendor/tone-grid.js:175 完全一致
function classifyPoise(p) { if (p > 0.8) return 5; if (p > 0.5) return 4; if (p > 0.3) return 3; if (p > 0.1) return 2; return 1; }

const TICK = num('TICK_MINUTES', 5);
const COOLDOWN_MIN = num('ACTION_COOLDOWN_MINUTES', 180);
const MAX_PER_DAY = num('PROACTIVE_MAX_PER_DAY', 8);

async function run(threshold) {
  const rates = {
    valenceSetpoint: num('VALENCE_SETPOINT', -0.05),
    connectionAccel: num('CONNECTION_ACCEL', 1.5),
    accelDelay: num('ACCEL_DELAY', 30),
    poiseDefendThreshold: threshold,
    poiseDefendRate: num('POISE_DEFEND_RATE', 0.004),
    arousalConnectionRiseThreshold: num('AROUSAL_CONNECTION_RISE_THRESHOLD', 0.5),
    arousalConnectionRiseRate: num('AROUSAL_CONNECTION_RISE_RATE', 0.007),
    activityConnectionRelief: num('ACTIVITY_CONNECTION_RELIEF', 0),
    valenceConnectionDriftThreshold: num('VALENCE_CONNECTION_DRIFT_THRESHOLD', 1.0),
    valenceConnectionDriftRate: num('VALENCE_CONNECTION_DRIFT_RATE', 0),
  };
  const cad = createCadence({
    getLastMessage: () => null,
    connectionRateFn: () => num('CONNECTION_RATE', 0.0025),
    onSave: async () => {}, onLoad: async () => ({ connection: 0, poise: 0, valence: 0, arousal: 0, immersion: 0 }),
    getPromptContext: () => '', getStyleGuidance: () => '',
    rates, thresholds: { valenceActivity: -1 }, verbose: false,
    onLog: () => {}, // 静音，否则 288 tick × 4 会把表格冲掉
  });

  const tiers = { 1: 0, 2: 0, 3: 0 };
  let peakPoise = 0, fires = 0, lastFireAt = -Infinity, sendCount = 0;
  const HOURS = 24, TICKS = Math.round((HOURS * 60) / TICK);

  for (let i = 1; i <= TICKS; i++) {
    const t = i * TICK;
    const triggers = await cad.tick(TICK);
    const st = await cad.getState();
    const act = triggers.filter((x) => x.action !== 'observation').map((x) => x.action);
    tiers[classifyPoise(st.poise)] = (tiers[classifyPoise(st.poise)] || 0) + TICK;
    peakPoise = Math.max(peakPoise, st.poise);
    if (act.includes('contact') && (t - lastFireAt) >= COOLDOWN_MIN && sendCount < MAX_PER_DAY) {
      fires++; sendCount++; lastFireAt = t;
      await cad.applyDelta({ connection: -0.35 });
    }
  }
  return { threshold, peakPoise, tiers, fires };
}

(async () => {
  const rows = [];
  for (const th of [1.0, 0.35, 0.2, 0.1]) rows.push(await run(th));
  const total = 24 * 60;
  console.log('阈值   poise峰值  档1占比  档2占比  档3占比   触发次数(24h)');
  console.log('─'.repeat(64));
  for (const r of rows) {
    const p = (k) => (r.tiers[k] / total * 100).toFixed(1).padStart(6) + '%';
    console.log(
      String(r.threshold).padEnd(6),
      r.peakPoise.toFixed(3).padStart(9),
      p(1), p(2), p(3),
      String(r.fires).padStart(12)
    );
  }
})().catch((e) => { console.error(e); process.exit(1); });
