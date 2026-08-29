# Voonie 语音连环画日记 & 情绪陪伴小宠物 (第二版桌面端 UI（第一版已归档）)

> **日常语音倾诉 ➔ 四格连环画日记 ➔ 专属小宠物陪伴与长程记忆检索**

---

## 🌟 核心功能特性

1. **多模态叙事生成 (Voice-to-Comic)**：
   - 语音/文字输入，AI 自动转录并洞察用户主导情绪与心理评分。
   - LLM 分镜 Agent 将日常倾诉结构化为经典【起、承、转、合】四格漫画剧本。
   - 自动生成场景描述、动作表情、旁白、对话气泡与拟声词 (SFX)。
   - 排版合成引擎自动生成复古漫画纸质感的大画幅 4 格连环画长图。
2. **专属小宠物助手与长程记忆 (Pet & Emotional Companion)**：
   - 界面常驻拟人化互动小宠物（支持闲逛、呼吸跳动、写日记等状态）。
   - **长程记忆检索 (Episodic Memory RAG)**：能精准检索用户往期日记（如询问“*上周做提拉米苏是哪天？*”），宠物带着过去的记忆给出温情回忆。
   - **心理情绪疏导 (CBT-based)**：基于认知行为疗法（CBT）温和共情，提供情绪接纳与积极重构。
3. **漫画画廊与日记时光轴**：
   - 历史漫画日记时光轴，支持随时回看、翻阅与一键导出分享。

---

## 📂 项目目录结构

```
voonie/
├── backend/                  # Python FastAPI 后端服务
│   ├── app/
│   │   ├── core/config.py    # 画风配置与全局设置
│   │   ├── models/schemas.py # Pydantic 数据契约与分镜 Schema
│   │   ├── services/
│   │   │   ├── asr_service.py        # 语音转录服务 (含智能兜底)
│   │   │   ├── storyboard_agent.py   # 4格分镜拆解与情绪提炼 Agent
│   │   │   ├── image_gen_service.py  # 漫画生图服务 (Flux/SDXL/DALL-E)
│   │   │   ├── comic_composer.py     # 4格漫画排版与气泡合成器
│   │   │   ├── pet_agent.py          # 宠物心理疏导与记忆问答 Agent
│   │   │   ├── memory_service.py     # 长程情境记忆检索 RAG 引擎
│   │   │   └── storage_service.py    # 临时文件与过期清理
│   │   ├── routers/          # API 路由 (/diaries, /pet)
│   │   └── main.py           # FastAPI 入口 (挂载静态 Web 前端)
│   ├── tests/                # 自动化测试套件 (6/6 Passed)
│   └── requirements.txt
│
├── web/                      # 第一版静态 UI（已归档，仅 /legacy/）
├── web-v2/                   # 第二版主 UI（React + Vite）
    ├── index.html            # 主页结构 (录音台/四格漫画展示/宠物抽屉)
    ├── style.css             # 治愈系手绘漫画风样式
    └── app.js                # 前端交互与 API 联动逻辑
```

---

## 🚀 启动与体验方法

### 启动服务
第二版 UI 是当前主界面，第一版静态页已归档到 `/legacy/`。

```bash
# 1) 启动第二版前端
cd voonie/web-v2
npm install
npm run dev

# 2) 另开终端启动 API
cd voonie/backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

- 主 UI：`http://127.0.0.1:5173/`
- API / 健康检查：`http://127.0.0.1:8000/`
- 第一版归档页：`http://127.0.0.1:8000/legacy/`
- 交互式 API 文档：`http://127.0.0.1:8000/docs`
- 运行测试：`python -m pytest tests/`
