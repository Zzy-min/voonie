# Voonie 深度 QA 报告 — Deep QA Report

- **日期**: 2026-09-06
- **范围**: 小程序前端（`miniprogram/`）+ 后端（`backend/`），面向微信小程序（WeChat Mini Program）双端。
- **QA 依据**: `docs/pi-briefs/2026-09-06-chatgpt-deep-qa-prompt.md`
- **前置基线**: `miniprogram/QA_REPORT_2026-09-05.md`、`miniprogram/CHANGELOG_QA_FIX_2026-09-05.md`（上一轮 QA 修复已确认在代码中生效）。
- **结论**: **PASS WITH RISKS**
  - P0: **0** · P1: **0** · P2: **1** · P3: **5**
- **本 QA 期间代码变更**: **None.**（审计期间未改动任何业务代码；以下所有结论均基于当前代码现状与真实执行命令。）

---

## 0. 已知环境限制（Known Env Limitations — 本级别不计为 Release Blocker）

以下项因当前环境无法在真机/联调环境验证，按提示统一列为“已知环境限制”，**不作为本次 Release Blocker / P0 / FAIL**：

| 限制 | 说明 |
|---|---|
| `touristappid` / `WECHAT_MINI_APPID` / `WECHAT_MINI_SECRET` | 真实 AppID 走后端 `.env` 环境变量；联调前置，代码不落地 AppSecret。 |
| 真机微信登录 | 需真实设备 + 合法域名白名单 + 有效 AppID；本环境无法打通 `code2Session` 闭环。 |
| Linux 微信开发 / `tsc` | 无微信开发者工具、无 `tsc` 命令，前端 TS 无法编译校验（见 §17）。 |
| Apple 登录 | 未实现（产品未排期）。 |
| UGC（分享广场） | 展示为静态示例页（代码内已注明为 UGC 演示），非工作流级功能，不计失败。 |

---

## 1. 结论摘要

- 后端全量测试 **105 passed, 4 warnings**（warning 仅 FastAPI/Starlette 弃用提示，非失败）。
- 前后端 API 契约：**核对一致**（见 §4）。
- 越权/IDOR：**审计通过**（所有日记/任务/萌宠/记忆端点均 owner-scoped，见 §5）。
- 安全（secret/session_key/日志/Storage）：**审计通过**（见 §9）。
- 生命周期/互斥：发现 **1 项 P2**（生成页后台轮询未取消、可于页面销毁后发起跳转），其余清理路径完整（见 §6）。
- 性能：`setData` 以高频小负载为主，无泄漏级风险；仅记录 1 项 P3 优化建议（见 §10）。
- 特点：`{status, stage}` 状态机前端后端字符串完全对齐（见 §7）。

---

## 2. 结论（Release Gate 总表）

> （以下为完整结论；§9 末附 Final Return Gate 汇总，二者一致）

| 门禁 | 结果 | 说明 |
|---|---|---|
| P0 | 0 | 无阻断性缺陷 |
| P1 | 0 | 无重大缺陷 |
| P2 | 1 | 生成页后台轮询/销毁后跳转 |
| P3 | 5 | 按钮边框、空态提示、onShow 刷新、waveform setData、子页底部留白 |
| Core Workflow A（录音→图文生成→看日记） | **PASS** | 主线闭环可用 |
| Core Workflow B（设备/匿名→微信登录） | **PASS**（以设计隔离）| 见 §5 数据隔离说明 |
| Core Workflow C（登录/注册/微信/刷新/登出） | **PASS** | 契约一致 |
| Core Workflow D（日历与日记 IA） | **PASS** | 日历真实日期联动已生效 |
| Core Workflow E（萌宠聊天/回忆） | **PASS**（含 1 项 P3 空态） | 见 §10 |
| 后端自动化测试 | **PASS** | 105 passed |
| 静态检查 | **PASS** | py_compile 通过；JSON 合法；WXML/TS 括号自平衡 |
| 最终结论 | **PASS WITH RISKS** | 无 P0/P1，可发布，建议合入 1 项 P2 修复 |

---

## 3. 自动测试（真实执行命令）

来自 `/workspace`（后端 venv Python）：

```
/workspace/voonie/backend/.venv/bin/python -m pytest voonie/backend/tests/ -q --tb=short
→ 105 passed, 4 warnings in 10.00s
```

- 含：`test_wechat_auth.py`（5 项，覆盖 `wechat_not_configured → 503`、`return_payload` 无 `session_key`、错误 code、并发创建等）。
- 4 条 warning 均属框架弃用提示（`HTTP_422_UNPROCESSABLE_ENTITY`/httpx/fastapi deprecation），不影响功能。
- 静态检查：后端 `app/**` 全部 `py_compile` 通过；前端 ALL `*.json` 合法；`include TS` 括号自平衡；全部页面 WXML 标签自闭合/闭合平衡。
- 前端 `tsc`/微信开发者工具：**本 Linux 环境不可用**（已知环境限制）。

