# CHANGELOG — 小程序联调后端 API

日期：2026-09-05
范围：`miniprogram/utils/api.ts` 契约对齐 + 各页面接入真实数据
依据：`docs/pi-briefs/2026-09-05-api-integration.md`、`backend/app/api/routers/*`、`backend/app/routers/*`、`backend/tests/test_*.py`

---

## 一、改掉的端点（路径 × 载荷）

| 之前（错，已移除） | 现在（对） | 说明 |
| --- | --- | --- |
| `POST /api/v1/auth/bootstrap` | `POST /api/v1/auth/device` | 字段对齐测试 `DeviceAuthRequest`：`device_id`(≥8字)、`app_version`、可选 `device_secret` |
| `POST /api/v1/characters/dialogue` | `POST /api/v1/pet/chat` | 请求体 `{ message, pet_name?, pet_type?, history? }`；按 `PetChatResponse` 返回 `{ reply, pet_action, referenced_memories }` |
| `GET /api/v1/artifacts/diaries` | `GET /api/v1/diaries` | 返回 `list[ComicGenerationResponse]` → 经 `mapDiary()` 映射为 `DiaryItem` |
| `GET/DELETE /api/v1/artifacts/diaries/{id}` | `GET/DELETE /api/v1/diaries/{id}` | id 为 job_id |
| `POST /api/v1/entries` | `POST /api/v1/entries/text` | 结构 `{ local_id, text, entry_date(带UTC偏移), timezone }` + `Idempotency-Key` 头 |
| `wx.uploadFile …/entries/transcribe` | `wx.uploadFile …/entries/voice` | multipart：文件字段名 `audio_file`；form 字段 `local_id`、`entry_date`、`timezone`；`Idempotency-Key` 头；响应取 `redacted_text`/`id` |
| `POST /api/v1/entries/{id}/process` | `POST /api/v1/entries/{id}/comic-jobs` | 返回 `{ job_id, status }`（202） |
| job 轮询 `GET /api/v1/jobs/{id}`（保留） | 同上 | 状态枚举改为后端真实值：`queued → running → done / failed / cancelled`；`stage`: `planning → rendering → finalizing → done`；`progress` 为 0~1 |

**已删除的错误端点调用**（需求验收标准 1 全部满足）：
- `auth/bootstrap` ✅ 去除
- `artifacts/diaries` ✅ 去除
- `characters/dialogue` ✅ 去除
- `entries/transcribe` ✅ 去除
- `entries/{id}/process` ✅ 去除

---

## 二、`api.ts` 结构性改动

1. **`API_BASE` 可切换**：新增 `getApiBase()` / `setApiBase()`，默认 `https://vonnie.xyz`，可用本地存储键 **`voonie_api_base`** 覆盖（开发者工具在控制台 `wx.setStorageSync('voonie_api_base','http://127.0.0.1:8000')` 即可指向局域网后端）。`app.ts` 启动时读取并沿用。
2. **`ensureSession`**：无 token 时走 `/auth/device`；成功写入 access/refresh，并存 `device_secret`（后端要求已注册设备的安装证明）。若 `401 device_proof_required`（本地 secret 缺失），自动重发新 device_id 再注册一次。
3. **`login/register/refresh` 字段与后端对齐**：
   - `loginUser`: `{ email, password }`
   - `registerUser`: `{ email, password, confirm_password?, nickname }`
   - `refresh`: `{ refresh_token }`
   - 均写入 `access_token`/`refresh_token`。
4. **统一错误**：`request()` 在 401 时自动走 refresh+重试；刷新失败则清 token 并抛 `ApiError(401)`（页面引导登录）。网络异常抛 `network_error`，各页面上 toast。
5. **契约适配层**：`mapDiary(RawComicDiary) → DiaryItem`，页面统一吃 `DiaryItem`，不再直接消费原始 JSON。`JobStatus` 界面已按后端 `JobStatusResponse` 重写（`job_id/status/stage/progress/…`）。

---

## 三、页面接入真实数据（P0）

