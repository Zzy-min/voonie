# 生图能力与漫画分镜深度增强实施计划 (Implementation Plan)

## 一、 计划目标与任务拆解

本计划分为三个阶段递进实施：

### 阶段 1：角色一致性与画质提示词工程 (Character Consistency & Anime Shading)
1. **修改 `app/services/prompt_builder.py`**：
   - 增加小狗 Voonie 的固定标准外貌与动作锁：`"companion_dog": "a cute cheerful fluffy orange-and-white corgi-shiba puppy named Voonie, shiny round black eyes, warm smile, wagging tail"`；
   - 升级 `DEFAULT_BIBLE` 和 Prompt 构建器，当场景中包含 Voonie 时自动注入宠物一致性约束；
   - 增加高级渲染与画质词（`masterpiece, vibrant cel shading anime style, soft luminous lighting, clean sharp lines, exquisite details, no watermarks, no distorted anatomy`）；
2. **修改 `app/core/config.py` 中的 `STYLE_PRESETS`**：
   - 精细化 `chibi_manga`、`anime_cel`、`healing_watercolor` 等预设的英文提示词。

### 阶段 2：单幕独立重绘 API 与前端交互 (Single Panel Regeneration)
1. **完善后端单幕重绘路由 `app/routers/diary_router.py`**：
   - 增加 `POST /api/v1/diaries/{job_id}/panels/{panel_index}/regenerate` 端点；
   - 接收可选的微调提示词 `custom_prompt`；
   - 调用 `image_gen_service.generate_panel_image` 单独生成该幕；
   - 重新合成连环画并更新数据库中的 `DiaryArtifact` / `Panel` 记录，返回最新的绘本 JSON；
2. **前端绘本翻阅组件 `app/page.tsx` (`StoryBook`)**：
   - 在每幕底部或卡片右上角增加「🎨 重新绘制这幕」按钮；
   - 触发后局部展示 Spinner 加载微动画，成功后仅刷新该页图片，体验极速流畅。

### 阶段 3：照片垫图与图生图支持 (Photo Reference Conditioning)
1. **前端 `DiaryCreator` 增加照片上传与预览**：
   - 支持用户点击或拖拽上传 1 张生活照片（Base64 编码）；
   - 展示缩略图，并提供一键清除；
2. **后端 `GenerateComicFromTextRequest` 支持 `ref_image_b64`**：
   - 后端解析 Base64 图片并在调用生图服务时传入 `ref_image`；
   - `ArkImageProvider` 将参考图传给火山引擎 Ark。

---

## 二、 变更文件清单

| 文件 | 操作 | 内容说明 |
| :--- | :--- | :--- |
| `voonie/backend/app/services/prompt_builder.py` | MODIFY | 注入 Voonie 小狗一致性卡与赛璐珞/水彩画质词 |
| `voonie/backend/app/core/config.py` | MODIFY | 升级 `STYLE_PRESETS` 画风提示词库 |
| `voonie/backend/app/routers/diary_router.py` | MODIFY | 新增单幕重绘 API 与图生图参考图接收 |
| `voonie/backend/app/models/schemas.py` | MODIFY | 新增 `RegeneratePanelRequest` 及 `ref_image_b64` 字段 |
| `voonie/backend/tests/test_prompt_builder.py` | MODIFY/NEW | 单元测试验证角色一致性与单幕重绘逻辑 |
| `voonie/web-v2/lib/api.ts` | MODIFY | 增加 `regeneratePanel(jobId, panelIndex, customPrompt)` 接口 |
| `voonie/web-v2/app/page.tsx` | MODIFY | 绘本翻页器增加单幕重绘按钮与 Creator 照片上传预览 |

---

## 三、 验证方案

1. **测试执行**：
   - 运行 `pytest voonie/backend/tests`，确保所有单元测试 100% 通过；
   - 运行 `npm run typecheck` 与 `node --test tests/*.test.mjs`，确保前端 0 错误；
2. **端到端流程验证**：
   - 测试通过 DeepSeek 生成 4 幕绘本；
   - 在绘本界面对第 2 幕点击「重新绘制这幕」，验证单幕刷新及后端数据一致性。
