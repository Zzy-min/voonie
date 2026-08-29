import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("voice recording exposes live status, finish, and cancel controls", async () => {
  const source = await readFile(path.join(root, "app", "page.tsx"), "utf8");

  assert.match(source, /role="status"/);
  assert.match(source, /正在监听/);
  assert.match(source, /正在等待麦克风权限/);
  assert.match(source, /结束并识别/);
  assert.match(source, /取消录音/);
  assert.match(source, /recordingSeconds/);
  assert.match(source, /SpeechRecognition/);
  assert.match(source, /麦克风监听已中断/);
  assert.match(source, /speechFinalTextRef/);
  assert.match(source, /event\.resultIndex/);
  assert.match(source, /result\.isFinal/);
  assert.match(source, /requestVersion === microphoneRequestRef\.current/);
  assert.match(source, /speechRecognitionRef\.current !== recognition/);
  assert.match(source, /Could not resume Web Speech API/);
  assert.match(source, /recordingActiveRef\.current/);
  assert.match(source, /recorderRef\.current !== recorder/);
  assert.match(source, /const showCreateScreen = \(\) => \{\s*screenRef\.current = "create";\s*setScreen\("create"\);/);
  assert.match(source, /setCreateError\(""\);\s*requestingMicrophoneRef\.current = true;/);
  assert.match(source, /mountedRef\.current = true/);
  assert.match(source, /requestingMicrophone \|\| recording/);
  assert.match(source, /MediaRecorder\.isTypeSupported/);
  assert.match(source, /audioBitsPerSecond:\s*48_000/);
  assert.match(source, /new MediaRecorder\(stream, recorderOptions\)/);
});

test("illustrated diary keeps one reading flow and anchors images to diary text", async () => {
  const source = await readFile(path.join(root, "app", "page.tsx"), "utf8");
  const api = await readFile(path.join(root, "lib", "api.ts"), "utf8");

  assert.match(source, /图文日记/);
  assert.match(source, /emotionCurve/);
  assert.match(source, /anchorText/);
  assert.match(source, /sourceExcerpt/);
  assert.match(source, /panel\.source_excerpt \|\| panel\.anchor_text \|\| panel\.narration/);
  assert.match(source, /已记录.*篇日记/);
  assert.match(source, /生成图文日记/);
  assert.doesNotMatch(source, /浏览模式切换/);
  assert.doesNotMatch(source, /翻页绘本/);
  assert.match(api, /organized_diary/);
  assert.match(api, /emotion_curve/);
});

test("uses the cleaned Voonie v2 identity assets without repeating sprite cells", async () => {
  const source = await readFile(path.join(root, "app", "page.tsx"), "utf8");

  assert.match(source, /voonie-mascot-main-v2\.png/);
  assert.match(source, /voonie-mascot-poses-v2\.png/);
  assert.match(source, /backgroundRepeat:\s*"no-repeat"/);
});

test("image generation failures keep provider internals out of the UI", async () => {
  const { friendlyGenerationError } = await vite.ssrLoadModule("/lib/api.ts");
  const message = friendlyGenerationError(
    "HTTPStatusError: Client error '400 Bad Request' for url 'https://ark.cn-beijing.volces.com/api/v3/images/generations'",
  );

  assert.match(message, /日记文字已保留/);
  assert.doesNotMatch(message, /HTTPStatusError|ark\.cn-beijing|images\/generations/);
});

test("mobile experience uses safe areas, bottom navigation, and dedicated memory views", async () => {
  const source = await readFile(path.join(root, "app", "page.tsx"), "utf8");
  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");
  const layout = await readFile(path.join(root, "app", "layout.tsx"), "utf8");

  assert.match(source, /className="mobile-bottom-nav"/);
  assert.match(source, /"history"/);
  assert.match(source, /"search"/);
  assert.match(source, /className="memory-feed"/);
  assert.match(source, /className="mobile-search-surface"/);
  assert.match(source, /window\.scrollTo\(\{ top: 0/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /100dvh/);
  assert.match(css, /@media \(width <= 767px\)/);
  assert.match(css, /--touch-target: 44px/);
  assert.match(
    css,
    /\.story-workspace \.flow-topbar\s*\{[^}]*box-sizing:\s*border-box/s,
  );
  assert.match(
    css,
    /\.story-workspace \.save-story-btn-top\s*\{[^}]*box-sizing:\s*border-box/s,
  );
  assert.match(layout, /viewportFit: "cover"/);
});

test("mobile journal header keeps destructive actions in an overflow menu", async () => {
  const source = await readFile(path.join(root, "app", "page.tsx"), "utf8");
  const css = await readFile(path.join(root, "app", "globals.css"), "utf8");

  assert.match(source, /className="story-more-btn"/);
  assert.match(source, /aria-expanded=\{storyMenuOpen\}/);
  assert.match(source, /className="story-action-menu"/);
  assert.match(source, /save-label-mobile[^>]*>完成<\/span>/);
  assert.match(css, /\.story-workspace \.delete-story-btn-top\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.story-action-menu\s*\{[^}]*position:\s*absolute/s);
});

test("emits Voonie's responsive flow and loading styles", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /\.voice-diary-card/);
  assert.match(css, /\.generating-state/);
  assert.match(css, /\.storybook-scene img/);
  assert.match(css, /@media \(width<=760px\)/);
  assert.match(css, /@keyframes loading-bar/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("labels authentication fields for password managers", async () => {
  const { AuthModal } = await vite.ssrLoadModule("/components/AuthModal.tsx");
  const html = renderToStaticMarkup(
    React.createElement(AuthModal, {
      open: true,
      onClose() {},
      onSuccess() {},
      initialMode: "login",
    }),
  );

  assert.match(html, /autocomplete="email"/i);
  assert.match(html, /autocomplete="current-password"/i);
  assert.doesNotMatch(html, /aria-label="显示密码"[^>]*tabindex="-1"/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});
