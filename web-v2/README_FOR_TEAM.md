# Voonie 前端 UI

这是 Voonie 黑客松项目的电脑端前端代码，目前包含：

- 首页仪表盘
- Voonie 透明小狗与多种姿势
- 右下角宠物聊天窗口
- 页面主题编辑功能
- 图文日记创建界面
- 生成中的前端动画
- 三页电子绘本与翻页交互

当前“生成日记”使用前端假数据，没有接入后端、数据库、语音识别或真实 AI 生图接口。

## 运行方法

电脑需要先安装 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

然后打开终端显示的本地网址。

## 主要文件

- `app/page.tsx`：页面结构、交互和假数据
- `app/globals.css`：全部页面样式
- `public/voonie-mascot-poses.png`：小狗九宫格动作图
- `public/voonie-sleep.png`：完整透明背景的睡觉姿势
- `package.json`：项目依赖和运行命令

## 后端接入位置

目前点击“生成我的图文日记”后，会使用定时器模拟生成过程。后端完成后，可在 `app/page.tsx` 中搜索 `generateDiary`，把模拟逻辑替换为接口请求。

建议后端返回：

```json
{
  "title": "放学路上的小小相遇",
  "date": "2026-08-27",
  "mood": "开心",
  "pages": [
    {
      "text": "日记文字",
      "imageUrl": "生成图片地址"
    }
  ]
}
```
