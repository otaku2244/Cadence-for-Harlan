'use strict';
// 描述层 —— 现在只剩 connection 一维：说「她多久没动静了」。
//
// ── 为什么只剩这一维（2026-10-23 收敛）─────────────────────────────
// 作者的架构里，注入只有**一层**：一张 CORE_PROFILES 格子（+ 可选急迫度尾注）。
// getStyleGuidance 与 getPromptContext 共用同一张表，差别只在叠加的 reactive /
// proactive 那行。作者从未设计"独立描述层"。
//
// 本部署曾把两个槽都填了 tone-grid，导致"处境"消失，于是手写了这个文件补回来。
// 结果它成了第二套指令，与 27 格抢同一块地盘：
//   · poise 段 ← 与 27 格的 poise 档**同一根轴**（同一个值决定档位，也决定这句）
//   · mood  段 ← 与 classifyCluster **同一组 ±0.3 阈值**，必然同时触发且同义
//   · immersion 段 ← 活动登记早已切断，lastActivity 恒空、immersion 恒 0
// 三段已全部撤除，文案归档在 config 的 `_archived_*` 里，没有删。
//
// 只留 connection：它是纯事实处境（时间维度），27 格完全不涉及，不构成重复；
// 而且只进主动唤醒块 —— 此刻块是"她刚说完这一句"，时间维度的问句一句都不成立。
//
// ── 与 27 格的分工（别让两边抢活）──────────────────────────────
//   · 这里 = 处境。陈述句、零祈使。「她多久没动静了」
//   · 27 格 = 语气。查表指令。「那就该怎么说话」
//
// 档位选取：`max` 是**开区间上界**（`value < max` 命中），末项不带 max = 兜底档。
// 用 `<` 而不是 `<=` 与 vendor 的 classifyUrgency 口径一致（c >= 0.20 → aware，
// 所以 c=0.20 该落到「< 0.35」那一档），否则描述层与 27 格会在同一个 c 上错开一格。
function pick(list, value) {
  if (!Array.isArray(list) || !list.length) return '';
  for (const item of list) {
    if (item.max === undefined || item.max === null) return item.text || '';
    if (value < item.max) return item.text || '';
  }
  return list[list.length - 1].text || '';
}

/**
 * @param {object} section config/tone-harlan.json 的 `describe` 段
 */
function createDescriber(section) {
  const cfg = section || {};
  const connection = cfg.connection || [];

  /**
   * @param {object} state 状态快照（只读 connection）
   * @param {object} [opts] { withConnection }
   *   withConnection === false → 此刻块，不出任何行（她刚说完话，时间维度不成立）
   * @returns {string[]} 行数组，调用方 join('\n') 后拼进块
   */
  return function describeState(state, opts) {
    const o = opts || {};
    if (o.withConnection === false) return [];
    const line = pick(connection, Number((state || {}).connection) || 0);
    return line && line.trim() ? [line] : [];
  };
}

module.exports = { createDescriber };
