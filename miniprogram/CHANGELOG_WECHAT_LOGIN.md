# Changelog — 微信官方登录 + 小程序补充项（客户端）

日期：2026-09-05
范围：`miniprogram/`（以及配套后端说明见 `backend/CHANGELOG_WECHAT_AUTH.md`）。未推送 GitHub，未把任何密钥写进仓库。

## A. 微信官方登录（客户端）

### 改动
- `utils/api.ts` — 新增 `loginWithWeChatCode(code)`
  - `POST /api/v1/auth/wechat`，成功后 `setTokens`（同一套 JWT，覆盖原 device token）。
- `pages/auth/index.ts` — `onWeChatFastLogin`
  - 先校验协议勾选（与邮箱登录一致）
  - `wx.login` 取一次性 `code`（约 5 分钟有效）；获取失败 toast
  - `loginWithWechatCode(code)` 交后端换 openid；成功 toast → `switchTab` 首页，失败展示后端/网络错误信息
  - **不再调用 `ensureSession()` 冒充微信登录**

### AppID 说明
- `project.config.json` 当前仍为 `touristappid`（游客号）。**正式联调需改真实 AppID**，并确保后端 `.env` 的 `WECHAT_MINI_APPID` / `WECHAT_MINI_SECRET` 与小程序 AppID 一致。

## B. Part B1 — 录音真波形

### 改动
- `utils/recorder.ts`
  - `start()` 增加 `frameSize: 1`（16KHz mono 下约 31ms/帧），使 `onFrameRecorded` 可触发
  - 在 `initEvents` 中注册 `onFrameRecorded`，将帧转发给 `callbacks.onFrameRecord`
- `pages/record/index.ts`
  - 新增 `applyVolume(frameBuffer)`：对 PCM Int16 求 RMS 音量 → 映射到 `waveAmps` 柱高（带少量抖动，直观“活着”）
  - `setupRecorder` 注册 `onFrameRecord` 回调，诱动真实音量
  - `startWave` 作为回退：若 400ms 内未收到真实帧（基础库/环境不支持 `frameSize`），优雅回退到原有随机模拟，并在 changelog 标注

### 已知限制
- 微信基础库部分环境拿不到 `onFrameRecorded`/帧数据，此时回退到模拟波形（已写明）。

## C. Part B2 — 萌宠页消费 status / memories

### 改动
- `pages/pet/index.ts`
  - `onLoad` 拉 `getPetStatus` 更新问候语 + 状态文案；拉 `getPetMemories` 展示 1~3 条「记得的小事」
  - `onShow` 再次拉 `getPetStatus` 保持状态新鲜
  - 失败仅 `console.warn`，不阻断聊天
- `pages/pet/index.wxml` — 新增宠物状态小条 `.pet-status-strip`；问候气泡下新增「记得的小事」休闲卡（`.memories-card`）
- `pages/pet/index.wxss` — 新增对应暖色样式（沿用米白/陶橙，无科技蓝）

## 环境变量（供运维配置，不在此写明文）
- 服务端 `.env`：`WECHAT_MINI_APPID`、`WECHAT_MINI_SECRET`（与小程序 AppID 一致）

## 验证提示（WeChat DevTools）
1. 填真实 AppID 到项目；服务器 `.env` 配同名 AppID + Secret
2. 详情勾选不校验合法域名（或配好 `vonnie.xyz`）
3. 点微信登录 → 真机/工具登录态下应拿到业务 token 并进首页
4. 再测录音波形与萌宠问候

## 验收
- [ ] 「微信登录」走 `wx.login` + `/auth/wechat`，不再是 device 冒充
- [ ] 邮箱登录/注册仍可用
- [ ] 录音波形尽量真实，否则标明回退
- [ ] 萌宠页展示 status（及 memories）
- [ ] 无密钥进仓库