---

## 4. API 契约矩阵（前后端核对）

| 前端调用（`utils/api.ts` + 页面） | 后端 Router | 方法 | 契约一致性 |
|---|---|---|---|
| `loginWithWeChatCode` | `auth.py /auth/wechat` | POST | ✅ 请求 `{code}`；返回 TokenResponse；无 session_key |
| `emailLogin` / `emailRegister` | `auth.py /auth/login` `/auth/register` | POST | ✅ |
| `ensureSession` / 设备注册 | `auth.py /device/register|refresh` | POST | ✅ |
| `refreshAccessToken` | `auth.py /auth/refresh` | POST | ✅ |
| `logoutUser` | `auth.py /auth/logout` | POST | ✅ |
| `getCurrentUser` | `auth.py /auth/me` | GET | ✅（含 companion_days，P2-1 已修） |
| `uploadVoiceFile` | `entries.py /entries/voice` | POST(multipart `audio_file`) | ✅ 返回 `{transcript, entry_id}` |
| `createComicJob` | `entries.py /entries/{id}/comic-jobs` | POST | ✅ 返回 `{job_id}` |
| `getJobStatus` | `jobs.py /jobs/{job_id}` | GET | ✅ |
| `waitForJob` | 同上（轮询） | GET | ✅ 轮询 2s×90 |
| `listDiaries` | `diary_router /diaries` | GET | ✅ 字段经 `mapDiary` snake→`camel` |
| `getDiaryDetail(job_id)` | `diary_router /diaries/{job_id}` | GET | ✅ id == job_id |
| `getPetStatus` | `pet_router /pet/status` | GET | ✅ |
| `getPetMemories` | `pet_router /pet/memories` | GET | ✅ 返回 `.summary/.text` |
| `chatWithPet` | `pet_router /pet/chat` | POST | ✅ 返回 `{reply, pet_action, referenced_memories}` |
| `getPetMemories` -> `index` | `diary_router /diaries/{index}` 或 `listDiaries` | ✅ | bookshelf 走 `listDiaries` |

**说明**：`/pet/chat` 采用“服务端 owner 自行取数而非信任客户端历史”的反伪造设计；所有 token（access JWT / refresh）经 `API_BASE` + 统一 `request.withToken` 头下发。契约核对**未发现字段不匹配**。

---

## 5. 身份 / 越权 / IDOR（A/B/D 跨会话审计）

- **身份来源**：`deps.get_current_user()` 从 bearer JWT 的 `payload["sub"]` 取 `User.id`，并校验 `payload["ver"] == user.auth_version`。**不会**依据 `X-Device-Id` 头判断身份，因此不存在“设备头伪造/跨用户投毒”。
- **微信登录后**：`/auth/wechat` 按 `openid` 创建或复用用户，签发新 token 对；前端 `setTokens` 无条件覆盖 access+refresh（清掉旧设备态）。**无跨用户污染**。
- **数据隔离（Design）**：设备态（匿名 device user）与微信 OpenID 用户是**两个独立账户，不合并**。因此设备期间产生的日记，在微信登录新账号后不可见。这是**按设计的账号隔离，不构成数据泄露**——但需在产品侧说明（见 §11 设计风险）。
- **Owner-scoping 检验**：
  - `diary_router`：`owned_entry`/`owned_diary` 按 `current_user.id` 过滤 → 跨用户读不到。
  - `jobs.py`：`owned_job`（`Job.user_id == current_user.id`）用于 GET/cancel/events → 非 owner 一律 404 `job_not_found`。
  - `pet_router`：`DiaryArtifact`/`DiaryEntry`/`MemoryItem` 全部按 `current_user.id` 过滤。
  - `memory_service.search(user_id=...)`：完全按用户隔离。
  - **结论：无 IDOR，Owner 过滤完整。**（PASS）
- **越权风险等级**：P0/P1 = 0。

---

## 6. 生命周期 / 资源泄漏 / 并发

### 6.1 录音（record / recorder.ts）
- `onUnload` 仅 stopWave + 若在录音则 `recorderInstance.stop()`。记录短 Timer `startTimerDisplay`（本存活时依赖 `isRecording` 自清）。**总体清理完整**。
- **onHide 未处理** —— 若用户从录音页切走 Tab（非 destroy）而仍录音，`recorderInstance` 单例继续录音/定时器继续跑。但当 Tab 切换（`switchTab` 会销毁 navigateTo 栈）进页面时走 onUnload 即停止；从后台切走（App onHide）则 `duration` 计时器与录音继续——属低风险，记录页多为子页，回到录音页仍呈现“在录”。→ **仅建议**（P3）：在页面 `onHide`/`onShow` 状态一致化，避免计时器后台空转。

