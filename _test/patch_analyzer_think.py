# -*- coding: utf-8 -*-
"""analyzer.js 思考链关闭参数按 provider 适配（幂等）。

背景（2026-10-10 实测，agnes 官方文档 + 6 组参数对照）：
  · `agnes-3.0-flash` 默认**不思考**（基线 reasoning_content=null，completion=4）
  · `thinking:{type:"disabled"}`（Anthropic Messages API 写法）在 Chat Completions
    端点上**无效且反向触发思考** —— 加上它 reasoning 从 0 变 37 token，
    真实场景 completion 从 40 涨到 600~1024，且 D 场景直接 finish_reason=length、content 为空。
  · 正确写法：`chat_template_kwargs: { enable_thinking: false }`
    （官方文档明确：必须放在 chat_template_kwargs 内，顶层 enable_thinking 无效）
  · deepseek-flash 则相反：`thinking:{type:"disabled"}` 有效
    （reasoning 消失、completion 66→5），`chat_template_kwargs` 无效。

所以按 base URL 自适应，不再依赖 LLM_DISABLE_THINKING 的取值是否"设对"。
"""
import io, sys

P = "/root/jiwen-bridge/lib/analyzer.js"

A = """    // 关闭思考链（仅对推理型模型有意义）。deepseek-flash 实测：
    //   thinking:{type:"disabled"} → reasoning_content 消失、completion_tokens 从 66 降到 5
    //   chat_template_kwargs.enable_thinking=false → 无效，仍有 reasoning_content
    // 判定任务是简单的规则映射，不需要思考链；关掉既省 token 又省延迟。
    // 换回非推理模型（如 agnes）时应把 LLM_DISABLE_THINKING 设为 0 或删除该行。
    const disableThinking = (process.env.LLM_DISABLE_THINKING || 'true') !== 'false'
      && (process.env.LLM_DISABLE_THINKING !== '0');
    if (disableThinking) body.thinking = { type: 'disabled' };"""

B = """    // ── 关闭思考链（判断 provider 语法，2026-10-10 实测重写）────────────────
    // 判定任务是简单的规则映射，不需要思考链；关掉既省 token 又省延迟。
    //
    // ⚠️ 不同 provider 的写法**互不通用**，写错会反向触发思考：
    //   · deepseek-flash：thinking:{type:"disabled"} 有效（reasoning 消失、66→5 tok）
    //   · agnes 系      ：chat_template_kwargs.enable_thinking=false 有效；
    //                     thinking:{type:"disabled"} **无效且会触发思考**
    //                     （实测 completion 40 → 600~1024，偶发 finish_reason=length
    //                      导致 content 为空 → 桥上走 replyRelief 兜底）
    //                     顶层 enable_thinking=false 亦无效（官方文档明示）。
    //
    // 按 base URL 自适应，不再依赖 LLM_DISABLE_THINKING 是否"设对"。
    const disableThinking = (process.env.LLM_DISABLE_THINKING || 'true') !== 'false'
      && (process.env.LLM_DISABLE_THINKING !== '0');
    if (disableThinking) {
      const isAgnes = /agnes/i.test(cfg.llmBase || '') || /agnes/i.test(cfg.llmModel || '');
      if (isAgnes) {
        body.chat_template_kwargs = { enable_thinking: false };
      } else {
        body.thinking = { type: 'disabled' };
      }
    }"""


def main():
    with io.open(P, "r", encoding="utf-8") as f:
        text = f.read()

    if "chat_template_kwargs = { enable_thinking: false }" in text:
        print("SKIP: already patched")
        return
    if A not in text:
        print("ERROR: anchor not found")
        sys.exit(1)

    text = text.replace(A, B, 1)
    with io.open(P, "w", encoding="utf-8") as f:
        f.write(text)
    print("OK patched")


main()
