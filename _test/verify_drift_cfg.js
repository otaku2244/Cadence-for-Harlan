'use strict';
// 端到端验证「沉降路」：从真实 .env 读参数 → 喂真实 vendor 引擎 → 看是否触发 low_valence
// 跑法：node _test/verify_drift_cfg.js
const fs = require('fs');
const { createCadence } = require('/root/cadence-bridge/vendor/cadence.js');

const envTxt = fs.readFileSync('/root/cadence-bridge/.env', 'utf8');
const get = (k, d) => {
  const m = envTxt.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : d;
};

const VA = parseFloat(get('VALENCE_ACTIVITY_THRESHOLD', '-1.0'));
const DTH = parseFloat(get('VALENCE_CONNECTION_DRIFT_THRESHOLD', '0.0'));
const DRT = parseFloat(get('VALENCE_CONNECTION_DRIFT_RATE', '0'));
const SPD = parseFloat(get('VALENCE_SETPOINT', '-0.05'));

console.log('── .env 实际读出 ──');
console.log('VALENCE_SETPOINT                = ' + SPD);
console.log('VALENCE_ACTIVITY_THRESHOLD      = ' + VA + '   (需 < setpoint 才不恒成立；低于 ' + (SPD - VA).toFixed(3) + ')');
console.log('VALENCE_CONNECTION_DRIFT_THRESH   = ' + DTH + '   (drift 开启条件 c >= 此值)');
console.log('VALENCE_CONNECTION_DRIFT_RATE   = ' + DRT + '   (>' + 0 + ' = 开)');
console.log('');

(async () => {
  let store = {
    connection: 0.25, poise: 0.28, valence: -0.05, arousal: -0.03, immersion: 0,
    lastActivity: null, lastTick: null, lastChatAnalysis: null,
    lastChatMessageId: null, lastBotMessageId: null, userStatus: 'active',
  };
  const j = createCadence({
    getLastMessage: () => ({ id: 1, content: 'x', timestamp: new Date(Date.now() - 86400000).toISOString() }),
    connectionRateFn: () => parseFloat(get('CONNECTION_RATE', '0.0007')),
    onSave: async (s) => { store = s; },
    onLoad: async () => store,
    rates: {
      valenceSetpoint: SPD,
      connectionAccel: parseFloat(get('CONNECTION_ACCEL', '0')),
      accelDelay: parseFloat(get('ACCEL_DELAY', '0')),
      poiseDefendThreshold: parseFloat(get('POISE_DEFEND_THRESHOLD', '1.0')),
      poiseDefendRate: parseFloat(get('POISE_DEFEND_RATE', '0.003')),
      activityConnectionRelief: parseFloat(get('ACTIVITY_CONNECTION_RELIEF', '0')),
      valenceConnectionDriftThreshold: DTH,
      valenceConnectionDriftRate: DRT,
    },
    thresholds: { valenceActivity: VA },
    onLog: () => {},
  });
  await j.load();

  console.log('── 注入 c=0.25（已过 drift 门槛）后逐 tick 观察 300 分钟 ──');
  let hits = [];
  for (let i = 0; i < 60; i++) {
    const t = await j.tick(5);
    if (t.length) hits.push(t.map((x) => x.action + (x.reason ? '(' + x.reason + ')' : '')).join(','));
    if (i % 10 === 0 || t.length) {
      console.log('+' + String((i + 1) * 5).padStart(4) + 'min  c=' + store.connection.toFixed(3) +
        '  p=' + store.poise.toFixed(3) + '  v=' + store.valence.toFixed(3) +
        '  a=' + store.arousal.toFixed(3) + '  i=' + store.immersion.toFixed(3) +
        '  | ' + (t.map((x) => x.action + (x.reason ? '(' + x.reason + ')' : '')).join(',') || '—'));
    }
  }
  console.log('');
  console.log('触发汇总: ' + (hits.length ? hits.join(' | ') : '（300 分钟内无触发）'));
})().catch((e) => { console.error(e); process.exit(1); });
