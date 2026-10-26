'use strict';
// 真实主动唤醒模拟：用 vendor 引擎按生产参数从「刚聊完」跑到 contact 触发，
// 再用生产函数 buildProactiveNotice 渲染，不手编 state。
//
// 用法：node _test/simulate_real_proactive.js
const path = require('path');
const fs = require('fs');

const { loadEnvFile } = require('../lib/env.js');
loadEnvFile(path.join(__dirname, '..', '.env'));

const { createCadence } = require('../vendor/cadence.js');
const { createToneGrid } = require('../vendor/tone-grid.js');
const { createDescriber } = require('../lib/describe.js');
const { buildProactiveNotice, assertBlockShape } = require('../lib/inject-text.js');

const num = (k, d) => {
  const v = process.env[k];
  return v === undefined || v === '' ? d : parseFloat(v);
};

const toneCfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'tone-harlan.json'), 'utf8')
);

// 与 engine.js 的 normalizeTiers 完全一致：config 缺的档 4/5 显式指向档 3
function normalizeTiers(profiles) {
  const out = {};
  for (const cluster of Object.keys(profiles || {})) {
    const tiers = { ...profiles[cluster] };
    const fallback = tiers['3'] || [];
    for (const k of ['4', '5']) {
      if (!Array.isArray(tiers[k]) || tiers[k].length === 0) tiers[k] = fallback;
    }
    out[cluster] = tiers;
  }
  return out;
}

const toneGrid = createToneGrid({
  profiles: normalizeTiers(toneCfg.profiles),
  urgencyBoost: toneCfg.urgencyBoost,
});
const describer = createDescriber(toneCfg.describe);
const SCENE_OVERRIDE = toneCfg.sceneOverride || {};
const PROACTIVE_OUTLET = toneCfg.proactiveOutlet || {};

const rates = {
  valenceSetpoint: num('VALENCE_SETPOINT', -0.05),
  connectionAccel: num('CONNECTION_ACCEL', 1.5),
  accelDelay: num('ACCEL_DELAY', 30),
  poiseDefendThreshold: num('POISE_DEFEND_THRESHOLD', 1.0),
  poiseDefendRate: num('POISE_DEFEND_RATE', 0.004),
  arousalConnectionRiseThreshold: num('AROUSAL_CONNECTION_RISE_THRESHOLD', 0.5),
  arousalConnectionRiseRate: num('AROUSAL_CONNECTION_RISE_RATE', 0.007),
  activityConnectionRelief: num('ACTIVITY_CONNECTION_RELIEF', 0),
  valenceConnectionDriftThreshold: num('VALENCE_CONNECTION_DRIFT_THRESHOLD', 1.0),
  valenceConnectionDriftRate: num('VALENCE_CONNECTION_DRIFT_RATE', 0),
};

const START = { connection: 0, poise: 0, valence: 0, arousal: 0, immersion: 0 };

const cadence = createCadence({
  getLastMessage: () => null, // 与 bridge 一致：桥不提供 lastMessage
  connectionRateFn: () => num('CONNECTION_RATE', 0.0025),
  onSave: async () => {},
  onLoad: async () => ({ ...START }),
  getPromptContext: (s) => toneGrid.getPromptContext(s),
  getStyleGuidance: (s) => toneGrid.getStyleGuidance(s),
  rates,
  thresholds: { valenceActivity: num('VALENCE_ACTIVITY_THRESHOLD', -1) },
  verbose: false,
});

(async () => {
  const tickMin = num('TICK_MINUTES', 5);
  console.log('参数: rate=' + num('CONNECTION_RATE', 0.0025) +
    ' accel=' + rates.connectionAccel + ' delay=' + rates.accelDelay + ' tick=' + tickMin + 'min');
  console.log('（对照：纯线性应每 tick +' + (num('CONNECTION_RATE', 0.0025) * tickMin).toFixed(4) + '）\n');

  let fired = null;
  let minutes = 0;
  for (let i = 1; i <= 80; i++) {
    const triggers = await cadence.tick(tickMin);
    minutes += tickMin;
    const st = await cadence.getState();
    const act = triggers.filter((t) => t.action !== 'observation').map((t) => t.action);
    console.log('t=%smin  c=%s p=%s v=%s a=%s %s',
      String(minutes).padStart(4),
      st.connection.toFixed(4), st.poise.toFixed(3), st.valence.toFixed(3), st.arousal.toFixed(3),
      act.length ? '★ ' + act.join(',') : '');
    if (act.includes('contact')) { fired = st; break; }
  }

  if (!fired) {
    const cur = await cadence.getState();
    console.log('\n!! 跑满 ' + minutes + ' 分钟仍未触发 contact（c=' + cur.connection.toFixed(3) + '）');
    return;
  }

  console.log('\n══════ 触发瞬间 ══════');
  console.log('本次跑动 ' + minutes + ' 分钟（' + (minutes / 60).toFixed(1) + ' 小时）后触发 contact');
  console.log('state: %j', {
    connection: +fired.connection.toFixed(4),
    poise: +fired.poise.toFixed(4),
    valence: +fired.valence.toFixed(4),
    arousal: +fired.arousal.toFixed(4),
    immersion: fired.immersion,
  });

  const descLines = describer(fired, { withConnection: true });
  console.log('描述层: %j', descLines);

  const block = buildProactiveNotice(
    fired, toneGrid, { scene: 'contact', reason: 'default' },
    SCENE_OVERRIDE, PROACTIVE_OUTLET, describer
  );
  console.log('\n══════ 实际会发出去的块 ══════');
  console.log(block);
  console.log('\n══════ 形状断言 ══════');
  const problems = assertBlockShape(block);
  console.log(problems.length ? '❌ ' + JSON.stringify(problems) : '✅ 通过');
  console.log('\n行数: %d  字符数: %d', block.split('\n').length, block.length);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
