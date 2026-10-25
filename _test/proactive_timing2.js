'use strict';
// ============================================================
// 主动唤醒「时间间隔与频次」精确计算 · v2
//
// 相比 v1 修正了三点：
//   1. 加入静默时段（QUIET_START=0 / QUIET_END=8，北京时间）
//      —— fireProactive 的 inQuietHours() 会拦截，且**不消耗冷却**
//   2. contact 与 find_activity 是**两张独立冷却表**（各 180min）
//   3. poise 演化：c >= poiseDefendThreshold(1.0) 后朝 0.5 漂移
//      —— 线上 POISE_DEFEND_THRESHOLD=1.0，c 上限也是 1.0，critical
// ============================================================
const path = require('path');
const ROOT = '/root/cadence-bridge';
const { createCadence } = require(path.join(ROOT, 'vendor/cadence.js'));

const CFG = {
  connectionRate: 0.0025,
  connectionAccel: 1.5,
  accelDelay: 30,
  valenceSetpoint: -0.05,
  poiseDefendThreshold: 1.0,
  poiseDefendRate: 0.004,
  actionCooldownMinutes: 180,
  tickMinutes: 5,
  quietStart: 0,   // 本地时间（北京）
  quietEnd: 8,
  maxPerDay: 16,
  tzOffsetHours: 8,
  firstContactMin: 114,
  // vendor 默认阈值
  observation: 0.20,
  considerContact: 0.35,
  forceContact: 0.50,
  poiseBlock: 0.50,
};

// 引擎 tick 用 UTC；这里统一用「本地分钟数」做时间轴，便于套静默时段
function localHourOf(minuteOfDay) { return Math.floor(minuteOfDay / 60) % 24; }
function inQuiet(minuteOfDay) {
  const h = localHourOf(minuteOfDay);
  return CFG.quietStart <= h && h < CFG.quietEnd;   // 0-8 点
}

async function simulate(startLocalHour, hours) {
  const cadence = createCadence({
    getLastMessage: () => null,
    connectionRateFn: () => CFG.connectionRate,
    onSave: async () => {},
    onLoad: async () => ({
      connection: 0, poise: 0, valence: 0, arousal: 0, immersion: 0,
      lastActivity: null, lastTick: null,
      lastChatAnalysis: null, lastChatMessageId: null, lastBotMessageId: null,
      userStatus: 'active',
    }),
    rates: {
      valenceSetpoint: CFG.valenceSetpoint,
      connectionAccel: CFG.connectionAccel,
      accelDelay: CFG.accelDelay,
    },
  });
  await cadence.getState();

  const TICK = CFG.tickMinutes;
  const TOTAL = hours * 60;
  const cd = { contact: null, find_activity: null };
  const sent = [];
  let count = 0;

  for (let t = 0; t <= TOTAL; t += TICK) {
    await cadence.tick(TICK);
    const s = await cadence.getState();
    const c = s.connection, p = s.poise, i = s.immersion;

    const localMin = ((startLocalHour * 60) + t) % (24 * 60);
    const quiet = inQuiet(localMin);

    // ── 复刻 vendor 决策 ──
    let scene = null;
    if (c >= CFG.forceContact) scene = 'contact';
    else if (c >= CFG.considerContact) {
      scene = (p >= CFG.poiseBlock) ? 'find_activity' : 'contact';
    }
    if (!scene) continue;

    // ── 闸门 1：静默时段（不消耗冷却）──
    if (quiet) continue;
    // ── 闸门 2：日上限 ──
    if (count >= CFG.maxPerDay) continue;
    // ── 闸门 3：场景冷却 ──
    if (cd[scene] !== null && (t - cd[scene]) < CFG.actionCooldownMinutes) continue;

    cd[scene] = t;
    count++;
    sent.push({ t, localMin, c: +c.toFixed(3), p: +p.toFixed(3), scene });
  }

  return sent;
}

(async () => {
  console.log('=== 主动唤醒 · 频次与间隔（含静默时段 0-8 点，双场景独立冷却 180min）===');
  console.log();

  for (const startH of [9, 20]) {
    const sent = await simulate(startH, 24);
    console.log(`── 场景：她从 ${String(startH).padStart(2)}:00 起完全沉默 24 小时 ──`);
    if (!sent.length) { console.log('   （无唤醒）\n'); continue; }
    sent.forEach((e, i) => {
      const h = Math.floor(e.localMin / 60), m = e.localMin % 60;
      const gap = i > 0 ? `  ←间隔 ${e.t - sent[i - 1].t}min` : '';
      console.log(`   #${String(i + 1).padStart(2)}  ${String(h).padStart(2)}:${String(m).padStart(2)}  c=${e.c} p=${e.p}  ${e.scene}${gap}`);
    });
    const gaps = sent.slice(1).map((e, i) => e.t - sent[i].t);
    const avg = gaps.length ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(0) : '-';
    console.log(`   共 ${sent.length} 次 ｜ 平均间隔 ${avg} min`);
    console.log();
  }

  console.log('=== 理论边界 ===');
  console.log(`  首次唤醒：c 达到 0.35（考虑线）约需 ${CFG.firstContactMin} 分钟沉默`);
  console.log(`  最大频次：24h 内，除去静默 8h（480min）+ 首次建线时间，`);
  console.log(`            受 ${CFG.actionCooldownMinutes}min 冷却约束，上限 = floor((24×60 - 480) / 180) ≈ 5~6 次`);
  console.log(`            日上限 ${CFG.maxPerDay} 次不会成为瓶颈。`);
})();
