# Voonie 后端开发计划

> **范围：** 把现有 FastAPI 原型升级为可支撑 Flutter / Web 的生产级语音漫画日记后端。
> **日期：** 2026-08-27
> **前置材料：** 当前仓库 `voonie/backend`、`voonie/app`、公开 GitHub 案例。飞书需求文档本次未能读取（`lark-cli` 未绑定）。X 搜索接口本次不可用，社区实践改用 GitHub / Reddit / 技术文档交叉验证。

## 1. 目标

后端不再在一次 HTTP 请求里同步跑完整语音到漫画流水线，也不再把日记正文长期堆在进程内存里。它只负责四件事：

1. 接收脱敏后的语音/文本，异步生成四格漫画。
2. 用角色圣经和参考图保证跨格角色一致。
3. 在用户授权范围内检索记忆，让宠物助手能回答“上周发生了什么”。
4. 对心理陪伴做安全护栏，不把日记当云端原文仓库。

**成功标准：**

- Flutter 现有契约不破：`/api/v1/diaries/text-generate`、`/voice-generate`、`/pet/chat` 继续可用，同时新增 job 接口。
- 无 API Key 时测试仍绿；有真实模型时流水线能产出 4 张图和合成长图。
- 进程重启后日记任务、角色设定、媒体 URL 不丢。
- 生成耗时从“请求卡住 30-90s”变成“立即返回 `job_id`，10-60s 内可轮询/SSE 完成”。
- 默认不在服务端持久化原文日记；若用户开启云端记忆，必须按 `user_id` 隔离。

## 2. 现有代码审计

| 模块 | 现状 | 风险 |
|---|---|---|
| `diary_router.py` | `_DIARY_STORE` 进程内存列表；voice/text 同步 `asyncio.gather` 生图 | 重启丢失；请求超时；无法重试单格 |
| `memory_service.py` | 64 维字符哈希 + 预填 3 条演示记忆 | 不是语义检索；全用户共享 |
| `asr_service.py` / `image_gen_service.py` / `storyboard_agent.py` | 无 Key 直接 mock；失败静默 fallback | 测试全绿但产品是假流水线 |
| `storage_service.py` | 本地 `temp_media`，TTL=1h，但没有定时清理 | 磁盘泄漏；URL 写死 `localhost:8000` |
| `main.py` | `CORS *` + `allow_credentials=True`；静态站和 API 混部 | 浏览器凭证组合非法；职责不清 |
| 鉴权 | 无用户、无设备、无配额 | 任何人可刷生图 |
| Flutter | `api_service.dart` 打 `localhost:8000`，`start_voonie.bat` 起 `8088` | 联调端口不一致 |
| 隐私 | 仅端侧手机号/身份证/邮箱替换 | 语音原文仍可能进云端 LLM |

现有 6 个 pytest 全部通过，是因为 mock 路径被当成主路径。后端开发的第一原则：测试必须能区分 mock 模式和真实供应商模式。

## 3. 产品需求（从现有客户端反推）

核心卖点已经写进 Flutter 模型和 Web 原型：

1. **语音日记到四格连环画**：起承转合、旁白、气泡、拟声词、情绪分、宠物便签。
2. **小宠物助手**：共情回复 + 引用历史日记；端侧可先检索再把摘要塞进 `local_memory_context`。
3. **本地优先**：`LocalDbService` 把日记存在 SQLite；`PrivacySecurityService` 在上传前脱敏。

因此后端的正确角色是 Generation + Companion Service，不是 Day One 式云端原文库。

不要做：

- 把完整语音文件和日记原文默认永久存云。
- 在宠物回复里做临床诊断或危机干预替代品。
- 第一期上计费/社交/多宠物养成。

## 4. 成熟案例与取舍

### 4.1 语音日记 / 记忆