| 页面 | 改动 |
| --- | --- |
| `auth` | 登录/注册成功 → `switchTab` 首页；快捷登录走 `ensureSession`（device）；Apple 登录仍为占位提示 |
| `app.ts` | 启动自定义 `voonie_api_base`，并调用 `initSession → ensureSession` |
| `record` | 录音结束 → `uploadVoiceFile`（/entries/voice）→ 存草稿 → `createComicJob`（/comic-jobs）→ 跳转 generation（传 `job_id`） |
| `generation` | 真实轮询 `stage/progress/status`（`done`）驱动进度；失败不再静默处理，展示「失败可重试」错误态；去掉模拟步进 |
| `calendar` / `bookshelf` | 列表来自 `listDiaries`；空态友好；失败展示重试按钮（不再回填假数据） |
| `diary` | 详情来自 `getDiaryDetail`/`listDiaries`；加载态/失败可重试/空态均已处理；去掉 `DEMO_DIARY` 兜底 |
| `pet` | 聊天走 `/pet/chat`，显示 `reply`；最近回忆来自 `listDiaries` |
| `profile` | 用户信息来自 `/auth/me`，日记/绘本计数来自 `listDiaries` |
| `share` | 公开/私密为本地标记 + `TODO` 注释（后端暂无发布字段，不静默假成功）；本地留存 `voonie_local_shares` |

---

## 四、验证方法（微信开发者工具）

1. **配置合法域名 / 不校验校验域名（本地联调）**：
   - 工具右上角「详情 → 本地设置」勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。
   - 生产环境请在小程序后台「开发管理 → 服务器域名」添加：`https://vonnie.xyz`（request / uploadFile）。
2. **指向本地后端（可选）**：控制台执行
   ```
   wx.setStorageSync('voonie_api_base', 'http://127.0.0.1:8000')
   ```
   后台 `uvicorn voonie.backend.app.main:app --reload` 启动即会自动带上 `/api/v1` 前缀；回生产删除该 key 即可。
3. **冷启动会话**：启动 App → `ensureSession` 命中 `POST /auth/device`，应返回 `access_token`（控制台 Network 面板可见，200/201）。
4. **注册 / 登录链路**：注册（邮箱+密码，≥6 位）→ 得 access/refresh → 跳首页。再用同邮箱登录。
5. **录音→任务→日记**：`record` 页录音 ≥2 秒 → 停止 → 上传 `/entries/voice`（转写）→ 创建 `/comic-jobs`（得 job_id）→ `generation` 页轮询 `/jobs/{job_id}` → `stage/status` 推进到 `done` → 跳转 `diary?id={job_id}`。
6. **萌宠聊天**：`pet` 页发消息 → `POST /pet/chat` 返回 `reply`。

---

## 五、已知限制 / TODO

- **分享广场 UGC**：后端暂无公开投稿/广场接口。`share` 页目前为本地标记（`voonie_local_shares`）+ TODO；`square` 页为 UI 原型展示，未接入生产 UGC 数据。
- **Apple 登录**：仍为占位 `onAppleLogin`。（后端也尚未提供 Apple 认证端点。）
- **`GET /pet/status` / `GET /pet/memories`**：已暴露在 `api.ts`，但当前 `pet` 页面未强消费（保留字段可用）。
- **`job_id` 与 `entry_id` 语义**：日记详情页直接用 `job_id` 作为 `/diaries/{id}` 的 id（后端 `GET /diaries` 以 `Job.id` 为 key）。
- **记忆标记**：后端 `memory_opt_in` 默认为开；如关闭将看不到近期日记上下文，属预期行为。
- **`voonie_local_shares` 仅本地**：不冒充已发布到生产。

---

## 六、验收对照

- [x] `api.ts` 不再调用 404/错误路径（bootstrap/artifacts/diaries/characters/dialogue/entries/transcribe/entries/{id}/process）。
- [x] 冷启动 `ensureSession（device）` 可拿 token（生产/可配 base）。
- [x] 登录/注册/refresh 字段与 `TokenResponse` 对齐。
- [x] 录音 → /entries/voice → /comic-jobs → /jobs 轮询 → `done` → 跳转日记，代码路径闭合；generation 使用真实 job status/stage。
- [x] 萌宠聊天走 `/pet/chat`。
- [x] changelog 存在且可核对。