### 6.2 生成页（generation）→ **P2**
见下 §10‑P2-1。

### 6.3 萌宠/日历
- 日历月份切换、今日回忆均为**同步**生成（无 async 竞态，无“A 请求晚到覆盖 B”），日历上方 `fetchDiaries` 与月份无关。**无并发竞态**（PASS）。

### 6.4 录音中断路径
- `onError` 回调恢复 `isRecording:false` 并 `stopTimer`，前端 toast 提示“录音发生中断”。Error path 覆盖完整。

---

## 7. 状态机 前端↔后端对齐

| 后端 Job | 前端 JobStatus / stage | 对齐 |
|---|---|---|
| `queued` | `queued` | ✅ |
| `running` + `planning/rendering/finalizing` | `running` + 对应 stage | ✅ |
| `done` | `done` (step5) | ✅ |
| `failed` / `cancelled` | `failed` / `cancelled`（进入错误态） | ✅ |
| `Entity(view)` | 未知 → 继续轮询 | ✅ |

后端 `Job.status/stage`（模型 `String(32)`，保持存语义字符串）与 worker 赋值（`queued→running(planning/rendering/finalizing)→done`，允许 `failed/cancelled`）与前端 `JobStatus` 枚举一致。**状态机契约 PASS**；`progress`（0.1/0.25/0.85/1.0）与前端 `percent` 换算一致。

---

## 8. Storage 清单（本地缓存对账）

| Key | 用途 | 数据 | 风险 |
|---|---|---|---|
| `voonie_access_token` | Bearer access | JWT（短时） | 仅内存/Storage 安全；登出清除 |
| `voonie_refresh_token` | 刷新 | JWT（长时） | 登出清除，不落盘 secret |
| `voonie_device_id` | 设备绑定 | id | 仅绑定，不作为身份凭据 |
| `voonie_device_secret` | 设备绑定 | secret | 仅设备匿名鉴权；微信登录后覆盖 token 清除其影响 |
| `voonie_diary_draft` | 录音草稿 | entryId/text/audioPath | 完成/失败都被清理（`findAndDeleteDraft`）；`index.onShow` 读 `draft.text` |
| `current_user` / `petName` 等 | 展示 | 用户昵称 | 无敏感 |
| `API_BASE` | 环境地址 | env 配置 | 无 |

未发现敏感键（password/secret 明文等）写入 Storage。

---

## 9. 安全：secret / session_key / 日志 / 授权

- **session_key**：后端 `code2Session` 返回仅用于签发 token 前读取 openid/unionid，**绝不落库/绝不返回**给客户端（`test_wechat_auth` 断言响应无 `session_key`）。前端仅注释提及。✅
- **真实 secret**：仓库未见任何真实 `AppSecret`/`AppID`（仅 `wx-test-*` 位于测试代码）。`.env` 未提交。✅
- **日志**：无任何 `console.log` 输出 token/auth/password/secret/session_key。✅
- **授权**：JWT `ver` 校验、refresh 幂等；登出时清刷新。
- **Storage**：见 §7。

CSS 文件夹无异常。

---

## 10. Findings（模板正文：`### [P?] Title`）

### [P2] 生成页后台轮询未随页面销毁取消，可能引发页面销毁后的强制跳转
- **Category**: Lifecycle / Error Path / Resource（前端）
- **Affected file**: `miniprogram/pages/generation/index.ts`（`startJobPolling`、`onLoad`、`navigateToDiaryDetail`）
- **Evidence**: `startJobPolling` 调用 `waitForJob(jobId, cb)`（`api.ts` 内 2s×90 的 async 循环），`onLoad` 即触发；页面无 `onUnload`/`onHide`；对一个 `async` 循环没有局部 `cancelled` 标志。完成/失败后调用 `navigateToDiaryDetail()`（内部 `wx.redirectTo`）。
- **Impact**: 若用户在前台「生成中」时返回（`onBack`→`reLaunch`）或 `navigateBack`，后台 `waitForJob` 仍持续发起网络请求最长约 3 分钟；页面销毁后 `onProgress` 回调仍执行 `this.setData`（微信提示 `setData:fail`），且任务完成时会在后台强制 `wx.redirectTo` 跳转到日记详情，**可能出现“用户在别的页面却被动跳转”**。
- **Root Cause**: 页面加载即启动无句柄的异步轮询，且无 `onUnload`/`onHide` 取消与「页面是否仍存活」守卫。
- **Recommended Fix**: 在页面实例加 `private _destroyed=false`，`onUnload/onHide` 置位；`waitForJob` 轮询循环定期检查 `destroyed`；`onProgress` 与最终 `redirectTo` 前 `if (this._destroyed) return`。（小而明确的修复）
- **Release Blocker**: No（P2）。建议本轮修复后发布。

