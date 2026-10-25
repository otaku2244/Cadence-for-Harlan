#!/usr/bin/env node
/**
 * 模拟真实投递节奏：冷却 180 分钟到点就投递（applyDelta connection -0.35），
 * 其余时间纯漂移。观察 poise 在新阈值 0.35 下的长期轨迹。
 */
const { createCadence } = require('../vendor/cadence.js');

const RATE = 0.0025, ACCEL = 1.5, TICK = 5, COOLDOWN = 180;

async function run(threshold) {
  const cad = createCadence({
    getLastMessage: () => null,
    connectionRateFn: () => RATE,
    onSave: async () => {}, onLoad: async () => ({ connection: 1.0, poise: 0.5, valence: -0.05, arousal: 0, immersion: 0 }),
    rates: { valenceSetpoint: -0.05, connectionAccel: ACCEL, accelDelay: 30,
             poiseDefendThreshold: threshold, poiseDefendRate: 0.004 },
    verbose: false, onLog: () => {},
  });

  let sinceDelivery = 0;
  const samples = [];
  const tiers = {};
  for (let i = 1; i <= 288; i++) {           // 24h
    await cad.tick(TICK);
    sinceDelivery += TICK;
    let s = await cad.getState();
    // 投递：c 过线且冷却到点（模拟 fireProactive）
    if (s.connection >= 0.35 && sinceDelivery >= COOLDOWN) {
      await cad.applyDelta({ connection: -0.35 });
      sinceDelivery = 0;
      s = await cad.getState();
    }
    const t = s.poise > 0.3 ? 3 : (s.poise > 0.1 ? 2 : 1);
    tiers[t] = (tiers[t] || 0) + 1;
    if (i % 12 === 0) samples.push({ min: i * TICK, c: s.connection, p: s.poise });
  }
  return { threshold, samples, tiers };
}

(async () => {
  for (const th of [1.0, 0.35]) {
    const r = await run(th);
    console.log(`\n════ 阈值 ${th} ════`);
    console.log('  时刻       c      p');
    for (const s of r.samples) {
      console.log(`  t=${String(s.min).padStart(4)}min  ${s.c.toFixed(3)}  ${s.p.toFixed(3)}`);
    }
    const total = Object.values(r.tiers).reduce((a, b) => a + b, 0);
    console.log('  档位占比: ' + Object.keys(r.tiers).sort().map(k => `档${k} ${(r.tiers[k] * 100 / total).toFixed(1)}%`).join('  '));
  }
})();
