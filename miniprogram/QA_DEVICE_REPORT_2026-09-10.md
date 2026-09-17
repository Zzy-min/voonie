# Voonie 微信小程序真机 QA 验收报告

## 1. 最终结论

当前为阶段性结论，尚未完成真实手机全链路执行。

- Device Verdict: **NO**
- QA Status: **DEVICE FAIL**
- 核心断点：生产后端 `POST /api/v1/auth/wechat` 返回 404，真实微信登录无法完成。
- 真机条件：已建立 vivo V2458A 远程调试连接；用户曾报告旧版图片缺失，1.0.2 已修复并上传。完整核心链路仍未执行。

## 2. 测试环境

- 小程序工程：`miniprogram`
- AppID：`wxc57365e385acdbb2`
- 小程序体验版本：`1.0.2`（图片兼容修复版，已上传）
- 测试时间：2026-09-10，Asia/Shanghai
- 本地工具：微信开发者工具 Stable 2.02.2608060

## 3. 测试设备

- 手机品牌：vivo
- 手机型号：V2458A（arm64-v8a）
- 操作系统及版本：Android，API 36
- 微信版本：8.0.77
- 微信基础库：3.17.2 [1641]
- 网络：Wi-Fi，远程调试观测延迟约 245–326 ms
- 连接状态：正常
- 跨平台覆盖：不足；Android 已连接，iPhone 未测试

## 4. Backend / API 环境

- API Base URL：`https://vonnie.xyz`
- 环境：production
- 协议：HTTPS
- localhost / 127.0.0.1：未使用
- request 合法域名：PASS；关闭域名绕过后，Android 真机请求 `https://vonnie.xyz/api/v1/diaries` 返回 200
- uploadFile / downloadFile 合法域名：NOT VERIFIED
- 本地后端微信 AppID：已配置且与前端匹配
- 本地后端微信 Secret：已配置，未记录值
- 生产微信登录路由：**FAIL，HTTP 404**

## 5. Golden Path 总览

| Flow | Result | Failure Point |
| --- | --- | --- |
| 首次启动 | PARTIAL | DevTools 可到 Auth；真机修复版未复验 |
| 邮箱注册 | NOT TESTED | 缺真机测试账号与 Network 证据 |
| 邮箱登录 | NOT TESTED | 缺真机账号 |
| 微信登录 | FAIL | 生产 `/api/v1/auth/wechat` 返回 404 |
| 语音录音 | FAIL | Android 真机 `operateRecorder:fail start record fail` |
| 真波形 | NOT TESTED | 未取得真实声音分段证据 |
| 音频上传 | NOT TESTED | uploadFile 域名与真实文件请求未验证 |
| AI 整理 | NOT TESTED | 上游录音未执行 |
| 日记保存 | NOT TESTED | 未创建真实日记 |
| Diary → Calendar | NOT TESTED | 无真机数据 |
| Pet Status | PARTIAL | 真机已发起请求，状态与 UI 尚未核验 |
| Pet Memories | PARTIAL | 真机已发起请求，内容 grounding 尚未核验 |
| AI Chat | PARTIAL | 真机已发起请求，响应与上下文尚未核验 |
| Comic Generation | NOT TESTED | 无真实 entry/job |
| Bookshelf | NOT TESTED | 无真实生成结果 |
| Profile | NOT TESTED | 无已登录真机用户 |
| 退出 / 登录恢复 | NOT TESTED | 微信登录被生产 404 阻断 |

## 6. Bad Path 总览

| 场景 | 预期 | 实际 | Result |
| --- | --- | --- | --- |
| 无网络启动 | 结束 Loading，可重试 | 未真机执行 | NOT TESTED |
| 登录断网 | 明确失败，可重试 | 未真机执行 | NOT TESTED |
| 登录错误密码 | 明确错误，不进入首页 | 未真机执行 | NOT TESTED |
| 麦克风拒绝 | 引导设置，不假录音 | 代码存在引导；未真机执行 | PARTIAL |
| 录音立即停止 | 不上传无效录音 | 代码限制少于 2 秒；未真机执行 | PARTIAL |
| 上传断网 | 保留记录并可重试 | 当前 UI 仅提示；缺明确保留/重试验证 | NOT TESTED |
| AI 请求失败 | 结束 Loading，可恢复 | 未真机执行 | NOT TESTED |
| Chat 失败 | 不重复消息，可重试 | 未真机执行 | NOT TESTED |
| Generation 失败 | 停止轮询，可重试 | 未真机执行 | NOT TESTED |
| Generation 切后台 | 恢复同一 job | 未真机执行 | NOT TESTED |
| 账号切换 | 数据完全隔离 | 未准备双账号 | NOT TESTED |

## 7. 首次启动