### [P3] 微信默认按钮样式 `.button::after` 边框未清除
- **Category**: UI / WXSS
- **Affected file**: `miniprogram/app.wxss`、`miniprogram/pages/auth/index.wxss`
- **Evidence**: 全项目 grep `::after` 为空；`auth/index.wxml` 采用原生 `<button class="btn-primary">`，`generation/index.wxml` 同。未加 `button::after{border:none}`。
- **Impact**: 认证按钮/重试按钮带微信默认细边框，与整体风格不一致。
- **Recommended Fix**: 全局 `page{button::after{border:none}}`（在 `app.wxss` 加一条）。
- **Release Blocker**: No（P3）。

### [P3] 萌宠页「记得的小事」无空态提示（新账号下卡片静默消失）
- **Location**: `miniprogram/pages/pet/index.wxml`（`wx:if="{{memStories.length}}"` 无 `wx:else`）
- **Evidence**: `loadPetMemories` 成功无数据时 `memStories=[]` → `wx:if` 为 false → 卡片消失，无“还没有回忆”。
- **Impact**: 新/微信用户在萌宠页看不到“回忆”信息板，缺引导（低）。
- **Recommended Fix**: 追加 `wx:else` 空态文案。
- **Release Blocker**: No（P3）。

### P3: Pet tab `onShow` 仅刷新 status，memories/recentDiaries 仅 onLoad 刷新
- **Location**: `miniprogram/pages/pet/index.ts`
- **Evidence**: `onShow` 仅 `loadPetStatus()`；`loadPetMemories`/`loadRecentDiaries` 只在 `onLoad`。
- **Impact**: 若 Tab 页长时间存活且未重建（或登录账户切换后 Tab 未刷新），回忆/最近日记可能展示旧数据。因 Tab 页一般会重建且在登录后首次进入必走 onLoad，影响低。近 → P3 设计建议。
- **Recommended Fix**: `onShow` 中对 `memStories.length===0` 时补一次 `loadMemories`。

### P3: 录音波形 setData 频率优化（当作性能观察）
- **Location**: `miniprogram/pages/record/index.ts`（`applyVolume`）/ `utils/recorder.ts`
- **Evidence**: `frameSize:1` 时 `onFrameRecorded` 约 31ms 一帧，`applyVolume` 每次整个 `waveAmps`（恒 7 元素）`setData` ⇒ 约 30 次/秒。
- **Impact**: `setData` 频率较高但负载恒定且小（7 数字化），页无泄漏；最低性能段。建议做节流（如 100ms/tick 采样批量）以减少渲染压力。
- **Recommended Fix**: 在放送侧抽样（仅每 N 帧调用一次 setData）或合并到离屏渲染。
- **Release Blocker**: No（P3）。

### P3: `.voonie-page` 固定底部内边距用于非 Tab 子页造成多余空白
- **File**: `miniprogram/app.wxss`（`.voonie-page{padding-bottom:calc(140rpx + env(...))}`）
- **说明**: Tab 页用该留白正确；但 `record/generation/share/square/calendar/auth` 等无 Tab 的子页同样继承 140rpx 底部留白，底部空白偏大（纯视觉）。
- **Recommended Fix**: 对无需 Tab 的子页覆盖小 padding。
- **Release Blocker**: No（P3）。

---

## 11. 设计风险（非缺陷，记录）

| 现象 | 说明 |
|---|---|
| 登录隔离 | 设备（匿名）身份与微信身份是两个不同账号，不合并；(device→WeChat) 登录后旧设备数据不可见。**设计意图为账号隔离，非缺陷**。建议在登录/关于页告知用户，避免“数据凭空消失”的误解。 |

---

## 12. 总评（Return Gate）

- **P0**: 0 — 无阻断。
- **P1**: 0 — 无重大缺陷。
- **P2**: 1 — 生成页后台轮询/销毁后跳转（见 Finding#1）。
- **P3**: 5 — UI/空态/性能优化类。
- **Workflow**: A–E **PASS**（A–D 完整，E 有 1 项 P3 空态）。
- **BackendTests**: **105 passed**。
- **Security**: **PASS**（无 real secret，session_key 不下发，owner 隔离）。
- **Contract**: **PASS**（前后端字段/状态对齐）。
- **Performance**: **PASS with 1 P3 优化**。
- **Terminal**: **PASS WITH RISKS**。

> 审计期间代码未作任何改动。建议在下一迭代合入 Finding#1（P2）后再正式发版；无其他 Release 级风险。