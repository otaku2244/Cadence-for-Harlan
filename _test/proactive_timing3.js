'use strict';
// ============================================================
// 主动唤醒 · v3 补充两个关键问题
//   Q3: 为什么 poise 停在 0.5 不动？（核实 poiseDefend 逻辑）
//   Q4: 她「间歇说话」时，唤醒间隔是多少？（真实日常场景）
// ============================================================
const path = require('path');
const ROOT = '/root/cadence-bridge';
const { createCadence } = require(path.join(ROOT, 'vendor/cadence.js'));

const CFG = {
  connectionRate: 0.0025, connectionAccel: 1.5, accelDelay: 30,
  valenceSetpoint: -0.05,
  poiseDefendThreshold: 1.0, poiseDefendRate: 0.004,
  actionCooldownMinutes: 180, tickMinutes: 5,
  quietStart: 0, quietEnd: 8, maxPerDay: 16,
  observation: 0.20, considerContact: 0.35, forceContact: 0.50, poiseBlock: 0.50,
};

function mkEngine() {
  return createCadence({
    getLastMessage: () => null,
    connectionRateFn: () => CFG.connectionRate,
    onSave: async () => {},
    onLoad: async () => ({
      connection: 0, poise: 0, valence: 0, arousal: 0, immersion: 0,
      lastActivity: null, lastTick: null,
      lastChatAnalysis: null, lastChatMessageId: null, lastBotMessageId: null,
      userStatus: 'active',
    }),
    rates: { valenceSetpoint: CFG.valenceSetpoint, connectionAccel: CFG.connectionAccel, accelDelay: CFG.accelDelay },
  });
}

function inQuiet(t) { const h = Math.floor(t / 60) % 24; return h >= CFG.quietStart && h < CFG.quietEnd; }

// ── Q3: 长期沉默下 poise 的演化 ──
async function q3() {
  console.log('=== Q3 poise 长期演化（她完全不说话）===');
  const j = mkEngine(); await j.getState();
  for (let t = 0; t <= 24 * 60; t += 5) {
    await j.tick(5);
    if (t % 120 === 0) {
      const s = await j.getState();
      console.log(`  t=${String(Math.floor(t/60)).padStart(2)}h  c=${s.connection.toFixed(3)}  p=${s.poise.toFixed(3)}  v=${s.valence.toFixed(3)}  a=${s.arousal.toFixed(3)}`);
    }
  }
  console.log('  → 观察：poise 涨到 0.5 后停住？看下一行 = 是否命中 poiseDefend');
  console.log();
}

// ── Q4: 间歇说话 ──
// 模拟：她每隔 GAP 分钟说一句话（判定器会把 c 降 0.10~0.20）
// 问：这种情况下还能触发唤醒吗？间隔多久？
async function q4() {
  console.log('=== Q4 她「间歇说话」时的唤醒情况 ===');
  for (const gap of [30, 60, 120]) {
    const j = mkEngine(); await j.getState();
    const TICK = 5, TOTAL = 24 * 60;
    const cd = { contact: null, find_activity: null };
    const sent = [];
    let count = 0, lastMsg = 0;

    for (let t = 0; t <= TOTAL; t += TICK) {
      // 她每隔 gap 分钟说一句 → 判定器降 c（取保守值 -0.10）
      if (t > 0 && t % gap === 0) {
        await j.applyDelta({ connection: -0.10 });
        lastMsg = t;
      }
      await j.tick(TICK);
      const s = await j.getState();
      const c = s.connection, p = s.poise;

      if (inQuiet(t % (24 * 60))) continue;
      let scene = null;
      if (c >= CFG.forceContact) scene = 'contact';
      else if (c >= CFG.considerContact) scene = (p >= CFG.poiseBlock) ? 'find_activity' : 'contact';
      if (!scene) continue;
      if (count >= CFG.maxPerDay) continue;
      if (cd[scene] !== null && (t - cd[scene]) < CFG.actionCooldownMinutes) continue;

      cd[scene] = t; count++;
      sent.push({ t, c: +c.toFixed(3), scene });
    }

    const h = (m) => `${String(Math.floor(m / 60)).padStart(2)}:${String(m % 60).padStart(2)}`;
    console.log(`── 她每 ${gap} 分钟说一句（每句 c -0.10）──`);
    if (!sent.length) console.log('   唤醒 0 次（她的发言持续压住 connection）');
    else {
      sent.forEach((e, i) => console.log(`   #${i + 1}  ${h(e.t)}  c=${e.c}  ${e.scene}${i > 0 ? '  ←间隔 ' + (e.t - sent[i - 1].t) + 'min' : ''}`));
      console.log(`   共 ${sent.length} 次`);
    }
    console.log();
  }
}

(async () => { await q3(); await q4(); })().catch((e) => console.error(e));