本地会话逻辑已整改：无 Token 时不再调用 `/auth/device`，直接进入 Auth；DevTools 已观察到 `pages/auth/index`。Android 真机以设备端 Storage 重连后存在历史 Token，因此首次无状态冷启动仍需清除小程序数据后执行。

## 8. 邮箱注册 / 登录

接口实现存在，后端认证定向测试 21 项通过。真实邮箱创建、Token、`/me` 和冷启动恢复均 NOT TESTED。

## 9. 微信登录

前端存在 `wx.login → POST /api/v1/auth/wechat`；本地后端存在 code2Session 实现并有测试。生产探测返回 404，因此真实链路当前 FAIL。

### BUG-001

**Priority:** P1
**Module:** WeChat Auth
**Device:** production endpoint probe
**Environment:** production

**Steps:**

1. 向 `https://vonnie.xyz/api/v1/auth/wechat` 发送无敏感信息的无效测试 code。
2. 观察 HTTP 响应。

**Expected:** 路由存在，并返回业务错误（例如无效 code 的 401），而不是路由缺失。

**Actual:** HTTP 404，`{"detail":"Not Found"}`。

**Evidence:** `qa-evidence/2026-09-10/api/production-auth-wechat-probe.md`

**Suspected Code/State:** 本地 `backend/app/api/routers/auth.py` 已实现，生产部署版本滞后。

**Recommendation:** 部署当前后端迁移和认证路由，随后用真实微信 code 复验。

## 10. 首页 / TabBar

DevTools 首页与 PNG 背景已渲染；Tab 配置中日记指向 `pages/diary-home/index`。真机点击热区、五 Tab 循环和角色叠图 NOT TESTED。

## 11. 语音录音

### 11.1 权限

存在 `scope.record` 和拒绝后 `wx.openSetting` 路径。修复前 Android 真机进入录音页后自动启动失败；最新构建已在同一设备建立全新远程调试连接，允许/拒绝分支仍需手机点击复验。

### 11.2 Recorder

使用 `RecorderManager`，支持开始、暂停、继续、停止。修复前 Android 真机捕获 `operateRecorder:fail start record fail` 两次，仍判 FAIL。最新构建已改为用户点击“开始说”后启动，并加入 start/stop 防重、pending-start 取消、录音会话回调隔离、离页/错误清理；开发者工具编译通过且同一设备新调试会话 Console 初始无 Recorder 错误，点击录音结果待复验。

### BUG-002

**Priority:** P1
**Module:** Record
**Device:** vivo V2458A / Android API 36 / WeChat 8.0.77
**Environment:** production API, strict remote debug

**Steps:**

1. 在 Android 真机进入录音页面。
2. 页面加载时旧实现自动调用 RecorderManager。
3. 查看远程调试 Console。

**Expected:** 用户明确点击后弹出权限请求并开始录音。

**Actual:** Console 连续两次出现 `operateRecorder:fail start record fail`，录音未开始。

**Evidence:** `qa-evidence/2026-09-10/record/real-device-network-console.md`

**Suspected Code:** 旧版 `pages/record/index.ts` 在 `onLoad` 自动启动录音，缺少稳定的用户手势边界。

**Recommendation/Status:** 已改为点击“开始说”后启动，并增加启停防重、pending-start 取消、会话回调隔离、返回/重录丢弃保护；同一设备已加载新调试会话，等待点击复验。

### 11.3 真波形

`onFrameRecorded` 已接入，但当前将 M4A 编码帧直接解释为 Int16 PCM，不能据此证明真实 RMS。必须以真机“静音→正常→大声→静音”实测判定，当前 NOT TESTED。

### 11.4 上传

使用 `wx.uploadFile`、Bearer Token、`audio_file`、本地幂等键；真实 HTTP 状态、文件大小和服务端接收 NOT TESTED。

### 11.5 前后台

NOT TESTED。

## 12. AI 整理

NOT TESTED；必须证明输出来自刚录音内容。

## 13. Diary

NOT TESTED；必须验证保存、页面重进和冷启动持久化。

## 14. Calendar

路由结构符合要求；日期标记、月切换和 UTC+8 23:00 专项 NOT TESTED。

## 15. Pet Status

Android 真机已观察到 `status?pet_name=Voonie` 请求；状态码、响应内容与 UI 更新仍需核验。

## 16. Pet Memories

Android 真机已观察到 `memories` 请求；新日记后的更新与 grounding 仍需核验。

## 17. Pet AI Chat

Android 真机已观察到 `chat` 请求；短期上下文、长期记忆、拒绝虚构、断网重试与消息顺序仍需核验。

## 18. Comic Generation

前端使用真实 `jobId` 并轮询；创建、防重复、后台恢复、失败停止和结果对应关系均 NOT TESTED。

## 19. Bookshelf

NOT TESTED；必须以真实生成结果验证持久化。

## 20. Profile

`companion_days` 优先读取后端字段；真实跨设备一致性与退出清理 NOT TESTED。

