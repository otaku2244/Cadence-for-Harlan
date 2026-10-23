'use strict';
// ============================================================
// 重复抑制：场景冷却 + 判定器去重
//
// 场景冷却：同一场景（contact / find_activity）在 N 分钟内只放行一次。
// 判定器去重：工具轮里 Operit 复用同一份 messages，同一段对话只喂判定器一次。
//
// ⚠️ 2026-10-10 变更：冷却表**可持久化**。
//   原实现是进程内内存，重启即清空；桥一天重启几次就会多放行几次主动唤醒
//   （实测：9:00 投递 contact → 9:35/9:36 三次重启 → 9:41 又放行一次）。
//   现在通过 restore()/onChange 由 bridge.js 挂到 state.json：
//     · 启动时 restore(state.cooldown)
//     · mark()/reset() 时 onChange(snapshot) → 桥标脏落盘
//   仍然保留"内存优先"语义：没接持久化时行为和原来完全一致。
// ============================================================

// ── 场景冷却 ──────────────────────────────────────
// minutes <= 0 表示关闭（ok() 恒真）。
// now 可注入，便于单测。
function createSceneCooldown(opts) {
  const o = opts || {};
  const minutes = Number(o.minutes) || 0;
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const onChange = typeof o.onChange === 'function' ? o.onChange : null;
  const last = Object.create(null);

  // 变更通知：持久化层据此落盘。onChange 抛错不影响主流程。
  function notify() {
    if (!onChange) return;
    try { onChange(Object.assign(Object.create(null), last)); } catch (_) {}
  }

  return {
    // 该场景现在能不能触发
    ok(scene) {
      if (!(minutes > 0)) return true;
      const t = last[scene];
      return !t || (now() - t) >= minutes * 60000;
    },

    // 记账。**只在真正执行前调用** —— 被静默时段/日上限挡掉的轮次不该吃掉冷却。
    mark(scene) { last[scene] = now(); notify(); },

    // 还剩几分钟（日志用）
    remainingMinutes(scene) {
      if (!(minutes > 0)) return 0;
      const t = last[scene];
      if (!t) return 0;
      const left = minutes - (now() - t) / 60000;
      return left > 0 ? left : 0;
    },

    reset(scene) {
      if (scene) delete last[scene];
      else for (const k in last) delete last[k];
      notify();
    },

    // 从快照恢复（启动时由 state.json 灌入）。
    // 只接受「数字时间戳」的项，脏数据一律忽略，避免坏 state 卡死冷却。
    restore(obj) {
      if (!obj || typeof obj !== 'object') return;
      for (const k in last) delete last[k];
      for (const k in obj) {
        const v = Number(obj[k]);
        if (Number.isFinite(v) && v > 0) last[k] = v;
      }
      // 恢复本身不算"变更"，不回通知，避免启动即脏。
    },

    snapshot() { return Object.assign(Object.create(null), last); },
    minutes() { return minutes; },
  };
}

// ── 判定器去重 ────────────────────────────────────
// key 取「最后一条 user 文本」：工具轮里它一字未变，
// 真出现新的一轮（她说了新话）它必变。
// windowSeconds 是 TTL 兜底：同一句话隔了很久又出现，仍应重新判。
// windowSeconds <= 0 表示关闭（accept() 恒真）。
function createDialogDedup(opts) {
  const o = opts || {};
  const windowSeconds = Number(o.windowSeconds) || 0;
  const now = typeof o.now === 'function' ? o.now : Date.now;
  let lastKey = null;
  let lastAt = 0;

  return {
    // true = 该喂判定器；false = 与上一轮同一段对话，跳过
    // ⚠️ 命中即记账：setImmediate 有异步窗口，不先记账会并发放行两条。
    accept(key) {
      const k = String(key == null ? '' : key);
      if (!k) return false;
      if (windowSeconds > 0 && k === lastKey && (now() - lastAt) < windowSeconds * 1000) {
        return false;
      }
      lastKey = k;
      lastAt = now();
      return true;
    },

    reset() { lastKey = null; lastAt = 0; },
    snapshot() { return { key: lastKey, at: lastAt }; },
    windowSeconds() { return windowSeconds; },
  };
}

module.exports = { createSceneCooldown, createDialogDedup };
