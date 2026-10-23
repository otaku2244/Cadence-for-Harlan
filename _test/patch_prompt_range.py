# -*- coding: utf-8 -*-
"""给 analyze-prompt-user.txt 注入「数值幅度硬约束」。
纯追加，不改动原有规则文本。幂等：已注入则跳过。
"""
import io, sys, re

PATH = r"/root/jiwen-bridge/config/analyze-prompt-user.txt"

ANCHOR_1 = """connection（连接需求）：负 = 被满足了，不急着找她（最多 -0.50）
                        正 = 没被满足/被冷落/话没说完（最多 +0.30）
"""

BLOCK_1 = ANCHOR_1 + """
⚠️【数值幅度硬约束 —— 最高优先级，覆盖一切规则】
上面的区间是**工作区间，不是建议值**。引擎会在你输出后按轴截断
（pride/valence/arousal 截到 ±0.30，connection 截到 -0.50 ~ +0.30），
所以超范围输出只会变成"永远顶格"，反而丢掉细腻度。因此：

1. 严格落在该规则给出的区间内，不要外扩。示弱就是 -0.10 ~ -0.25，
   不是 -0.5；普通闲聊就是 ±0.03，不是 ±0.1。
2. **禁止给满格值**。除非规则明确要求"大幅"，否则不要输出 ±0.30 / ±0.50
   这类端点值。宁小勿大：拿不准时取区间中位数偏小的一侧。
3. 语义强度 → 数值强度要**克制映射**。她示弱让你心疼，不代表 valence 要拉满；
   一个细腻的 -0.15 比一个粗暴的 -0.30 更准确。
4. 每一轴独立判断，**不要整轮同向放大**。允许出现 (pride -0.15, valence +0.08,
   arousal -0.08, connection 0) 这种各轴幅度不等的组合。
5. 没有任何规则命中时，**所有轴一律 0**（不要为了"有反应"而硬给数值）。
"""

ANCHOR_2 = "只返回 JSON。"

BLOCK_2 = """收尾复述（务必遵守）：
- 所有数值必须严格落在前述规则给出的区间内，宁小勿大，禁止顶格。
- 未命中任何规则 → 四轴全部为 0。
- 只返回 JSON，不要解释、不要 markdown 代码块、不要多余文字。

只返回 JSON。"""


def main():
    with io.open(PATH, "r", encoding="utf-8") as f:
        text = f.read()

    changed = False

    if "数值幅度硬约束" in text:
        print("SKIP block1: already present")
    else:
        if ANCHOR_1 not in text:
            print("ERROR: anchor1 not found")
            sys.exit(1)
        text = text.replace(ANCHOR_1, BLOCK_1, 1)
        changed = True
        print("OK block1 injected")

    if "收尾复述（务必遵守）" in text:
        print("SKIP block2: already present")
    else:
        if ANCHOR_2 not in text:
            print("ERROR: anchor2 not found")
            sys.exit(1)
        # 替换最后一个 "只返回 JSON。"
        idx = text.rfind(ANCHOR_2)
        text = text[:idx] + BLOCK_2 + text[idx + len(ANCHOR_2):]
        changed = True
        print("OK block2 injected")

    if changed:
        with io.open(PATH, "w", encoding="utf-8") as f:
            f.write(text)
        print("WRITTEN")
    else:
        print("NO CHANGE")


main()
