# 修复“Device proof is required”设备凭据鉴权异常

## 问题根因
浏览器端在本地 `localStorage` 缓存了 `voonie-device-id`。但在跨端口（5173 -> 8000）或 Cookie 丢失时，请求体中未附带 `device_secret`，后端查询到该 `device_id` 已存在但无法校验凭据，返回 `401 Device proof is required`。因为 `localStorage` 中旧 ID 一直未清除，导致后续所有请求被死锁拦截。

## 修复措施
1. `web-v2/lib/api.ts`：将服务端下发的 `device_secret` 持久化在 `localStorage`（`voonie-device-secret`）中并在 `/api/v1/auth/device` 请求中附带；
2. 增加 401 自动重置与自愈机制：当遇到 `401 device_proof_required` 时，前端自动清理失效凭据，生成全新设备标识重新握手完成会话初始化；
3. `backend/app/api/routers/auth.py`：将 `voonie_device` Cookie 作用域扩大至 `/api/v1/auth`，确保刷新与设备校验均可访问。

## 验证结果
- 模拟失效设备 ID 请求返回 401 后，前端自愈机制成功完成全新握手（201 Created）；
- 跨端口会话与日记创建接口全部恢复畅通。
