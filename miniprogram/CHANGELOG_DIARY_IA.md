# CHANGELOG_DIARY_IA

日期：2026-09-05
工作区：`/workspace/voonie/miniprogram`
需求单：`docs/pi-briefs/2026-09-05-diary-ia-cleanup.md`
目标：收口 P0 信息架构（「日记」Tab 进入日记本而非日历）+ 修复 `pages/auth/index.wxml` 结构问题。
未改动 `backend/`、`web-v2/`。未推 GitHub、未提交密钥。未回退任何 API 联调与 Tab 五字（首页/日记/萌宠/书架/我的）。

---

## P0-1（必须）：「日记」Tab → 日记本（手帐根页）—— 采用【方案 A】

### 为何选 A
- 微信小程序 `switchTab` 页面**不能带 query**；原 `pages/diary` 是 `navigateTo` 详情页（无 Tab）。
- 方案 A 新建独立 Tab 根页，干净隔离「根页」与「详情」，不破坏日记详情页已有翻页/API 逻辑，风险最小。

### 改动
1. **新增 `pages/diary-home/` 作为「日记」Tab 根页**（手帐封面体验）：
   - `index.json`：`navigationStyle: custom`
   - `index.ts`：`onShow` 同步 `getTabBar().setSelected(1)`；`loadLatest()` 拉最新日记做封面预览；`onOpenDiary` → `navigateTo /pages/diary/index?id=latest`（复用现有翻页手帐详情）；`onOpenCalendar` → `navigateTo /pages/calendar/index`；`onOpenRecord` → 录音（空态去倾诉）；失败态可重试。
   - `index.wxml`：加载态 / 失败态 / 空态（空白笔记本封面 + 环孔 + 温柔文案 +「去记录今天」）/ 有日记态（**手帐封面卡**：环孔、日期、插画缩略图、心情 pill、手写体标题、摘要 + 「打开这本手帐 ›」+ 主按钮「打开手帐全文」+ 次要入口「回忆日历」）。
   - `index.wxss`：奶油纸感、环孔、纸张行线纹理、主按钮暖橙大圆角、次按钮柔化；沿用 `dog_avatar`、`anim-breathe`。
2. `app.json`：
   - `pages` 列表新增 `"pages/diary-home/index"`（置于 `calendar` 前）；`calendar` 仍在（保留，作为子页）。
   - `tabBar.list` 第二项 `pagePath` 由 `pages/calendar/index` → `pages/diary-home/index`。
3. `custom-tab-bar/index.wxml`：第 2 个 Tab（index 1）`data-path` 改为 `/pages/diary-home/index`（文案仍是「日记」）。
4. **日历降级为子页** `pages/calendar/index`：
   - `index.wxml`：header 左侧新增「返回」（`onBack`）；顶部标题「日记回忆」→「回忆日历」（更贴案例屏 7）；引导横幅由「翻翻日记本」改为「**回到手帐**」（`onBackToJournal`）。
   - `index.wxss`：新增 `.nav-back-btn` / `.back-arrow`，并对齐 `header-nav` 布局（返回 + 标题 + 搜索三元素）。
   - `index.ts`：`onOpenLatestDiary` 拆为 `onBack` + `onBackToJournal`，二者 `navigateBack`（失败时 `switchTab /pages/diary-home/index` 保底）。
5. **各跳转收口**（语义「去日记」→ 新 Tab；需日历 → `navigateTo`）：
   - `pages/profile/index.ts`：`onNavDiaries`（我的日记）→ `switchTab diary-home`；`onNavCalendar`（时光胶囊）→ `navigateTo calendar`（不再 switchTab，因日历已非 Tab 页）。
   - `pages/diary/index.ts`：`onBack` 失败兜底由 `/pages/index/index` 改为 `/pages/diary-home/index`（回到日记 Tab 根页）。
   - `pages/share/index.ts`：保存成功后 `switchTab` 由 `/pages/calendar/index` 改为 `/pages/diary-home/index`。
   - `custom-tab-bar/index.wxml`、`app.json` 已同步。
   - `pages/index` 的宠物/书架等 Tab 跳转未受影响。

### 验证（Windows 微信开发者工具）
- 底部「日记」Tab → 首屏是手帐封面（或空态/最近一篇预览），**不再直接是月历网格**。
- 手帐封面 「打开手帐全文」→ 进入翻页日记详情；返回 → 回到手帐根页。
- 封面/空态下「回忆日历」→ 进入日历（带返回），日历内「回到手帐」/返回 → 回手帐根页。
- 页面 `pages/calendar/index` 依旧可作为子页从日记体系进入。
- 其它 Tab（首页/萌宠/书架/我的）与 API 调用（`listDiaries` / `getDiaryDetail` / `chatWithPet` 等）均无回归。

## P0-2（必须）：修复 `pages/auth/index.wxml` 结构

- **问题**：约第 73 行有提前的 `</view>` 把 `auth-card` 先关掉，导致后续「记住我/忘记密码 / 主按钮 / 社交登录 / 协议」被放出卡片，出现多余闭合。
- **修复**：删除该过早 `</view>`，使 `auth-card` 保持开放，直到「记住我 / 忘记密码」`form-extras`、主按钮、社交登录、协议全部嵌套在内，再依次闭合 `auth-card` → `auth-container` → `voonie-page`。
- **只动结构**：未改登录业务逻辑、未改样式类名、未改 API。
- **验证**：对 `.wxml` 做标签栈平衡扫描，`auth` open=28 / close=28 平衡；结构层级正确。

## P1 处理情况

1. **录音页真实音量波形** —— **保持模拟动画，已在 changelog 注明**：`pages/record/index.ts` 当前用 `setInterval` 随机生成 `waveAmps`（`startWave`）驱动声柱，未接 `RecorderManager.onFrameRecorded` 真实音量解析。因微信 API 不直接暴露「 dB 值」，需自行解析 `frameBuffer` PCM（或引入解码器），本轮范围只做大改/重写，故保留现动画并在本文档标明「仍为模拟」（符合 brief「否则保持现动画但标模拟」）。
2. **日记翻页手感** —— 已具备（`pages/diary` 的 `prev/next` + `pageFlip` 动画 + toast），无回归，予以保留，未重写。
3. **日历子页返回补齐** —— 已做（见 P0-1 第 4 条：`onBack` / `onBackToJournal` + 左侧返回按钮）。

## 明确不做（按 brief）
- Apple 登录真实鉴权（后端无端点，保持占位 toast）。
- 分享广场 / 发布生产 UGC（继续本地标记）。
- 像素大改 / 换色板 / 房间 3D。
- Git push / 提交密钥。
- 为通过 Linux 开发者工具做 hack。

## 已知限制
- 微信开发者工具本机预览在 Linux 社区版不稳定，本机仅做静态结构/JSON 校验；验收由产品在 Windows 官方工具进行。
- 录音波形暂为模拟（见 P1 第 1 条）。

## 验收自查
- [x] Tab「日记」首屏 = 手帐/日记本（非月历）
- [x] 日历仍可从日记体系进入（且带返回）
- [x] auth WXML 结构标签平衡、层级正确
- [x] Tab 五字仍为 首页/日记/萌宠/书架/我的
- [x] API 联调（`utils/api.ts`）未改动、无回归