- [MemoDiary](https://github.com/vijaytheegala/MemoDiary)：FastAPI + SQLite；对话生成和记忆抽取解耦；意图路由把闲聊和“个人回忆”分开；SSE 流式回复。直接采用：意图路由、后台抽取、SSE。不采用：把全部记忆默认放服务端。
- [WhisperJournal](https://github.com/kaisoapbox/WhisperJournal) / [Witness](https://github.com/SpaseCases/Witness)：语音转写本地化。Voonie 一期仍用云端 Whisper 兼容 API，但接口要能替换为 faster-whisper。
- Day One 用户对云端 AI 读日记非常敏感。Voonie 必须把“云端记忆”做成显式开关。

### 4.2 漫画生成 / 角色一致

- [Comic Studio AI](https://github.com/RobinaMirbahar/Comic-Studio-Ai)：FastAPI 多 Agent（研究到剧本到分镜到对白到生图）；角色描述注入每格 prompt；语音输入；4 格约 3s 文案 + 每格 5-8s 出图。直接采用：Agent 链、角色圣经、分步 API。
- [eerie / story-to-comic](https://github.com/beysa/eerie)：先生成一张角色参考图，再用 IP-Adapter 约束后续 4 格。纯 prompt 会漂。二期采用参考图；一期先落地结构化角色圣经。
- [Comic-drama](https://github.com/tccnnd/Comic-drama)：脚本到分镜到角色资产到 provider 路由到人工重渲。采用 job + 单格重渲 + provider 可替换，不在一期做视频。
- [AI Comic Factory](https://github.com/jbilcke-hf/ai-comic-factory)：LLM 和渲染引擎可插拔。Voonie 的 `LLMProvider` / `ImageProvider` 必须同样可换。

社区共识（ComfyUI / Reddit，非 X 原始帖；X 接口本次失败）：角色漂移是架构问题，不是再写一句 prompt 能解决的。参考图或 LoRA 才是硬约束。

### 4.3 宠物陪伴

- [AI-Desktop-Pet](https://github.com/ZiyueWang1/AI-Desktop-Pet)：短期 20 条对话 + Chroma 长期记忆；用户画像后台抽取；多供应商；Mock AI 方便测试。直接采用双层记忆和 Mock Provider。

### 4.4 任务队列

- [fastapi-arq](https://github.com/davidmuraya/fastapi-arq) 与 FastAPI 社区实践：生图这种 30s+ 任务必须出进程；`BackgroundTasks` 重启即丢。采用 ARQ + Redis；job 状态同时落库。
- ComfyUI 生产栈经验：FastAPI 只做 dispatch/status，GPU/模型调用进 worker。

## 5. 推荐架构

```text
Flutter / Web
  |  JWT(device) + local SQLite as source of truth
  v
FastAPI  (thin HTTP)
  |- /auth            设备注册、刷新
  |- /diaries         创建 job / 兼容同步生成
  |- /jobs            状态、SSE、单格重渲
  |- /characters      角色圣经 + 参考图
  |- /pet             聊天、记忆检索（可选云端）
  |- /media           签名短时 URL
        |
        v
ARQ worker
  ASR -> Storyboard -> 4x ImageGen -> Composer -> MemoryExtract(opt)
        |
        v
Postgres     Redis        Object storage
jobs/users   queue/SSE    panels + comics (TTL or user-owned)
characters
memory_items (opt-in)
```

**隐私默认值：**

- 请求体只接受端侧已脱敏文本。
- 语音文件在 ASR 完成后立即删除。
- 漫画图默认 7 天过期；客户端下载后写入本地沙盒。
- `local_memory_context` 优先；服务端记忆库默认关闭。

## 6. 技术栈

| 层 | 选择 | 原因 |
|---|---|---|
| API | FastAPI + Pydantic v2 + uvicorn | 已有代码，Flutter 已对接 |
| DB | SQLAlchemy 2 async + Postgres（本地可 SQLite） | job/用户必须持久化 |
| Queue | ARQ + Redis | 原生 async，适合 httpx 生图 |
| Storage | 本地盘到 S3 兼容 | 先本地，接口用 `StorageBackend` |
| ASR | OpenAI Whisper 兼容，可换 faster-whisper | 现有 `asr_service` 可适配 |
| LLM | OpenAI 兼容 `chat/completions` + `json_object` | 现有 agent 已按此写 |
| Image | DALL-E / Flux / Gemini image / ComfyUI | Provider 抽象 |
| Embeddings | 一期 BM25 + pgvector；二期 sentence-transformers | 不要继续用 64 维哈希 |
| Auth | 设备 JWT（无密码） | 日记 App 比邮箱登录更顺 |
| Test | pytest + httpx + fakeredis + provider stubs | 真实供应商测试用 marker |

本地开发可用 SQLite + 内存队列（`ARQ_INLINE=1`），但代码路径必须与 Redis 模式相同。

## 7. 目标目录

```text
voonie/backend/
  app/
    main.py                 # create_app + lifespan
    core/
      config.py             # Settings, 禁止 CORS*+credentials
      security.py           # JWT
      exceptions.py
    db/
      session.py
      models.py             # User, Job, DiaryArtifact, Character, MemoryItem
      migrations/
    api/
      deps.py
      routers/
        auth.py
        diaries.py
        jobs.py
        characters.py
        pet.py
        health.py
    schemas/
    services/
      asr.py
      storyboard.py
      image_gen.py
      composer.py
      memory.py
      pet.py
      character_bible.py
      storage.py
    providers/
      llm.py
      asr.py
      image.py
      embeddings.py
    workers/
      comic_job.py
      cleanup.py
    tests/
```

现有 `voonie.backend.app...` 导入路径先保留，避免 Flutter/Web 联调中断；迁移时用薄封装转发。

## 8. API 契约

### 8.1 兼容层（第一周必须保住）

```http
POST /api/v1/diaries/text-generate
POST /api/v1/diaries/voice-generate
GET  /api/v1/diaries
POST /api/v1/pet/chat
GET  /api/v1/pet/status
GET  /api/v1/pet/memories
GET  /health
```

兼容层内部改为：创建 job，然后等待（仅当 `sync=true` 或旧客户端），再返回旧 `ComicGenerationResponse`。新客户端传 `Prefer: respond-async`。

### 8.2 新契约

```http
POST /api/v1/auth/device
  { "device_id": "uuid", "app_version": "1.0.0" }
  -> { access_token, refresh_token, user_id }

POST /api/v1/characters
  { character_name, appearance_prompt, style_preset, reference_image? }
  -> Character

POST /api/v1/jobs/comic
  multipart: audio? | json text, character_id, style_preset
  -> { job_id, status: queued }

GET  /api/v1/jobs/{job_id}
  -> { status, stage, progress, error, result }

GET  /api/v1/jobs/{job_id}/events     # SSE: asr | storyboard | panel:1-4 | compose | done | error

POST /api/v1/jobs/{job_id}/panels/{n}/retry

POST /api/v1/pet/chat                 # 增加 stream=true
GET  /api/v1/pet/memories?q=&from=&to=&emotion=
```

Job `stage` 枚举：`queued | transcribing | planning | rendering | composing | extracting_memory | done | failed`。

`ComicGenerationResponse` 增补（旧字段保留）：

```python
class ComicGenerationResponse(BaseModel):
    task_id: str
    job_id: str
    title: str
    raw_transcript: str | None = None   # 默认不回传给非创建者
    emotion: EmotionSummary
    panels: list[ComicPanel]
    composite_comic_url: str | None
    companion_note: str
    created_at: str
    character_id: str | None = None
    expires_at: str | None = None
```

## 9. 数据模型

```sql
users(id, device_id UNIQUE, created_at, memory_opt_in BOOLEAN DEFAULT FALSE)
refresh_tokens(id, user_id, hashed_token, expires_at)
characters(
  id, user_id, name, appearance_prompt, style_preset,
  bible_json, reference_image_key, seed, created_at
)
jobs(
  id, user_id, type, status, stage, progress,
  request_json, result_json, error, idempotency_key,
  created_at, updated_at, finished_at
)
diary_artifacts(
  id, user_id, job_id, title, emotion_label, mood_score,
  transcript_redacted, companion_note,
  composite_key, panel_keys_json, created_at, expires_at
)
memory_items(
  id, user_id, artifact_id, happened_on, title, summary,
  emotion, mood_score, embedding VECTOR, tags_json
)
pet_sessions(id, user_id, messages_json, updated_at)
```

`idempotency_key` 防 Flutter 重试重复生图。

## 10. 流水线设计

Worker `generate_comic_job(job_id)`：

1. ASR 音频到文本。失败可重试 2 次。成功后删音频。
2. PII gate 再跑一遍服务端脱敏（手机/证件/邮箱/住址粗规则）。
3. Storyboard Agent 输出严格 JSON：title, emotion, 4 panels, companion_note, character_bible_delta。
4. Character Bible merge：把本篇外貌变化写回 `characters.bible_json`，但发型/衣服当日可变、脸和体型锁死。
5. Image gen 乘 4，每格独立重试；prompt 必须包含锁定外貌段落、`no text, no letters, no speech bubbles`、景别 + 动作 + 场景、`character_ref`（二期）。
6. Composer 在图外叠旁白/气泡/SFX/标题/便签。不要让模型在图里写字。
7. 可选 MemoryExtract：仅 `memory_opt_in=true` 时，后台再调一次 LLM，写入 `memory_items`（summary 不超过 80 字，不含原文）。
8. 更新 job=`done`，发 SSE。

宠物聊天：

1. Fast-router：问候/无内容走模板回复，不花 token。
2. 若消息含时间/事件词则检索。优先 `local_memory_context`，否则（opt-in）查 `memory_items`。
3. LLM JSON：`reply, pet_action, referenced_memories`。
4. 安全：自伤/他伤关键词走固定求助文案，不继续共情角色扮演。

## 11. 分阶段任务

每阶段独立可测，不把“以后再补错误处理”留给执行者。

### Task 1: 应用骨架与配置

**Files:** `app/main.py`, `app/core/config.py`, `app/core/exceptions.py`, `app/api/routers/health.py`

- Settings 用 `pydantic-settings`：`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `MEDIA_PUBLIC_BASE`, `MEMORY_OPT_IN_DEFAULT=false`。
- `create_app()` + lifespan：DB engine、httpx client、storage。
- CORS 只允许配置的 origin；禁止 `*` + credentials。
- `/health` 检查 DB；`/health/ready` 检查 Redis（inline 模式跳过）。

验收：`pytest tests/test_health.py`；无 Redis 时 ready 返回 503 而不是假 200。

### Task 2: 数据库与迁移

**Files:** `app/db/models.py`, `app/db/session.py`, Alembic

- 建齐第 9 节表。
- `get_db` 用 async session，路由里不要手建 engine。

验收：空库迁移后能插入 user + job 并读回。

### Task 3: 设备鉴权

**Files:** `app/core/security.py`, `app/api/routers/auth.py`, `app/api/deps.py`

- `POST /auth/device` 发 JWT。
- 受保护路由 `Depends(get_current_user)`。
- 旧测试可走 `TESTING=1` 的固定测试用户，但生产路径必须带 token。

验收：无 token 访问 `/diaries` 返回 401；错误 token 返回 401。

### Task 4: Provider 抽象与 Mock

**Files:** `app/providers/*.py`

```python
class LLMProvider(Protocol):
    async def complete_json(self, system: str, user: str) -> dict: ...

class ASRProvider(Protocol):
    async def transcribe(self, audio: bytes, filename: str) -> str: ...

class ImageProvider(Protocol):
    async def generate(self, prompt: str, *, ref_image: bytes | None, seed: int | None) -> bytes: ...
```

- `Mock*` 必须确定性：同一输入同一 JSON/同一 PNG。
- 真实 provider 用 httpx，超时 ASR 60s / LLM 60s / Image 90s，重试仅对 429/5xx。

验收：不设 API Key 时走 Mock；设 Key 时走 Live。禁止静默吞异常后假装成功。

### Task 5: Job 队列

**Files:** `app/workers/comic_job.py`, `app/api/routers/jobs.py`

- `POST /jobs/comic` 写 `jobs` 行并 `enqueue_job`。
- inline 模式（无 Redis）在同进程执行，但状态机与 worker 共用。
- SSE 从 Redis pubsub 或 DB poll 推送。

验收：

```python
def test_comic_job_queued_then_done(client):
    r = client.post("/api/v1/jobs/comic", json={"text": "今天喝了奶茶，下班好开心"})
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    body = wait_job(client, job_id)
    assert body["status"] == "done"
    assert len(body["result"]["panels"]) == 4
```

### Task 6: 把旧 diary 路由接到 job

**Files:** `app/api/routers/diaries.py`

- `text-generate` / `voice-generate` 调同一 pipeline。
- `GET /diaries` 只返回当前用户未过期 artifact，不再读全局内存。

验收：旧 `tests/test_pipeline.py` 6 项仍过；另加“用户 A 看不到用户 B”。

### Task 7: 角色圣经

**Files:** `app/services/character_bible.py`, `app/api/routers/characters.py`

- 创建角色时生成锁定描述：发色、瞳色、脸型、标志衣服、禁用项。
- 每格 prompt 前缀相同 `IDENTITY_BLOCK`。
- 合成器负责文字，生图 prompt 禁止文字。

验收：同一 `character_id` 连续两篇，四格 prompt 都含同一 identity 段落。

### Task 8: 存储与过期

**Files:** `app/services/storage.py`, `app/workers/cleanup.py`

- `get_file_url` 使用 `MEDIA_PUBLIC_BASE`，禁止写死 localhost:8000。
- cleanup 每 15 分钟删过期对象和 `jobs` 的原始音频。
- 合成图文件名用 `job_id`，不用中文标题。

验收：过期文件 GET 404；新文件 URL 随配置变化。

### Task 9: 记忆检索

**Files:** `app/services/memory.py`

- 替换 64 维哈希。
- 检索顺序：端侧 context，然后（opt-in）日期过滤，然后 BM25/向量，最多 3 条 summary。
- 后台抽取只存摘要。

验收：问“上周提拉米苏”能命中对应 summary；`memory_opt_in=false` 时服务端表为空。

### Task 10: 宠物助手

**Files:** `app/services/pet.py`

- 保留 JSON 动作枚举，供 Flutter `PetMood` 使用。
- 增加危机关键词短路。
- `stream=true` 时 SSE 输出 token，最后补一个 action JSON。

验收：无记忆时仍共情；有记忆时 `referenced_memories` 非空；危机输入不调用主 LLM。

### Task 11: 观测、限流、安全

- 结构化日志：`request_id, user_id, job_id, stage, provider_latency_ms, tokens, cost_usd`。
- 每用户每小时 10 次生图，聊天 60 次。
- 音频上限 8MB / 3 分钟。
- 不把 transcript 打进 INFO 日志。

验收：超限 429；超大音频 413。

### Task 12: 契约测试与联调

- pytest marker：`mock`（默认）、`live`（有 Key 才跑）。
- 对齐 Flutter `DiaryEntry.fromMap` 字段。
- 统一端口：开发默认 `8000`，或改 Flutter `baseUrl` 与 bat 一致。
- OpenAPI 导出给 Flutter 对照。

## 12. 验证矩阵

| 能力 | 命令 / 检查 |
|---|---|
| 单元 | `pytest voonie/backend/tests -q` |
| Job 状态机 | `pytest -k job` |
| 多用户隔离 | `pytest -k isolation` |
| 真实 ASR/LLM/Image | `pytest -m live`（需 Key，可失败但不污染 mock） |
| Flutter 契约 | 用一份 fixture JSON 跑 Dart `DiaryEntry.fromMap` |
| 手工 | 录音 20s 到 job SSE 到 4 格 + 长图，再让宠物问今天发生了什么 |

无法跑 live 时，明确报告“mock 绿、live 未跑”，不要写成产品已通。

## 13. 失败处理

| 失败 | 行为 |
|---|---|
| ASR 空文本 | job=failed，`error=asr_empty`，不生图 |
| 分镜 JSON 不合 4 格 | 用 schema repair 再调 1 次，再失败则 failed |
| 单格生图失败 | 只重试该格 2 次，其他格保留 |
| Redis 挂了 | `/health/ready` 503；已有请求不假装完成 |
| 供应商 429 | 指数退避，job 停在当前 stage |
| 用户取消 | `POST /jobs/{id}/cancel`，worker 在 stage 边界退出 |

## 14. 隐私与安全

- 日记原文默认不下发到 `GET /diaries` 列表，只给创建响应一次。
- 媒体 URL 带短 TTL 签名，或仅登录可下载。
- CBT 文案只做倾听/命名/重构，回复需声明“不是心理咨询”。
- 密钥只走环境变量；`.env` 不入库。
- 生产关 Swagger，或挂在鉴权后。

## 15. 工期建议

| 周 | 交付 |
|---|---|
| 1 | Task 1-4：可启动、可登录、Mock provider、DB |
| 2 | Task 5-8：异步生图、旧 API 兼容、角色圣经、存储 TTL |
| 3 | Task 9-11：记忆、宠物流式、限流日志 |
| 4 | Task 12 + live 抽检、Flutter 联调、修端口/字段漂移 |

第 2 周末必须能给客户端一个“能看见图、能重试、重启不丢”的后端。第 1 周不出真图也可以。

## 16. 明确不做（YAGNI）

- 漫剧视频、配音、多语言 RTL、社交广场、付费墙。
- 自训角色 LoRA（二期以后，参考图不够再用）。
- 把 ComfyUI 嵌进 API 进程。
- 用 FastAPI `BackgroundTasks` 当生产队列。

## 17. 执行方式

按 Task 1 到 12 顺序做。每个 Task：先补失败测试，再写最小实现，再跑该 Task 验收命令。

不要先重写前端，不要先换框架。现有 FastAPI 目录和 Flutter 字段就是约束。
