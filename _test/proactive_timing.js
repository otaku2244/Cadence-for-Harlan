'use strict';
// ============================================================
// 主动唤醒「时间间隔与频次」精确计算
//
// 用真实 vendor/cadence.js 引擎跑，参数取线上 .env 实值。
// 回答两个问题：
//   Q1 她多久不说话，会触发第一次唤醒？（首动作时间）
//   Q2 一天最多触发几次？间隔多少？（频次）
//
// 关键公式（vendor/cadence.js:248-271）：
//   accelFactor  = (1 + connection) ^ connectionAccel   （当 elapsed >= accelDelay）
//   effectiveRate= CONNECTION_RATE × accelFactor × valenceMult × immersionFactor
//   connection  += effectiveRate × mins     （每个 tick 累加）
//
// 线上实值：CONNECTION_RATE=0.0025, CONNECTION_ACCEL=1.5, ACCEL_DELAY=30,
//          tick=5min, ACTION_COOLDOWN_MINUTES=180, QUIET=0-8, MAX_PER_DAY=16
// 阈值：observation=0.20, considerContact=0.35, forceContact=0.50
// ============================================================
const path = require('path');
const ROOT = '/root/cadence-bridge';
const { createCadence } = require(path.join(ROOT, 'vendor/cadence.js'));

// ── 线上 .env 实值 ──
const CFG = {
  connectionRate: 0.0025,
  connectionAccel: 1.5,
  accelDelay: 30,
  valenceSetpoint: -0.05,
  poiseDefendThreshold: 1.0,
  poiseDefendRate: 0.004,
  actionCooldownMinutes: 180,
  tickMinutes: 5,
};

// ── 纯数学：先算理论曲线，再与引擎实跑对照 ──
function theoretical() {
  console.log('=== 理论计算：connection 增长曲线（无判定器介入，纯时间漂移）===');
  console.log('公式：dC/dt = 0.0025 × (1+C)^1.5   （elapsed > 30min 后启用加速）');
  console.log();
  const R = CFG.connectionRate, K = CFG.connectionAccel, DELAY = CFG.accelDelay;

  // 数值积分（每 0.5 分钟一步，精度足够）
  let c = 0, t = 0, step = 0.5;
  const marks = {};
  const targets = { '0.20 观察线': 0.20, '0.35 考虑线': 0.35, '0.50 强制线': 0.50, '0.99 上限': 0.99 };
  while (t < 72 * 60 && c < 0.9999) {
    const useAccel = t >= DELAY;
    const accel = useAccel ? Math.pow(1 + c, K) : 1;
    c += R * accel * step;
    t += step;
    if (c > 1) c = 1;
    for (const [label, v] of Object.entries(targets)) {
      if (!(label in marks) && c >= v) marks[label] = t;
    }
  }
  for (const [label, v] of Object.entries(targets)) {
    if (label in marks) {
      const h = Math.floor(marks[label] / 60), m = Math.round(marks[label] % 60);
      console.log(`  ${label.padEnd(12)} → 沉默 ${marks[label].toFixed(0)} 分钟（${h}h${m}m）`);
    } else {
      console.log(`  ${label.padEnd(12)} → 72h 内未达到`);
    }
  }
  console.log();
  // 分段耗时
  console.log('  分段耗时：');
  console.log(`    0    → 0.20 : ${marks['0.20 观察线']?.toFixed(0)} 分钟`);
  console.log(`    0.20 → 0.35 : ${(marks['0.35 考虑线'] - marks['0.20 观察线'])?.toFixed(0)} 分钟`);
  console.log(`    0.35 → 0.50 : ${(marks['0.50 强制线'] - marks['0.35 考虑线'])?.toFixed(0)} 分钟`);
  console.log();
}

theoretical();

// ── 引擎实跑：模拟"她整天不说话" ──
async function engineRun() {
  console.log('=== 引擎实跑：她 24 小时完全沉默 ===');
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
  const TOTAL_MIN = 24 * 60;
  const events = [];
  const cooldown = {}; // 场景冷却
  let prevC = 0;

  for (let t = 0; t <= TOTAL_MIN; t += TICK) {
    await cadence.tick(TICK);
    const s = await cadence.getState();
    const c = s.connection;

    // 判定动作（复刻 vendor 决策逻辑）
    let action = null;
    if (c >= 0.50) action = 'contact(force)';
    else if (c >= 0.35) {
      action = (s.poise >= 0.50) ? 'find_activity(poiseBlock)' : 'contact';
    } else if (c >= 0.20) action = 'observation(仅内部)';

    if (action && !action.startsWith('observation')) {
      const scene = action.startsWith('find') ? 'find_activity' : 'contact';
      const okCool = !cooldown[scene] || (t - cooldown[scene]) >= CFG.actionCooldownMinutes;
      if (okCool) {
        cooldown[scene] = t;
        events.push({ t, c: c.toFixed(3), action, poise: s.poise.toFixed(3) });
      }
    }
    if (t % 60 === 0) {
      console.log(`  t=${String(t).padStart(3)}min  c=${c.toFixed(3)}  p=${s.poise.toFixed(3)}  a=${s.arousal.toFixed(3)}`);
    }
  }

  console.log();
  console.log(`--- 24h 内实际放行的主动唤醒：${events.length} 次 ---`);
  events.forEach((e, i) => {
    const h = Math.floor(e.t / 60), m = e.t % 60;
    const gap = i > 0 ? `  （距上次 ${e.t - events[i - 1].t} 分钟）` : '';
    console.log(`  #${i + 1}  ${String(h).padStart(2)}h${String(m).padStart(2)}m  c=${e.c}  ${e.action}${gap}`);
  });
  console.log();
  console.log('结论：无判定器介入时，冷却 180min 是主导节拍；理论最大频次 = 24h × 60 / 180 = 8 次');
  console.log('      但静默时段 0-8 点（8h=480min）会吃掉约 2~3 次窗口，实际更少。');
}

engineRun().catch((e) => console.error('ERROR', e));
