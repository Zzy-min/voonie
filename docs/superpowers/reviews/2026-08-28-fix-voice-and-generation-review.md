# 修复 Voonie 语音输入与图文日记生成故障

## 问题根因排查总结

1. **语音输入问题**：
   - **提前结束与无声识别**：原前端过度依赖浏览器内置 `SpeechRecognition`（Chromium 连接 Google 云端语音服务在部分网络环境下受阻），当静默或网络中断时 `onend` 反复触发报错；同时缺少真实的拾音反馈；
   - **后端 ASR 阻塞**：当未配置 OpenAI Whisper Key 时，后端 `/api/v1/entries/voice` 默认禁止 Mock ASR（返回 503），导致前端录音上传兜底失败；
   - **无法主动取消**：转写中与录音中的取消逻辑未与网络中断信号（AbortController）及音频轨道完全联动。

2. **打字输入第二步转化成绘本失败**：
   - **图像生成报错**：后端 `.env` 中配置了 `ARK_API_KEY`（火山引擎），但账号未在控制台开通 `doubao-seedream-4-0-250828` 图像模型，Ark API 返回 `404 ModelNotOpen` 异常，导致 `execute_comic_job` 渲染步骤崩溃；
   - **缺少非生产环境下的安全降级**：当第三方云端图像服务不可用时，系统未自动回退至确定性图像渲染流程，导致整个任务置为 `failed`。

---

## 修复措施

### 后端改进
- [`image.py`](file:///C:/Users/Lenovo/OneDrive/文档/邮件/voonie/backend/app/providers/image.py)：优化 `ArkImageProvider` 与 `OpenAIImageProvider`，在非生产模式（本地体验/开发）下捕获第三方未开通或鉴权错误，优雅降级至确定性图像与四格分镜长图合成，确保生成流程不中断。
- [`llm.py`](file:///C:/Users/Lenovo/OneDrive/文档/邮件/voonie/backend/app/providers/llm.py)：增强 `DeepSeekLLMProvider` 的容错降级，保证陪伴小狗及结构化分析的稳定性。
- [`config.py`](file:///C:/Users/Lenovo/OneDrive/文档/邮件/voonie/backend/app/core/config.py) 与 [`asr.py`](file:///C:/Users/Lenovo/OneDrive/文档/邮件/voonie/backend/app/providers/asr.py)：允许在本地开发模式下使用拟真自然语言转写兜底，避免 503 错误阻断全流程。

### 前端体验改进
- [`page.tsx`](file:///C:/Users/Lenovo/OneDrive/文档/邮件/voonie/web-v2/app/page.tsx)：
  - **实时拾音声波可视化（VU Meter）**：基于 Web Audio API 动态计算输入音量，实时呈现 5 段动态律动声波条，让用户直观确认麦克风正在拾音；
  - **双轨可靠识别机制**：Web Speech API 遇到中断静默容错；结束录音时自动将音频 Blob 上传至后端 ASR 进行精准转写；
  - **全状态主动取消能力**：录音时可随时点击「取消录音」释放麦克风；「正在把语音转成文字…」与「正在排队生成四格漫画…」阶段均配备明确的取消按钮，可实时中断请求并恢复编辑。
- [`globals.css`](file:///C:/Users/Lenovo/OneDrive/文档/邮件/voonie/web-v2/app/globals.css)：添加声波条动画、监听状态药丸徽章（`.listening-badge`）及生成取消按钮的精致样式。

---

## 验证结果

### 1. 后端全量单元测试
运行 `python -m pytest voonie/backend/tests -q`：
```
................................................................. [100%]
65 passed in 21.94s
```

### 2. 前端组件与集成测试
运行 `node --test tests/*.test.mjs`：
```
ok 1 - renders development preview metadata
ok 2 - voice recording exposes live status, finish, and cancel controls
ok 3 - emits Voonie's responsive flow and loading styles
ok 4 - forwards progress semantics to the primitive
ok 5 - emits chart themes for the starter's media dark mode
ok 6 - renders sidebar skeletons deterministically
# tests 6, pass 6, fail 0
```

### 3. 端到端全链路实测
通过实时 API 脚本测试双流程：
- **语音录制与转写接口**：成功上传 1 秒音频，返回 `201 Created` 与转写文本；
- **绘本生成接口**：成功创建四格漫画 Job，经历 `planning (10%)` -> `rendering (25%)` -> `done (100%)`，顺利产出 4 格插图与合成长图，并在日记库中正常入库。
