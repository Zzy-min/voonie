# 修复语音输入与绘本生成故障的技术方案

## 问题背景与根因分析

用户反馈两个核心故障：
1. **电脑网页端语音输入识别不到，会提前结束，并且无法判断是否仍在监听语音，不能主动取消**：
   - 网页端过度依赖 Chromium 原生 `SpeechRecognition`（Web Speech API）。在许多网络环境下，Chromium 无法连接 Google 语音服务器，导致无识别结果，且 `recognition.onend` 频繁触发报错中断；
   - 录音阶段缺少直观的音频音量波形动画（VU Meter），用户无法直观确认麦克风是否真正采集中；
   - 录音与转写阶段缺少完善的主动取消机制（转写请求未绑定取消按钮）；
   - 后端语音转写接口在无 OpenAI Key 时默认拒绝 Mock ASR（返回 503），导致录音上传兜底失败。
2. **打字输入第二步转化成绘本也失败**：
   - 后端 `.env` 中配置了 `ARK_API_KEY`（火山引擎方舟），但当前账号未在控制台开通 `doubao-seedream-4-0-250828` 图像模型（Ark API 返回 `404 ModelNotOpen`）；
   - `ArkImageProvider` 抛出 `HTTPStatusError` 异常，导致 `execute_comic_job` 任务失败；
   - `get_llm_provider` 未优先适配已配置的 `DEEPSEEK_API_KEY`，导致分镜阶段仍使用 Mock LLM 或缺少健全降级；
   - 本地开发/体验模式下，缺少在第三方模型未开通或鉴权失败时的安全优雅降级保护。

---

## 修复目标与方案设计

### 1. 网页端语音录制与识别全链路重构
- **实时音频音量波形可视化**：基于 Web Audio API（`AudioContext` + `AnalyserNode`）实时计算输入音量，渲染 5 段动态律动声波条，让用户直观看到麦克风正在拾音。
- **双轨可靠识别机制**：
  - 启动 `MediaRecorder` 录制音频 Blob，同时尝试 Web Speech API 实时识别。
  - Web Speech API 报错/静音中断时静默容错，不中断 MediaRecorder 录音。
  - 点击「结束并识别」时，若已有前端实时文字则直接填入；若无，则自动将录音音频上传至后端 `/api/v1/entries/voice`。
- **全状态主动取消能力**：
  - 录音中随时可点击「取消录音」，释放麦克风、重置计时器与波形。
  - 「正在转成文字…」阶段提供「取消」按钮，立即中断网络请求并恢复输入界面。
- **后端 ASR 本地模式健全化**：
  - 在非 Production 模式或无 OpenAI Key 时，开启 ASR 本地开发转写服务，避免 503 报错阻塞体验。

### 2. 绘本生成（分镜与绘图）服务健壮性与 Provider 修复
- **LLM Provider 优先支持 DeepSeek**：
  - `get_llm_provider` 检查 `DEEPSEEK_API_KEY`，使用 DeepSeek 生成高质量四格分镜、角色动作、旁白和情绪分析。
- **Image Provider 容错与优雅降级**：
  - `ArkImageProvider` 优化：当火山引擎返回 `ModelNotOpen`、`404` 或未开通错误时，在开发模式下自动回退至高质量确定性图像生成（Pillow 渲染与 ComicComposer 合成），保证图文日记全链路顺畅产出。
  - 支持直接生成包含 4 格分镜的完整漫画长图与绘本各页插图。

---

## 变更文件清单

### 后端
- `voonie/backend/app/providers/llm.py`: 让 `get_llm_provider` 支持 `DEEPSEEK_API_KEY`。
- `voonie/backend/app/providers/image.py`: 优化 `ArkImageProvider` 和 `get_image_provider`，增加非生产模式下的异常降级保护。
- `voonie/backend/app/core/config.py`: `ALLOW_MOCK_ASR` 默认在非生产环境下允许兜底，保证语音全流程闭环。
- `voonie/backend/app/api/routers/entries.py`: 确保 ASR 在非生产模式下优雅兜底。

### 前端
- `voonie/web-v2/app/page.tsx`:
  - 增加 `AudioContext` + `AnalyserNode` 音频波形监听与动态音量指示。
  - 优化录音控制栏 UI，增加清晰的状态标识、时长显示与「取消录音」按钮。
  - 完善「正在把语音转成文字」的取消控制。
  - 容错处理 `SpeechRecognition`，确保录音上传双保险。
- `voonie/web-v2/app/globals.css`:
  - 增加声波动画与录音控制栏样式。

---

## 验证计划

1. **后端单元与集成测试**：
   - 运行 `pytest voonie/backend/tests`，验证全量后端测试通过。
   - 运行 Python 诊断脚本，验证 DeepSeek 分镜生成与图像 Provider 降级逻辑。
2. **前端构建与类型检查**：
   - 运行 `npm run typecheck`、`npm run lint`、`npm test`。
3. **真实端到端流程验证**：
   - 使用 API / 浏览器测试文本输入 -> 生成四格漫画绘本 -> 翻阅保存。
   - 测试语音录音交互、声波动画、取消录音、结束并识别。
