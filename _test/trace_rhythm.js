'use strict';
// 单配置逐 tick trace：打印每一次引擎触发与冷却后放行
// 用法：RATE=0.002 RATES='{"poiseDefendThreshold":0.08}' MINUTES=3000 node trace_rhythm.js
const { createCadence } = require('../vendor/cadence.js');

let VNOW = new Date('2026-10-05T00:00:00+08:00').getTime();
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(VNOW); else super(...a); }
  static now() { return VNOW; }
}
Date = FakeDate;

const TICK = 5;
const RATE = Number(process.env.RATE || 0.0007);
const COOLDOWN = Number(process.env.COOLDOWN || 180);
const MINUTES = Number(process.env.MINUTES || 3000);
const RATES = JSON.parse(process.env.RATES || '{}');
const THRESHOLDS = JSON.parse(process.env.THRESHOLDS || '{}');

(async () => {
  let store = null;
  const j = createCadence({
    getLastMessage: () => ({ id: 1, content: 'x', timestamp: new RealDate(VNOW - 86400000).toISOString() }),
    connectionRateFn: () => RATE,
    onSave: async (s) => { store = s; },
    onLoad: async () => store || {
      connection: 0, poise: 0, valence: 0, arousal: 0, immersion: 0,
      lastActivity: null, lastTick: null, lastChatAnalysis: null,
      lastChatMessageId: null, lastBotMessageId: null, userStatus: 'active',
    },
    rates: Object.assign({ valenceSetpoint: -0.05, connectionAccel: 1.5, accelDelay: 30 }, RATES),
    thresholds: THRESHOLDS,
    onLog: () => {},
  });
  await j.load();

  let lastC = null, lastF = null;
  console.log(`RATE=${RATE} COOLDOWN=${COOLDOWN} RATES=${JSON.stringify(RATES)} THRESHOLDS=${JSON.stringify(THRESHOLDS)}`);
  console.log('  t(min)   c      p      v      a      i    | 引擎触发 / 放行');
  for (let m = 0; m < MINUTES; m += TICK) {
    VNOW += TICK * 60 * 1000;
    const trig = await j.tick(TICK);
    const st = store || {};
    const passed = [];
    if (trig.some((t) => t.action === 'contact') && (lastC === null || VNOW - lastC >= COOLDOWN * 60000)) passed.push('contact');
    if (trig.some((t) => t.action === 'find_activity') && (lastF === null || VNOW - lastF >= COOLDOWN * 60000)) passed.push('find_activity');

    if (trig.length > 0) {
      const acts = trig.map((t) => t.action + (t.reason ? '(' + t.reason + ')' : '')).join(',');
      console.log(
        String(m + TICK).padStart(8) + '  ' +
        (st.connection || 0).toFixed(3).padEnd(6) + ' ' +
        (st.poise || 0).toFixed(3).padEnd(6) + ' ' +
        (st.valence || 0).toFixed(3).padEnd(6) + ' ' +
        (st.arousal || 0).toFixed(3).padEnd(6) + ' ' +
        (st.immersion || 0).toFixed(3).padEnd(6) + ' | ' +
        acts + (passed.length ? '  >>> ' + passed.join('+') : '  (被冷却挡)')
      );
    }
    if (passed.includes('contact')) { lastC = VNOW; await j.applyDelta({ connection: -0.35 }); }
    if (passed.includes('find_activity')) { lastF = VNOW; }
  }
})().catch((e) => { console.error(e); process.exit(1); });
