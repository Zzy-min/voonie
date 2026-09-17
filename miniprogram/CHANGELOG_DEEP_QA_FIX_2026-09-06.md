# CHANGELOG — Deep QA P2 + P3 修复

日期：2026-09-06
依据：`docs/pi-briefs/2026-09-06-deep-qa-p2-p3-fix.md`、`miniprogram/QA_REPORT_DEEP_2026-09-06.md`
范围：`miniprogram/`（P2 改动含 `utils/api.ts`）
本轮只做明确小修，不重构、不改产品逻辑、不写密钥、未 git push。

---

## P2（必须）

### P2-1 生成页轮询随页面销毁取消，禁止销毁后 redirect
**文件**: `miniprogram/utils/api.ts`、`miniprogram/pages/generation/index.ts`

- `utils/api.ts`
  - `waitForJob(jobId, onProgress?, shouldContinue?)`：新增可选 `shouldContinue?: () => boolean`；
    - 每轮循环前、请求返回后均检查 `shouldContinue`，为 `false` 时抛出专用 `JobCanceledError`（静默取消，不触发 `failed` toast）。
    - `getJobStatus` 请求 `catch` 中若已被取消则改抛 `JobCanceledError`，避免在页面销毁后把网络错误当成任务失败。
  - 新增 `export class JobCanceledError extends Error`（`name = "JobCanceledError"`）。
- `miniprogram/pages/generation/index.ts`
  - 新增页面实例标志 `_destroyed`、`_pollingActive`、`_cancelToken`。
  - `onUnload`：置 `_destroyed = _cancelToken = true` → 页面被 `navigateBack/reLaunch/redirectTo` 销毁后，后台 `waitForJob` 立即静默退出。
  - `startJobPolling`：
    - 以 `() => !this._destroyed && !this._cancelToken` 作为 `shouldContinue` 传入；
    - `onProgress` 内先 `if (this._destroyed || this._cancelToken) return`，销毁后不再 `setData`；
    - 完成回调与 `setTimeout` 内 `navigateToDiaryDetail` 前均加 `if (this._destroyed || this._cancelToken) return`；
    - `catch` 中对 `JobCanceledError` / `/销毁` 静默退出，不 toast「失败」；
    - `finally` 释放 `_pollingActive`，并用 `_pollingActive`/`_cancelToken` 防重试时出现双轮询。

**验收**: 用户在生成中离开页面 → 不再后台强制跳日记；留在页内完成 → 仍正常跳本次 `jobId` 日记。

---

## P3

### P3-1 全局清除微信按钮默认边框
**文件**: `miniprogram/app.wxss`
在盒模型统一规则后新增：
```
button { padding: 0; margin: 0; background: transparent; line-height: inherit; }
button::after { border: none; }
```
（`.btn-primary` 等类选择器仍在原处声明背景/色值，优先级高于元素选择器，不受影响。）

### P3-2 萌宠「记得的小事」空态
**文件**: `miniprogram/pages/pet/index.wxml`、`miniprogram/pages/pet/index.wxss`
在 `wx:if="{{memStories.length}}"` 的卡片旁直接加同层级 `wx:else` 空态卡片 `memories-empty`，文案：「还没有存下的小回忆～多聊聊天，就能慢慢记住你啦 🐾」，并补充 `memories-empty-body` 样式。

### P3-3 萌宠 `onShow` 空回忆时补拉
**文件**: `miniprogram/pages/pet/index.ts`
`onShow` 在既有 `loadPetStatus()` 之外，当 `memStories` 为空时补一次 `loadPetMemories()`，避免 Tab 常驻 / 跨账号切换后展示旧或空数据。

### P3-4 录音波形 `setData` 节流
**文件**: `miniprogram/pages/record/index.ts`
`applyVolume` 内新增节流：距上次 `setData` 不足 110ms 则跳过视图更新（新增 `_lastWaveSetDataAt` 字段）。帧回调仍计算 `lastRealFrameAt` 以驱动回退逻辑，但渲染降频（约 9 帧/秒），降低高频 `setData` 压力，保持真波形观感。

### P3-5 非 Tab 子页底部留白收敛
**文件**: `miniprogram/pages/calendar/index.wxml`、`miniprogram/pages/square/index.wxml`
把 `voonie-page` 新增 `voonie-page--no-tab`，使这两个子页改用 `padding-bottom: env(safe-area-inset-bottom)`（原先继承了 Tab 页的 `calc(140rpx + env(...))`）。
说明：`record/generation/auth/share/diary` 已带 `--no-tab`；`index/diary-home/pet/profile/bookshelf` 为 Tab 页，保留 `calc(140rpx + env(...))` 以避开心型自定义 Tab 栏。

---

## 测试 / 校验

- 后端：`/workspace/voonie/backend/.venv/bin/python -m pytest voonie/backend/tests/test_wechat_auth.py -q` → **5 passed**（本轮纯前端，确认未误伤）。
- 静态：变更后的 `utils/api.ts`、`generation/record/pet/index.ts` 花括号自平衡；`pet/calendar/square/generation` WXML 标签闭合平衡。
- 未运行 `tsc` / 微信开发者工具（Linux 环境不可用，属已知环境限制）。

## P2 补丁：pollGen（重试防双轮询）

**日期**: 2026-09-06
**文件**: `miniprogram/pages/generation/index.ts`（依据 `docs/pi-briefs/2026-09-06-generation-pollgen.md`）

### 背景
上轮 P2 用 `_destroyed`/`_cancelToken` 在重试时“先置 `_destroyed=true` 再立刻清回 `false` 来杀旧轮”，存在竞态：旧轮 `shouldContinue` 可能看不到那次取消窗口 → 仍可能双轮询。

### 改动
- 以**单调递增代数 `_pollGen`** 取代「用 `_destroyed` 杀旧轮再翻回 false」的写法：
  - `startJobPolling` 开头捕获本轮代数：`const jobId = ...; const gen = ++this._pollGen;`
  - `shouldContinue`: `() => !this._destroyed && this._pollGen === gen`
  - `onProgress` / 完成 `setData` / `setTimeout` 跳转前 / `catch` 均校验 `this._destroyed || this._pollGen !== gen`（仅当前代且页面存活才推进界面 / 跳转）
- `onUnload`：置 `_destroyed = true` 并 `++_pollGen`，使所有在途轮询代数失效并静默退出（遗留 `_cancelToken` 由 `_pollGen` 取代）。
- 删除 `_pollingActive`/`_cancelToken` 字段与“重试先置 true 再清 false”逻辑；离开页面语义（`_destroyed`）与重试语义（`_pollGen` 代数）分离。

### 验收
- 留在页内完成 → 仍正常跳本次 `jobId` 日记。
- 离开页面 → 不 redirect、不 toast 取消。
- 快速重试 → 旧轮代数失效，不再双轮询。

## 未做
- 未改后端；未 git push；未写任何 secret / AppID / AppSecret。
- 未处理联调前置（AppID / 真机 / UGC / Apple）与大规模视觉改版。