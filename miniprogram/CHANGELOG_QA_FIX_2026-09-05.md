# CHANGELOG — QA 修复（日历真实日期 / Profile 契约 / 生成跳转 / WeChat 测试）

日期：2026-09-05
依据：`docs/pi-briefs/2026-09-05-qa-fix-calendar-profile.md` + `miniprogram/QA_REPORT_2026-09-05.md`

本 changelog 记录本轮 QA 修复的代码改动、验证方式与测试结果。未 git push。未写任何密钥进仓库。

---

## P1 — 回忆日历：真实日期关联（工作流 D 闭环）

文件：`miniprogram/pages/calendar/index.ts`（重写逻辑）、`index.wxml`（`selectedDay` → `selectedDate`）、`index.wxss`（去蓝改为奶油色）

改动：
1. 年月改为**真实当前年月**初始化，不再写死 2024/5。
2. 新增 `generateCalendar()`：按 `year/month` 动态生成月历网格，包含上月/下月占位，7 列对齐（≤6 行）。`hasDiary` 来自 `diariesByDate` 聚合，禁止硬编码日期。
3. `fetchDiaries()` 用 `listDiaries()` 拉取真实日记，按 `created_at` 的**本地日期**聚合成 `YYYY-MM-DD`（避免 UTC 偏移一天），`diaryDateKey` 统一解析。
4. `onSelectDay`：点**有日记的当天** → `navigateTo /pages/diary/index?id=<该日最新日记>`（`/diaries/{job_id}`，作业 id 即日记 id）；无同日日记 → 展示空态「这一天还没有回忆…」。跨月/跨年占位不可选。
5. 点当月无日记的日期：正常选中并显示空态；不误进其它月。
6. `onPrev/onNext` 与选年/选月（onPickYear/onPickMonth）切换后**重排网格 + 过滤当日卡片**，选中日保持在当月初/合理范围。
7. 当日回忆卡由后端数据渲染：标题、情绪（`mood`）、时间（`created_at` 生成 HH:mm）、封面（面板图，缺用占位漫画图）。
8. **移除 `onShow` 中对非 Tab 页调用 `setSelected`**（日历为子页）；改为子页返回时若已装载则由 `onShow` 刷新（首启只取一次，避免重复请求）。
9. 空/失败态：`failed` 时显示「回忆加载失败，请重试」并提供「重新加载」按钮。

说明：
- 多篇同日日记目前「打开最新一篇」，列表入口可后续优化；已在 changelog 说明（择优策略）。

## P2-1 — Profile `companion_days` 契约

后端：
- `backend/app/schemas/auth.py`：`UserResponse` 增加 `companion_days: int = 1`。
- `backend/app/api/routers/auth.py` `get_me`：由 `current_user.created_at`（UTC）与当前时间之差计算陪伴天数，`max(1, int(delta.days)+1)`。

前端：`miniprogram/pages/profile/index.ts`
- 取消硬编码 `companion_days: 28`。
- 用后端 `user.companion_days`；缺省回退到 `created_at` 本地计算（**绝不写死 28**）。
- `voiceDays` 改为「真实有日记的本地天数」（由 listDiaries 去重日期统计），不再硬编码 12；无数据为 0。
- `diaryCount` / `comicCount` 由 `listDiaries` 实统计。

## P2-2 — 生成成功跳转「本次任务」日记

文件：`miniprogram/pages/generation/index.ts`

- `navigateToDiaryDetail` 优先用 `this.data.jobId`（**日记 id == job_id**，见 `/diaries/{job_id}` 契约），先 `getDiaryDetail(jobId)` 校验存在，成功即 `redirectTo /pages/diary/index?id=jobId`。
- 仅当拿不到 / 校验失败时回退到 `listDiaries()[0]` 最新一篇，并 `console.warn`。

## P3 — 文案与颜色

- `miniprogram/utils/api.ts`：超时文案「稍后到书查看」→「可稍后到书架查看」。
- `miniprogram/pages/calendar/index.wxss`：`mood-blue` 由 `#EEF2F6/#6C829E` 收束为奶油/暖灰 `#F6F0E6/#7A6F64`（贴合品牌体系，避免偏蓝）。

---

## 测试

执行（后端 venv，cwd=`/workspace`）：
```bash
/workspace/voonie/backend/.venv/bin/python -m pytest voonie/backend/tests/test_wechat_auth.py -q
# → 5 passed（修复了 1 个引用不存在 fixture `auth_client` 的用例）

/workspace/voonie/backend/.venv/bin/python -m pytest voonie/backend/tests/ -q
# → 105 passed
```

- **test_wechat_auth.py**：修复 `test_wechat_login_not_configured_returns_clear_error`（原引用 `tests/test_auth.py` 的 `auth_client` fixture 导致 error）。改为自建 app（`configure_wechat=False` 使 `WECHAT_MINI_*` 留空），断言 `503 wechat_not_configured`。`_build_app` 增加 `filter` `configure_wechat` 参数。
- 全量：105 passed（含 auth、auth.wechat、diary、pet、entry/job 等）；`companion_days` 新增字段未破坏既有 `UserResponse` 断言。
- alembic：本地 sqlite `alembic upgrade head` 升至 `20260905_0010`（wechat_openid/unionid）通过，无冲突。

前端静态校验（无 tsc，作语法/结构检查）：
- `calendar/profile/generation/api.ts` 的括号/花括号/*中括号均平衡。
- `calendar/index.wxml` 标签闭合（view 30/30、text 29/29、block 2/2、scroll-view 1/1、image 自闭合）。

## 验证摘要
- [x] 日历年月真实，可切换（含占位），`hasDiary` 来自 `listDiaries` 聚合（非硬编码）
- [x] 点击日期进入对应日记（同日多篇取最新）
- [x] 去除了日历 `onShow` 对子页调用 `setSelected`
- [x] `GET /auth/me` 返回 `companion_days`
- [x] profile 不再写死 28/12，回退/统计逻辑真实
- [x] 生成成功跳「本次任务」日记（id==job_id），失败退最新并 warn
- [x] 修正文案「书架」
- [x] `pytest tests/test_wechat_auth.py` 5 passed；全量 `tests/` 105 passed

## 不做项（按 brief）
- 真实 AppID / 填 Secret（运维项，需 `project.config.json` 换真实 appid + 后端 `.env` 配 `WECHAT_MINI_*`）
- UGC 广场真接口、Apple 真登录
- 大范围视觉翻修、`git push`

## 遗留/可选
- 同日多篇日记当前打开最新；如后续需要可改为日期卡片列表再选，属体验优化非缺陷。