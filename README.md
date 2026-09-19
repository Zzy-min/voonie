# Voling 日记

> Vonnie 陪你记录每一个普通但值得留下的日子。

Voling 日记是一款面向微信小程序与 Web 的 AI 日记产品。用户可以通过语音或文字告诉 Vonnie 今天发生的事，系统会在真实后端完成转写、整理、情绪提炼、日记生成和配图，并将内容沉淀到日记、绘本与长期回忆中。

- **Voling 日记**：产品名称
- **Vonnie**：产品中的陪伴角色
- **voonie**：历史仓库名，为兼容现有工程与部署路径而保留

## 产品能力

- 语音与文字统一录入，支持本地草稿和失败重试
- AI 整理日记正文、标题、情绪和关键片段
- 根据正文语义生成插图，并插入对应段落
- 日记列表、详情、编辑、绘本和回忆日历
- 与 Vonnie 聊天，以及用户授权后的长期记忆检索
- 官方角色与自定义主角，支持参考图和角色一致性约束
- 分享广场、点赞、收藏、举报和私密发布
- 微信登录、微信手机号能力及邮箱身份绑定
- Loading、Empty、Error、Offline 等完整页面状态
- 请求重试、会话刷新、幂等写入和请求链路追踪

> 当前账号体系以微信身份为主。邮箱账号可以绑定到微信身份；Apple 登录尚未作为已完成能力提供。

## 核心流程

```text
语音 / 文字记录
      ↓
转写与内容理解
      ↓
生成结构化日记
      ↓
按正文语义生成并插入配图
      ↓
日记 / 绘本 / 回忆 / 分享
```

## 技术架构

```text
微信小程序 / Web
       ↓
FastAPI API
       ↓
Service / Worker
       ↓
SQLite 或 PostgreSQL / Redis / 媒体存储
       ↓
ASR / LLM / 图像生成服务
```

主要技术栈：

- 小程序：微信原生小程序、TypeScript、WXML、WXSS
- Web：React 19、TypeScript、Vite / Vinext
- 后端：Python、FastAPI、SQLAlchemy、Alembic
- 异步任务：ARQ / Redis，也支持开发环境内联执行
- 语音：微信 RecorderManager、Faster Whisper 或远程 ASR
- AI：OpenAI、DeepSeek、火山方舟等可配置提供方
- 部署：Caddy、systemd、HTTPS

## 仓库结构

```text
voonie/
├── backend/                 # FastAPI、数据模型、服务、任务与测试
│   ├── alembic/             # 数据库迁移
│   ├── app/
│   │   ├── api/             # 认证、日记、角色、分享等 API
│   │   ├── core/            # 配置、鉴权与异常处理
│   │   ├── db/              # SQLAlchemy 模型与会话
│   │   ├── services/        # ASR、日记整理、配图、记忆与限流
│   │   └── workers/         # 绘本生成与重试任务
│   └── tests/               # 后端自动化测试
├── miniprogram/             # Voling 微信小程序
│   ├── assets/              # Vonnie、角色、图标与页面资源
│   ├── components/          # 公共组件与聊天抽屉
│   ├── custom-tab-bar/      # 首页、日记、萌宠、广场、我的
│   ├── pages/               # 页面与业务交互
│   └── utils/               # API、录音、草稿和内容适配
├── web-v2/                  # 当前 Web 客户端
├── web/                     # 历史静态客户端
├── deploy/                  # 部署脚本与配置
└── docs/                    # 设计、规范和实施文档
```

## 本地运行

### 1. 后端

建议使用 Python 3.11 或 3.12，并从仓库的父目录运行，以保证 `voonie` 包路径正确。

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r voonie/backend/requirements.txt
python -m uvicorn voonie.backend.app.main:app --reload --port 8000
```

健康检查：

- `http://127.0.0.1:8000/health`
- `http://127.0.0.1:8000/health/ready`
- `http://127.0.0.1:8000/docs`

### 2. 环境变量

后端默认读取 `backend/.env`。不要提交真实密钥。

```dotenv
JWT_SECRET=replace-with-a-long-random-secret
DATABASE_URL=sqlite+aiosqlite:///./backend/voonie.db

WECHAT_APP_ID=your-wechat-mini-program-app-id
WECHAT_APP_SECRET=your-wechat-mini-program-secret
REQUIRE_WECHAT_BINDING=true

OPENAI_API_KEY=
DEEPSEEK_API_KEY=
ARK_API_KEY=
```

生产环境必须使用独立强随机 `JWT_SECRET`、HTTPS、安全 Cookie，并在微信公众平台配置合法 request、uploadFile 和 downloadFile 域名。

### 3. 微信小程序

1. 打开微信开发者工具。
2. 导入 `miniprogram/` 目录。
3. 使用项目自己的小程序 AppID。
4. 本地联调时将 API 地址指向本地后端；真机和体验版使用已备案的 HTTPS 域名。
5. 编译后分别检查模拟器和真实设备。

当前根导航为：

```text
首页 · 日记 · 萌宠 · 广场 · 我的
```

其中“日记”合并日记与回忆能力，“萌宠”进入 Vonnie 聊天。

### 4. Web

```bash
cd web-v2
npm install
npm run dev
```

默认开发地址为 `http://127.0.0.1:5173`。

## 测试与构建

后端完整测试：

```bash
# 在仓库父目录执行
python -m pytest voonie/backend/tests -q
```

Web 检查：

```bash
cd web-v2
npm run typecheck
npm run lint
npm run test
npm run build
```

小程序使用微信开发者工具进行编译、预览和真机验证。重点测试：

- 登录、身份绑定和会话恢复
- 语音录制、上传、转写和同一草稿重试
- 文字输入、键盘弹出与页面恢复
- 日记生成、正文配图、重新生成和编辑
- 日期与时区正确性
- 角色选择、参考图和主人公一致性
- 广场权限、详情加载和非作者只读
- 弱网、离线、超时、401 刷新和 429 限流
- iPhone 与 Android 的安全区、键盘和响应式布局

## API 与数据安全

- API 前缀：`/api/v1`
- 用户资源由服务端根据访问令牌隔离，客户端不负责决定资源归属
- 日记默认私密，只有用户主动发布后才进入广场
- 分享内容不授予其他用户编辑原日记的权限
- 语音、图片和日记属于敏感个人数据，不应写入日志或测试夹具
- 写操作通过幂等键避免移动网络重试造成重复数据
- 服务响应提供 `X-Request-ID` 与 `X-Trace-ID`，用于问题定位

## 部署边界

以下状态彼此独立，不能互相替代：

1. 本地构建和测试通过
2. 后端部署到服务器
3. 微信开发版上传
4. 微信体验版设置
5. 微信审核提交
6. 正式发布

上传开发版并不代表已经提交审核或正式上线。任何生产部署都应保留可验证的回滚备份，并在部署后检查 `/health`、`/health/ready`、服务重启次数和真实客户端流程。

## 品牌原则

- 功能清晰 > 操作效率 > 内容呈现 > 情绪氛围 > 装饰
- 最终气质：简单、温暖、克制
- Vonnie 承担陪伴与品牌识别，界面本身保持安静和高效
- 避免把产品描述成普通聊天机器人、儿童 App 或纯情绪打卡工具

## 项目状态

项目仍在持续开发。自动化测试、构建、服务器健康和微信上传回执只能证明对应环节完成；登录、语音、弱网、日期、生成一致性和跨设备布局仍应以真实设备端到端验证为最终验收标准。
