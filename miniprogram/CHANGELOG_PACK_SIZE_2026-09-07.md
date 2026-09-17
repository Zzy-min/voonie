# CHANGELOG — 小程序主包体积 >2MB（错误码 80051）

日期：2026-09-07

## 现象
微信开发者工具真机调试上传失败：
`source size 3894KB exceed max limit 2MB`（错误码 80051）

## 根因
- `miniprogram/` 约 4.4MB，其中 `assets/images` 图片约 3.8MB。
- 最大单文件 `assets/images/reference-ui.png` ≈ 1.86MB（设计参考整图，代码未引用）。
- `assets/images/reference/**` 为案例参考副本，代码未引用。
- 大量 `comic-*` / `hero-pet` / `mood-*` / `avatar-*` 等与代码实际引用路径不一致或未引用。
- **代码实际仅引用 7 张图片**（合计 ≈ 287KB）：`comic_1` / `comic_2` / `dog_avatar` / `dog_chat_top` / `dog_hero` / `dog_sidebar` / `user_avatar`。
- 此前 `packOptions.ignore` 为空，导致 `*.md` 文档与参考图一并打包。

## 策略（优先 ignore，不改业务代码）
在 `miniprogram/project.config.json` → `packOptions.ignore` 忽略未引用资源：
- `assets/images/reference/**`（文件夹）
- `assets/images/reference-ui.png`
- `**/*.md` 与根目录 `*.md`（README / QA / CHANGELOG 文档）
- 未被引用的图片：`comic-1..4.png`、`comic_3/4`、`comic_sad.png`、`chat-pet`、`hero-pet`、`sidebar-pet`、`memory`、`avatar-*.png`、`mood-*.png`、`favicon.ico`、`user_header_avatar.png`

**保留** 7 张被引用图，禁止 ignore。

## 验收估算
- 忽略后打包候选总大小 ≈ **475.9 KB**（< 1500KB，留余量，可过 2MB 限制）。
- 7 张引用图均存在且未被 ignore。

## 未改动 / 验证
- 未改登录 / API 等业务逻辑（本任务只解决打包体积）。
- 未写密钥；未 git push。
- 备注：文档默认会随 ignore 排除打包，如 `.md` 需保留在仓库（git）则不影响（git 跟踪与打包体积无关）。

## 完成后的操作
- 关掉开发者工具报错框后，重新编译 / 真机调试。
- 若本机目录与工作区不一致，以工作区为准或等需求方同步。