## 21. Share

NOT TESTED；需真实微信分享及第二账号打开，确认无隐私泄漏。

## 22. Square

已知 Demo/占位项，不作为 P0；真机稳定性 NOT TESTED。

## 23. 数据持久化

NOT TESTED。

## 24. 账号数据隔离

NOT TESTED；缺账号 A/B。

## 25. 网络 / 弱网

Android Wi-Fi 且关闭域名绕过时，生产 Diaries 请求返回 200；微信登录路由仍缺失。移动网络、断网、弱网切换尚未执行。

## 26. 生命周期

首页、录音、上传、生成、Chat、详情的冷热启动与前后台恢复均 NOT TESTED。

## 27. UI 真机一致性

旧体验版曾由用户报告“手机只有文字、背景不加载”。1.0.2 将实际使用的 WebP 背景/插画/宠物资源转换为 PNG，DevTools 渲染通过并上传；修复后的真机冷启动仍待复验。

## 28. 性能与稳定性

兼容资源预计有效包体约 1.57 MB；实际上传成功。长时录音、内存、重复进入和弱网稳定性 NOT TESTED。

## 29. P0 问题

当前未发现已被证据证明的 P0；账号隔离与未授权访问仍未测试，不能据此判定无 P0。

## 30. P1 问题

1. BUG-001：生产微信登录路由 404，真实微信登录中断。
2. BUG-002：Android 真机 RecorderManager 启动失败；已完成显式用户手势修复，待复验。
3. 真波形算法对 M4A 编码帧按 PCM 解析，真实性未证明。

## 31. P2 问题

1. 上传失败后当前交互未证明可保留录音并直接重试。
2. uploadFile/downloadFile 合法域名未取得独立真机证据。

## 32. P3 问题

无已验证的 P3；视觉跨机型未测试。

## 33. Release Blockers

1. 生产 `/api/v1/auth/wechat` 路由缺失。
2. 真实手机完整录音 → 上传 → AI → Diary → Pet → Generation → Bookshelf 链路尚未执行。
3. 账号 A/B 数据隔离尚未验证。

## 34. 未测试项

- iPhone + Android 跨平台
- 邮箱注册/登录真实账号
- 微信登录真实 code
- 麦克风允许/拒绝、真实波形、后台录音
- 音频上传、AI、日记持久化
- Pet、Generation、Bookshelf
- Share、账号隔离、弱网、生命周期、键盘与安全区

## 35. 推荐修复顺序

1. 部署生产微信登录路由及数据库迁移。
2. 在微信开发者工具开启真机调试，记录设备与 Network/Console。
3. 用新用户完成注册/微信登录和录音主链路。
4. 验证 Pet Memory、Generation、Bookshelf。
5. 执行双账号隔离和弱网/前后台 Bad Path。

## 36. 最终真机验收状态

**DEVICE FAIL**

生产微信登录路由 404 已证明核心登录链路中断，因此按本任务标准判定 DEVICE FAIL。其余未执行项目继续标记 NOT TESTED；修复并完成真机执行前，不得判 DEVICE PASS。

## 核心 E2E 工作流

| E2E | Result | 断点 |
| --- | --- | --- |
| 新用户 → 注册 → 首页 → 录音 → AI → Diary | NOT TESTED | 缺真机账号/录音 |
| 微信登录 → 后端用户 → 重启 → 恢复 | FAIL | 生产微信登录 404 |
| Diary → Generation → Comic → Bookshelf | NOT TESTED | 无真实 Diary |
| Diary → Pet Memory → Chat | NOT TESTED | 无真实 Diary |
| Diary Tab → diary-home → Calendar → Diary | NOT TESTED | 无真机执行 |
| 账号 A → Logout → 账号 B → 隔离 | NOT TESTED | 缺双账号 |

## 执行摘要

```text
Voonie 真机 QA 进行中

Device Verdict:
NO

QA Status:
DEVICE FAIL

P0:
未验证账号隔离与私密 API，不可宣称为 0

P1:
生产微信登录路由 404；真波形真实性未证明

P2:
上传恢复与 upload/download 合法域名未验证

P3:
跨机型视觉未测试

Core E2E:
注册 → 录音 → AI → 日记：NOT TESTED
微信登录 → 登录态恢复：FAIL
Diary → Pet Memory → Chat：NOT TESTED
Diary → Generation → Bookshelf：NOT TESTED
Diary → Calendar：NOT TESTED
多账号数据隔离：NOT TESTED

Release Blockers:
1. 生产 /api/v1/auth/wechat 404
2. 核心真机链路未执行
3. 多账号隔离未验证

未完成真机测试：
- 见第 34 节

报告：
miniprogram/QA_DEVICE_REPORT_2026-09-10.md

证据：
miniprogram/qa-evidence/2026-09-10/
```
