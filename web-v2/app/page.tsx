"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookHeart,
  CalendarDays,
  Camera,
  ChevronRight,
  CircleUserRound,
  Edit3,
  FileText,
  Home,
  Image as ImageIcon,
  LibraryBig,
  LoaderCircle,
  Mic,
  MoreHorizontal,
  Palette,
  PawPrint,
  PenLine,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Download,
  WandSparkles,
  User,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DesktopPet } from "@/components/DesktopPet";
import { AuthModal } from "@/components/AuthModal";
import {
  chatWithPet,
  createComicJob,
  createTextEntry,
  createVoiceEntry,
  deleteEntry,
  ensureSession,
  listDiaries,
  listEntries,
  regenerateDiaryPanel,
  updateTextEntry,
  waitForJob,
  type JobStatus,
  deleteMyData,
  exportMyData,
  friendlyGenerationError,
  getPreferences,
  updatePreferences,
  mediaUrl,
  getCurrentUser,
  logoutUser,
  newLocalId,
  type UserProfile,
} from "@/lib/api";
import { cancelJob } from "@/lib/api";
import { deleteDiary } from "@/lib/api";

const navItems = [
  { label: "首页", icon: Home },
  { label: "情绪记录", icon: BookHeart },
  { label: "我的日记", icon: LibraryBig },
  { label: "回忆日历", icon: CalendarDays },
  { label: "个人中心", icon: CircleUserRound },
];

type AppScreen =
  | "home"
  | "create"
  | "history"
  | "search"
  | "book"
  | "mood"
  | "calendar"
  | "profile";

const mobileNavItems = [
  { label: "首页", icon: Home, screen: "home" as const },
  { label: "回忆", icon: LibraryBig, screen: "history" as const },
  { label: "记录", icon: Mic, screen: "create" as const, primary: true },
  { label: "情绪", icon: BookHeart, screen: "mood" as const },
  { label: "我的", icon: CircleUserRound, screen: "profile" as const },
];

const defaultSettings = {
  nickname: "小主人",
  quote: "生活或许忙碌，但记得停下来，听一听自己的声音。",
  quoteNote: "今天也值得被好好收藏。",
  accent: "#d9845b",
  dogSize: 100,
  showBooks: true,
  showMood: true,
};

type PageSettings = typeof defaultSettings;

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
  }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function loadPageSettings(): PageSettings {
  if (typeof window === "undefined") return defaultSettings;
  const saved = window.localStorage.getItem("voonie-page-settings");
  if (!saved) return defaultSettings;
  try {
    const parsed = { ...defaultSettings, ...JSON.parse(saved) };
    if (parsed.accent === "#7b441d") parsed.accent = defaultSettings.accent;
    return parsed;
  } catch {
    window.localStorage.removeItem("voonie-page-settings");
    return defaultSettings;
  }
}

type DogPose =
  | "portrait"
  | "sit"
  | "stand"
  | "rest"
  | "play"
  | "wave"
  | "run"
  | "happy"
  | "look"
  | "sleep";

const dogPosePosition: Record<Exclude<DogPose, "portrait">, string> = {
  sit: "0% 0%",
  stand: "50% 0%",
  rest: "100% 0%",
  play: "0% 50%",
  wave: "50% 50%",
  run: "100% 50%",
  happy: "0% 100%",
  look: "50% 100%",
  sleep: "100% 100%",
};

function VoonieDog({
  pose = "sit",
  className = "",
}: {
  pose?: DogPose;
  className?: string;
}) {
  const portrait = pose === "portrait";
  const style = {
    backgroundImage: `url(${portrait ? "/voonie-mascot-main-v2.png" : "/voonie-mascot-poses-v2.png"})`,
    backgroundSize: portrait ? "contain" : "300% 300%",
    backgroundPosition: portrait ? "center" : dogPosePosition[pose],
    backgroundRepeat: "no-repeat",
  };
  return (
    <span
      className={`voonie-dog ${pose} ${className}`}
      style={style}
      role="img"
      aria-label="Voonie 小狗"
    />
  );
}

type ChatMsg = {
  from: "bot" | "user";
  text: string;
  action?: DogPose;
  referencedMemories?: string[];
};

function getDefaultGreeting(name: string): ChatMsg {
  const hour = new Date().getHours();
  const timeWord =
    hour < 6
      ? "夜深啦"
      : hour < 11
        ? "早安"
        : hour < 14
          ? "中午好"
          : hour < 18
            ? "下午好"
            : "晚上好";
  const pose: DogPose = hour < 6 ? "sleep" : hour < 18 ? "wave" : "happy";
  return {
    from: "bot",
    text: `${timeWord}，${name || "小主人"}！今天有什么想和我聊聊的吗？🐾`,
    action: pose,
  };
}

async function compressImageFileToDataUrl(file: File, maxDim = 1024, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } else {
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

function DiaryCreator({
  text,
  setText,
  recording,
  requestingMicrophone,
  recordingSeconds,
  audioBars,
  generating,
  generatingHint,
  error,
  onGenerate,
  onSaveTextOnly,
  onRecord,
  onCancelRecording,
  onCancel,
  onBack,
}: {
  text: string;
  setText: (value: string) => void;
  recording: boolean;
  requestingMicrophone: boolean;
  recordingSeconds: number;
  audioBars: number[];
  generating: boolean;
  generatingHint: string;
  error: string;
  onGenerate: (refImageB64?: string, stylePreset?: string) => void;
  onSaveTextOnly?: () => void | Promise<void>;
  onRecord: () => void;
  onCancelRecording: () => void;
  onCancel?: () => void | Promise<void>;
  onBack: () => void;
}) {
  const isVoiceConverting = generatingHint.includes("语音转成文字");
  const [selectedStyle, setSelectedStyle] = useState("chibi_manga");
  const [refImage, setRefImage] = useState<string | null>(null);
  const [refImageName, setRefImageName] = useState<string | null>(null);
  const [compressingImage, setCompressingImage] = useState(false);

  return (
    <section className="workspace flow-workspace">
      <header className="flow-topbar">
        <button onClick={onBack} aria-label="返回首页">
          <ArrowLeft size={18} />
          返回首页
        </button>
        <div>
          <span>倾诉今天的日常</span>
          <small>自然说出今天发生的事，Voonie 会为你整理成完整日记并画下重要瞬间🐾</small>
        </div>
      </header>
      <div className="flow-shell">
        <div className="flow-progress">
          <div className="active">
            <b>1</b>
            <span>倾诉今天</span>
          </div>
          <i />
          <div className={generating && !isVoiceConverting ? "active" : ""}>
            <b>2</b>
            <span>整理与配图</span>
          </div>
          <i />
          <div>
            <b>3</b>
            <span>图文手帐</span>
          </div>
        </div>
        <section className="voice-diary-card">
          {generating ? (
            <div className="generating-state" role="status" aria-live="polite">
              <LoaderCircle size={40} className="animate-spin text-primary" />
              <h2>{isVoiceConverting ? "正在把语音转成文字…" : "正在整理日记并提炼记忆画面…"}</h2>
              <p>
                {generatingHint ||
                  (isVoiceConverting
                    ? "Voonie 正在认真听你说的话并整理成日记。"
                    : "Voonie 正在保留你的完整经历，并挑选最值得记住的瞬间画成插图。")}
              </p>
              <div className="generating-bars">
                <span />
                <span />
                <span />
              </div>
              {onCancel ? (
                <button
                  className="voice-record cancel-generating-btn"
                  onClick={onCancel}
                  style={{ marginTop: "24px" }}
                >
                  <X size={18} />
                  {isVoiceConverting ? "取消识别" : "取消生成"}
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="voice-card-heading">
                <VoonieDog pose="wave" />
                <div>
                  <span className="eyebrow">
                    <Sparkles size={14} />
                    说给 Voonie 听吧
                  </span>
                  <h1>自然倾诉，无需组织语言</h1>
                  <p>像和贴心朋友聊天一样说出来，停顿、重复、琐碎细节都完全没问题🐾</p>
                </div>
              </div>
              <div className="inspiration-chips">
                <span className="inspiration-label">💡 倾诉灵感：</span>
                {[
                  "今天最想记住什么？",
                  "什么时候心情变了？",
                  "有没有一个小细节留在脑海里？",
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="prompt-chip-btn"
                    onClick={() => setText(text ? `${text} ${chip}` : chip)}
                    title="点击填入灵感提示"
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <div className="style-preset-chips">
                <span className="inspiration-label">🎨 手帐画风：</span>
                {[
                  { id: "chibi_manga", label: "🐾 经典手绘" },
                  { id: "warm_watercolor", label: "🌸 治愈水彩" },
                  { id: "anime_cel", label: "✨ 暖光插画" },
                  { id: "retro_comic", label: "📜 复古手帐" },
                ].map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    className={`chip-btn ${selectedStyle === style.id ? "active-style-chip" : ""}`}
                    onClick={() => setSelectedStyle(style.id)}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
              <label className="diary-input">
                <div className="input-header-row">
                  <span>倾诉记录与文字整理</span>
                  {text ? (
                    <div className="input-tools">
                      <span className="char-count">{text.length} 字</span>
                      <button
                        type="button"
                        className="clear-text-btn"
                        onClick={() => setText("")}
                      >
                        清空
                      </button>
                    </div>
                  ) : null}
                </div>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={7}
                  placeholder="例如：今天上午其实挺烦的，组里开会的时候准备的东西没有讲好。不过下午老师夸了一下我的作业，心情又好起来了。晚上回来的路上晚霞特别美……"
                />
              </label>
              <div className="photo-ref-row">
                <input
                  type="file"
                  id="diary-photo-input"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setCompressingImage(true);
                      try {
                        const compressed = await compressImageFileToDataUrl(file);
                        setRefImage(compressed);
                        setRefImageName(file.name);
                      } catch {
                        // fallback
                        const reader = new FileReader();
                        reader.onload = () => {
                          setRefImage(reader.result as string);
                          setRefImageName(file.name);
                        };
                        reader.readAsDataURL(file);
                      } finally {
                        setCompressingImage(false);
                      }
                    }
                  }}
                />
                {compressingImage ? (
                  <div className="photo-ref-preview">
                    <LoaderCircle size={15} className="animate-spin" />
                    <span className="photo-name">正在优化参考照片…</span>
                  </div>
                ) : refImage ? (
                  <div className="photo-ref-preview">
                    <img src={refImage} alt="参考照片" />
                    <span className="photo-name">{refImageName || "已添加参考照片"}</span>
                    <button
                      type="button"
                      className="remove-photo-btn"
                      onClick={() => {
                        setRefImage(null);
                        setRefImageName(null);
                      }}
                      aria-label="移除参考照片"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <label htmlFor="diary-photo-input" className="add-photo-btn">
                    <Camera size={15} />
                    <span>添加生活照片垫图（可选）</span>
                  </label>
                )}
              </div>
              <div className="voice-actions">
                {requestingMicrophone ? (
                  <div className="recording-controls" role="status" aria-live="polite">
                    <span className="listening-indicator">
                      <LoaderCircle size={17} className="animate-spin" />
                      正在等待麦克风权限…
                    </span>
                    <button className="cancel-recording" onClick={onCancelRecording} aria-label="取消麦克风授权">
                      <X size={17} />
                      取消
                    </button>
                  </div>
                ) : recording ? (
                  <div className="recording-controls" role="status" aria-live="polite">
                    <div className="listening-badge">
                      <span className="live-dot" />
                      <span className="live-text">正在监听 {formatDuration(recordingSeconds)}</span>
                      <div className="audio-wave-bars" aria-hidden="true">
                        {audioBars.map((height, i) => (
                          <span key={i} style={{ height: `${height}%` }} />
                        ))}
                      </div>
                    </div>
                    <span className="quiet-listener-note">我在听，慢慢说。停顿也没关系。</span>
                    <button className="voice-record recording" onClick={onRecord} aria-label="结束录音并识别文字">
                      <Mic size={19} />
                      结束并识别
                    </button>
                    <button className="cancel-recording" onClick={onCancelRecording} aria-label="取消录音">
                      <X size={17} />
                      取消录音
                    </button>
                  </div>
                ) : (
                  <button className="voice-record" onClick={onRecord} aria-label="点击开始说话">
                    <Mic size={19} />
                    点击开始说话
                  </button>
                )}
                {onSaveTextOnly ? (
                  <button
                    type="button"
                    className="save-text-only-btn"
                    disabled={!text.trim() || generating || requestingMicrophone || recording}
                    onClick={onSaveTextOnly}
                    title="无需等待绘本生成，直接保存文字日记"
                  >
                    <FileText size={17} />
                    <span>仅保存日记</span>
                  </button>
                ) : null}
                <button
                  className="generate-diary"
                  disabled={!text.trim() || generating || requestingMicrophone || recording}
                  onClick={() => onGenerate(refImage || undefined, selectedStyle)}
                  aria-label="生成图文日记"
                >
                  <WandSparkles size={19} />
                  生成图文日记
                </button>
              </div>
              {error ? (
                <p className="mock-hint error-hint" role="alert" style={{ color: "#d94f45", marginTop: "12px", textAlign: "center" }}>
                  {error}
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

type StoryPage = {
  jobId?: string;
  entryId?: string;
  title: string;
  mood: string;
  note: string;
  dateLabel: string;
  cover?: string | null;
  rawTranscript?: string;
  emotionCurve?: Array<{ label: string; intensity: number; evidence: string }>;
  keyQuote?: string | null;
  isTextOnly?: boolean;
  pages: Array<{
    text: string;
    imageUrl?: string | null;
    panelNo?: number;
    sourceExcerpt?: string;
    anchorText?: string;
    emotionLabel?: string;
    visualReason?: string;
    pageType?: "visual" | "graphic_text" | "text_only" | "memory";
  }>;
};

function formatDateLabel(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

function toStory(diary: {
  title: string;
  companion_note: string;
  emotion: { emotion_label_zh: string; mood_score: number };
  panels: Array<{
    image_url?: string | null;
    narration?: string | null;
    speech_bubble?: { text?: string } | null;
    source_excerpt?: string;
    anchor_text?: string;
    emotion_label?: string;
    visual_reason?: string;
  }>;
  organized_diary?: string;
  emotion_curve?: Array<{ label: string; intensity: number; evidence: string }>;
  key_quote?: string | null;
  composite_comic_url?: string | null;
  created_at: string;
  job_id?: string;
  entry_id?: string;
  raw_transcript?: string;
}): StoryPage {
  const pages = diary.panels.map((panel, index) => {
      const text = panel.source_excerpt || panel.anchor_text || panel.narration || panel.speech_bubble?.text || diary.companion_note;
      const pageType: "visual" | "graphic_text" = text.length > 30 ? "graphic_text" : "visual";
      return {
        text,
        imageUrl: mediaUrl(panel.image_url),
        panelNo: index + 1,
        sourceExcerpt: panel.source_excerpt,
        anchorText: panel.anchor_text,
        emotionLabel: panel.emotion_label,
        visualReason: panel.visual_reason,
        pageType,
      };
    });
  return {
    jobId: diary.job_id,
    entryId: diary.entry_id,
    title: diary.title,
    mood: `${diary.emotion.emotion_label_zh} ${diary.emotion.mood_score * 10}%`,
    note: diary.companion_note,
    dateLabel: formatDateLabel(diary.created_at),
    cover: mediaUrl(diary.panels[0]?.image_url ?? diary.composite_comic_url),
    rawTranscript: diary.organized_diary || diary.raw_transcript,
    emotionCurve: diary.emotion_curve,
    keyQuote: diary.key_quote,
    isTextOnly: false,
    pages,
  };
}

function jobToStory(job: JobStatus): StoryPage {
  const result = job.result!;
  return toStory({
    job_id: job.job_id,
    entry_id: result.entry_id,
    title: result.title ?? "今天的日记",
    companion_note: result.companion_note ?? "",
    emotion: {
      emotion_label_zh: result.emotion?.emotion_label_zh ?? "记录",
      mood_score: result.emotion?.mood_score ?? 7,
    },
    panels: result.panels ?? [],
    organized_diary: result.organized_diary,
    emotion_curve: result.emotion_curve,
    key_quote: result.key_quote,
    composite_comic_url: result.composite_comic_url,
    created_at: new Date().toISOString(),
    raw_transcript: result.raw_transcript,
  });
}

function StoryBook({
  story,
  onBack,
  onHome,
  onRegeneratePanel,
  onDelete,
  onUpdateDiaryText,
  onGenerateComicForDiary,
}: {
  story: StoryPage | null;
  onBack: () => void;
  onHome: () => void;
  onRegeneratePanel?: (panelNo: number, customPrompt?: string) => Promise<void>;
  onDelete?: (jobId?: string, entryId?: string) => Promise<void>;
  onUpdateDiaryText?: (newText: string, regenerateComic?: boolean) => Promise<void>;
  onGenerateComicForDiary?: (entryId?: string, text?: string) => void;
}) {
  const [viewMode] = useState<"techo" | "comic">("techo");
  const [page, setPage] = useState(0);
  const [regeneratingPanel, setRegeneratingPanel] = useState<number | null>(null);
  const [regenError, setRegenError] = useState("");
  const [storyMenuOpen, setStoryMenuOpen] = useState(false);

  // Techo original diary editor state
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(story?.rawTranscript || story?.note || "");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  const pages = story?.pages ?? [];
  const lastPage = Math.max(pages.length - 1, 0);

  const handleRegen = async (panelNo: number) => {
    if (!onRegeneratePanel || regeneratingPanel !== null) return;
    setRegeneratingPanel(panelNo);
    setRegenError("");
    try {
      await onRegeneratePanel(panelNo);
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : "重绘失败，请重试");
    } finally {
      setRegeneratingPanel(null);
    }
  };

  const rawDiaryContent = story?.rawTranscript || story?.note || "今天写下的美好时光…";

  // Build Interleaved Techo elements
  const paragraphs = rawDiaryContent
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const illustrations = pages
    .map((p, idx) => ({ ...p, originalIndex: idx }))
    .filter((p) => Boolean(p.imageUrl));

  const interleavedItems: Array<
    | { type: "paragraph"; content: string; key: string }
    | {
        type: "illustration";
        imageUrl: string;
        caption: string;
        index: number;
        emotionLabel?: string;
        visualReason?: string;
        key: string;
      }
  > = [];

  if (paragraphs.length === 0) {
    interleavedItems.push({
      type: "paragraph",
      content: rawDiaryContent,
      key: "para-0",
    });
  } else if (illustrations.length === 0) {
    paragraphs.forEach((p, i) => {
      interleavedItems.push({
        type: "paragraph",
        content: p,
        key: `para-${i}`,
      });
    });
  } else {
    const normalizeAnchor = (value?: string) =>
      (value || "").replace(/[\s，。！？、,.!?；;：:]/g, "");
    const placement = new Map<number, typeof illustrations>();
    illustrations.forEach((illustration, imgIdx) => {
      const candidates = [illustration.anchorText, illustration.sourceExcerpt]
        .map(normalizeAnchor)
        .filter(Boolean);
      let bestIndex = -1;
      let bestScore = 0;
      paragraphs.forEach((paragraph, paragraphIndex) => {
        const normalizedParagraph = normalizeAnchor(paragraph);
        candidates.forEach((candidate) => {
          const score = normalizedParagraph.includes(candidate)
            ? candidate.length
            : candidate.includes(normalizedParagraph)
              ? normalizedParagraph.length
              : 0;
          if (score > bestScore) {
            bestScore = score;
            bestIndex = paragraphIndex;
          }
        });
      });
      if (bestIndex < 0) {
        bestIndex = Math.min(
          paragraphs.length - 1,
          Math.floor(((imgIdx + 1) * paragraphs.length) / (illustrations.length + 1)),
        );
      }
      placement.set(bestIndex, [...(placement.get(bestIndex) || []), illustration]);
    });
    paragraphs.forEach((para, pIdx) => {
      interleavedItems.push({
        type: "paragraph",
        content: para,
        key: `para-${pIdx}`,
      });
      (placement.get(pIdx) || []).forEach((illust) => {
        interleavedItems.push({
          type: "illustration",
          imageUrl: illust.imageUrl!,
          caption: illust.text || `记忆瞬间 #${illust.panelNo ?? illust.originalIndex + 1}`,
          index: illust.panelNo ?? illust.originalIndex + 1,
          emotionLabel: illust.emotionLabel,
          visualReason: illust.visualReason,
          key: `illust-${illust.panelNo ?? illust.originalIndex + 1}`,
        });
      });
    });
  }

  return (
    <section className="workspace flow-workspace story-workspace">
      <header className="flow-topbar">
        <button
          className="flow-back-btn"
          type="button"
          onClick={onBack}
          aria-label="重新创作"
        >
          <ArrowLeft size={16} />
          <span>重新创作</span>
        </button>
        <div className="flow-title-center">
          <strong className="journal-view-label"><FileText size={14} /> 图文日记</strong>
          <p>
            {story?.dateLabel ?? "刚刚"} · 今日心情 #{story?.mood ?? "平静"}
          </p>
        </div>
        <div className="flow-actions-right">
          {onDelete && (story?.jobId || story?.entryId) ? (
            <>
              <button
                className="delete-story-btn-top"
                onClick={() => onDelete(story.jobId, story.entryId)}
                title="删除这篇记录"
              >
                <Trash2 size={15} />
                <span>删除记录</span>
              </button>
              <div className="story-more-wrap">
                <button
                  type="button"
                  className="story-more-btn"
                  aria-label="更多日记操作"
                  aria-expanded={storyMenuOpen}
                  onClick={() => setStoryMenuOpen((open) => !open)}
                >
                  <MoreHorizontal size={20} />
                </button>
                {storyMenuOpen ? (
                  <div className="story-action-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setStoryMenuOpen(false);
                        void onDelete(story.jobId, story.entryId);
                      }}
                    >
                      <Trash2 size={16} />
                      <span>删除这篇日记</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          <button
            className="save-story-btn-top"
            type="button"
            onClick={onHome}
            aria-label="保存并返回"
          >
            <Save size={16} />
            <span className="save-label-desktop">保存并返回</span>
            <span className="save-label-mobile">完成</span>
          </button>
        </div>
      </header>

      {viewMode === "techo" ? (
        <div className="storybook-shell">
          <article className="techo-paper-spread">
            <div className="washi-tape-decoration" aria-hidden="true" />
            <div className="techo-header">
              <div className="techo-date-stamp">
                <CalendarDays size={16} />
                <span>{story?.dateLabel ?? "今天"}</span>
                <span className="techo-time-dot">·</span>
                <span className="techo-mood-chip">#{story?.mood ?? "平静"}</span>
              </div>
              <div className="techo-word-count">
                <span>共 {rawDiaryContent.length} 字</span>
              </div>
            </div>

            <div className="techo-mood-curve-bar" aria-label="今天的情绪轨迹">
              <span className="mood-curve-title">🌱 情绪轨迹</span>
              <div className="mood-curve-flow">
                {(story?.emotionCurve?.length ? story.emotionCurve : [{ label: story?.mood ?? "平静", intensity: 5, evidence: "" }]).map((point, index) => (
                  <span key={`${point.label}-${index}`} className="techo-mood-curve-chip" title={point.evidence}>
                    {index > 0 && <span className="curve-arrow">→</span>}
                    <b>{point.label}</b>
                  </span>
                ))}
              </div>
              <span className="mood-curve-pill">
                {illustrations.length > 0 ? `✨ ${illustrations.length} 幅插画` : "📝 纯文字"}
              </span>
            </div>

            <div className="techo-content-area">
              {isEditing ? (
                <div className="techo-editor-wrapper">
                  <textarea
                    className="techo-textarea"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={10}
                    placeholder="写下你真实的心情与经历…"
                    aria-label="修改日记原文"
                  />
                  {editError ? (
                    <small style={{ color: "#ba4030", fontWeight: 700 }}>{editError}</small>
                  ) : null}
                  <div className="techo-edit-actions">
                    <button
                      type="button"
                      className="techo-btn secondary"
                      onClick={() => {
                        setIsEditing(false);
                        setEditText(rawDiaryContent);
                      }}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="techo-btn primary"
                      disabled={!editText.trim() || savingEdit}
                      onClick={async () => {
                        setSavingEdit(true);
                        setEditError("");
                        try {
                          if (onUpdateDiaryText) await onUpdateDiaryText(editText, false);
                          setIsEditing(false);
                        } catch (e) {
                          setEditError(e instanceof Error ? e.message : "保存失败，请重试");
                        } finally {
                          setSavingEdit(false);
                        }
                      }}
                    >
                      {savingEdit ? "保存中…" : "保存修改"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="techo-interleaved-container">
                  {interleavedItems.map((item) => {
                    if (item.type === "paragraph") {
                      return (
                        <p key={item.key} className="techo-para-unit">
                          {item.content}
                        </p>
                      );
                    }
                    return (
                      <figure key={item.key} className="techo-moment-card">
                        <div className="techo-moment-pin" aria-hidden="true" />
                        <div className="techo-moment-img-wrapper">
                          <img src={item.imageUrl} alt={item.caption} />
                          {regeneratingPanel === item.index ? (
                            <div className="scene-regen-overlay">
                              <LoaderCircle size={24} className="animate-spin" />
                              <span>正在重绘…</span>
                            </div>
                          ) : null}
                        </div>
                        <figcaption className="techo-moment-footer">
                          <span className="techo-moment-caption">
                            ✦ {item.emotionLabel ? `${item.emotionLabel} · ` : ""}{item.caption}
                            {item.visualReason ? <small>{item.visualReason}</small> : null}
                          </span>
                          {onRegeneratePanel && story?.jobId ? (
                            <button
                              type="button"
                              className="techo-moment-regen"
                              disabled={regeneratingPanel === item.index}
                              onClick={() => handleRegen(item.index)}
                              title="对插画不满意？重新绘制此幕"
                            >
                              <RefreshCw
                                size={12}
                                className={regeneratingPanel === item.index ? "animate-spin" : ""}
                              />
                              <span>{regeneratingPanel === item.index ? "绘制中…" : "重绘此幕"}</span>
                            </button>
                          ) : null}
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              )}
            </div>

            {story?.keyQuote ? (
              <blockquote className="techo-key-quote">“{story.keyQuote}”</blockquote>
            ) : null}

            {story?.note ? (
              <div className="techo-sticker-note">
                <div className="sticker-body">
                  <VoonieDog pose="happy" className="sticker-dog" />
                  <div>
                    <b>🐾 Voonie 的治愈便签</b>
                    <p>{story.note}</p>
                  </div>
                </div>
              </div>
            ) : null}

            {!isEditing ? (
              <div className="techo-footer-actions">
                <button
                  type="button"
                  className="techo-edit-btn"
                  onClick={() => {
                    setEditText(rawDiaryContent);
                    setIsEditing(true);
                  }}
                >
                  <Edit3 size={15} />
                  <span>编辑日记</span>
                </button>

                {story?.isTextOnly || (!story?.pages || story?.pages.length === 0) ? (
                  <button
                    type="button"
                    className="techo-generate-comic-btn"
                    onClick={() => onGenerateComicForDiary?.(story?.entryId, rawDiaryContent)}
                  >
                    <WandSparkles size={16} />
                    <span>🎨 画成图文手帐</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="techo-regenerate-comic-btn"
                    onClick={() => onGenerateComicForDiary?.(story?.entryId, rawDiaryContent)}
                    title="根据当前日记重新提炼记忆瞬间并生成插画"
                  >
                    <Sparkles size={15} />
                    <span>重新生成插图</span>
                  </button>
                )}
              </div>
            ) : null}
          </article>
        </div>
      ) : (
        <div className="storybook-shell">
          {!story || story.isTextOnly || pages.length === 0 ? (
            <div className="storybook page-0">
              <div className="book-cover">
                <div className="cover-copy">
                  <span>Voonie 日记</span>
                  <h1>{story?.title ?? "纯文字日记"}</h1>
                  <p>这篇日记还没有插图，可以随时提炼值得画下来的记忆瞬间。</p>
                  <button
                    type="button"
                    className="save-story-btn-top"
                    style={{ marginTop: "16px" }}
                    onClick={() => onGenerateComicForDiary?.(story?.entryId, rawDiaryContent)}
                  >
                    <WandSparkles size={16} />
                    <span>🎨 生成记忆插图</span>
                  </button>
                </div>
                <VoonieDog pose="wave" />
              </div>
            </div>
          ) : (
            <div className={`storybook page-${page}`}>
              {page === 0 && (
                <div className="book-cover">
                  <div className="cover-copy">
                    <span>Voonie 日记</span>
                    <h1>{story.title}</h1>
                    <p>{story.note}</p>
                  </div>
                  {story.cover ? (
                    <img
                      className="hero-dog"
                      src={story.cover}
                      alt={`${story.title}的绘本封面`}
                    />
                  ) : (
                    <VoonieDog pose="sleep" />
                  )}
                </div>
              )}
              {page > 0 && pages[page] && (
                <div
                  className={`book-spread ${page === lastPage ? "final-spread" : ""} spread-type-${pages[page].pageType || "visual"}`}
                >
                  <div className="book-text">
                    <div className="spread-title-row">
                      <span>{String(page).padStart(2, "0")} · 今天的故事</span>
                      {onRegeneratePanel && story?.jobId ? (
                        <button
                          className="regen-panel-btn"
                          disabled={regeneratingPanel === page}
                          onClick={() => handleRegen(page)}
                          title="对当前这幕画面不满意？点击重新绘制"
                        >
                          <RefreshCw size={13} className={regeneratingPanel === page ? "animate-spin" : ""} />
                          <span>{regeneratingPanel === page ? "绘制中…" : "重新绘制本幕"}</span>
                        </button>
                      ) : null}
                    </div>
                    <p>{pages[page].text}</p>
                    {regenError && (
                      <small className="regen-error-hint">{regenError}</small>
                    )}
                    {page === lastPage && (
                      <div className="mood-stamp">今日心情 · {story.mood}</div>
                    )}
                  </div>
                  <div className="storybook-scene meadow" style={{ position: "relative" }}>
                    {pages[page].imageUrl ? (
                      <img
                        src={pages[page].imageUrl}
                        alt={`第 ${page + 1} 页插图：${pages[page].text}`}
                      />
                    ) : (
                      <VoonieDog pose={page === lastPage ? "look" : "play"} />
                    )}
                    {regeneratingPanel === page && (
                      <div className="scene-regen-overlay">
                        <LoaderCircle size={28} className="animate-spin" />
                        <span>正在重新绘制…</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="page-number">
                {page + 1} / {pages.length || 1}
              </div>
            </div>
          )}
          {pages.length > 0 && story && !story.isTextOnly && (
            <div className="book-controls">
              <button
                aria-label="上一页"
                disabled={!story || page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ArrowLeft />
              </button>
              <div>
                {(story?.pages ?? [null]).map((_, item) => (
                  <button
                    key={item}
                    className={page === item ? "active" : ""}
                    aria-label={`第 ${item + 1} 页`}
                    onClick={() => setPage(item)}
                  />
                ))}
              </div>
              <button
                aria-label="下一页"
                disabled={!story || page >= lastPage}
                onClick={() => setPage(page + 1)}
              >
                <ArrowRight />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function HomePage() {
  const [active, setActive] = useState("首页");
  const [screen, setScreen] = useState<AppScreen>("home");
  const [chatOpen, setChatOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [requestingMicrophone, setRequestingMicrophone] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [message, setMessage] = useState("");
  const [chatSubmitting, setChatSubmitting] = useState(false);
  const chatSubmittingRef = useRef(false);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const [chatRecording, setChatRecording] = useState(false);
  const chatRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>(() => [
    getDefaultGreeting(loadPageSettings().nickname),
  ]);
  const [diaryText, setDiaryText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatingHint, setGeneratingHint] = useState("");
  const [createError, setCreateError] = useState("");
  const [chatError, setChatError] = useState("");
  const [records, setRecords] = useState<StoryPage[]>([]);
  const [currentStory, setCurrentStory] = useState<StoryPage | null>(null);
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<PageSettings>(loadPageSettings);
  const [draft, setDraft] = useState<PageSettings>(loadPageSettings);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recordingActiveRef = useRef(false);
  const speechRecognizedRef = useRef(false);
  const speechBaseTextRef = useRef("");
  const speechFinalTextRef = useRef("");
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const discardRecordingRef = useRef(false);
  const requestingMicrophoneRef = useRef(false);
  const microphoneRequestRef = useRef(0);
  const voiceUploadAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const screenRef = useRef(screen);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<"login" | "register">("login");
  const [draftEntryId, setDraftEntryId] = useState<string | null>(null);
  const [memoryOptIn, setMemoryOptIn] = useState(false);
  const [profileHint, setProfileHint] = useState("");
  const [notificationHint, setNotificationHint] = useState("");
  const [loadError, setLoadError] = useState("");
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [moodFilter, setMoodFilter] = useState<string>("全部");
  const [calendarDateFilter, setCalendarDateFilter] = useState<string | null>(null);
  const [showQuickEditor, setShowQuickEditor] = useState(false);
  const [quickNickname, setQuickNickname] = useState(settings.nickname);
  const [quickQuote, setQuickQuote] = useState(settings.quote);
  const [quickQuoteNote, setQuickQuoteNote] = useState(settings.quoteNote);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [audioBars, setAudioBars] = useState<number[]>([20, 35, 60, 35, 20]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationInFlightRef = useRef(false);
  const activeJobRef = useRef<string | null>(null);
  const activeEntryRef = useRef<string | null>(null);
  const updateActiveJobId = (value: string | null) => {
    activeJobRef.current = value;
    setActiveJobId(value);
  };
  const showCreateScreen = () => {
    screenRef.current = "create";
    setScreen("create");
  };
  useEffect(() => {
    screenRef.current = screen;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [screen]);

  /* The initial data load intentionally owns the state synchronization lifecycle. */
  /* eslint-disable react-hooks/preserve-manual-memoization, react-hooks/set-state-in-effect */
  const loadData = useCallback(async () => {
    try {
      await ensureSession();
      const me = await getCurrentUser();
      if (me) {
        setCurrentUser(me);
        if (me.nickname) {
          setSettings((s) => ({ ...s, nickname: me.nickname, quote: me.quote || s.quote, quoteNote: me.quote_note || s.quoteNote }));
          setDraft((s) => ({ ...s, nickname: me.nickname, quote: me.quote || s.quote, quoteNote: me.quote_note || s.quoteNote }));
          setQuickNickname(me.nickname);
        }
      }

      const [diariesRes, entriesRes] = await Promise.allSettled([
        listDiaries(),
        listEntries(),
      ]);
      const diaries = diariesRes.status === "fulfilled" ? diariesRes.value : [];
      const entries = entriesRes.status === "fulfilled" ? entriesRes.value.items : [];

      const mergedList: StoryPage[] = [];
      const usedEntryIds = new Set<string>();

      // First, map all completed storybook diaries
      for (const diary of diaries) {
        const story = toStory(diary);
        if (diary.entry_id) usedEntryIds.add(diary.entry_id);
        mergedList.push(story);
      }

      // Second, add pure text diary entries that do not have a storybook yet
      for (const entry of entries) {
        if (!usedEntryIds.has(entry.id) && entry.redacted_text?.trim()) {
          mergedList.push({
            entryId: entry.id,
            title: "文字日记 · " + formatDateLabel(entry.created_at || entry.entry_date),
            mood: entry.emotion?.label || "记录",
            note: "写于 " + formatDateLabel(entry.created_at || entry.entry_date),
            dateLabel: formatDateLabel(entry.created_at || entry.entry_date),
            rawTranscript: entry.redacted_text,
            isTextOnly: true,
            pages: [
              {
                text: entry.redacted_text,
                pageType: "text_only",
              },
            ],
          });
        }
      }

      setRecords(mergedList);
      setLoadError("");
    } catch {
      setLoadError("无法连接日记服务，请确认后端已启动后再刷新。");
    } finally {
      setRecordsLoading(false);
    }
    try {
      const prefs = await getPreferences();
      setSettings((current) => ({
        ...current,
        nickname: prefs.nickname || current.nickname,
        quote: prefs.quote || current.quote,
        quoteNote: prefs.quote_note || current.quoteNote,
      }));
      setDraft((current) => ({
        ...current,
        nickname: prefs.nickname || current.nickname,
        quote: prefs.quote || current.quote,
        quoteNote: prefs.quote_note || current.quoteNote,
      }));
      setMemoryOptIn(prefs.memory_opt_in);
    } catch {
      setProfileHint("个人偏好暂时无法同步。");
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);
  /* eslint-enable react-hooks/preserve-manual-memoization, react-hooks/set-state-in-effect */

  const stopRecording = (discard = true) => {
    recordingActiveRef.current = false;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioBars([20, 35, 60, 35, 20]);
    if (discard) speechRecognitionRef.current?.abort();
    else speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
    microphoneRequestRef.current += 1;
    requestingMicrophoneRef.current = false;
    setRequestingMicrophone(false);
    voiceUploadAbortRef.current?.abort();
    discardRecordingRef.current = discard;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
    setRecordingSeconds(0);
    if (discard) {
      setDiaryText(speechBaseTextRef.current);
      speechFinalTextRef.current = "";
      speechRecognizedRef.current = false;
    }
    if (generating) {
      void cancelGeneration();
    }
  };

  useEffect(() => {
    // React Strict Mode performs a setup → cleanup → setup cycle in development.
    // Restore this guard on every setup so the simulated cleanup does not leave
    // the live component permanently marked as unmounted.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      microphoneRequestRef.current += 1;
      voiceUploadAbortRef.current?.abort();
      generationAbortRef.current?.abort();
      const jobId = activeJobRef.current;
      const entryId = activeEntryRef.current;
      if (jobId || entryId)
        void (async () => {
          if (jobId) {
            await cancelJob(jobId).catch(() => undefined);
            await deleteDiary(jobId).catch(() => undefined);
          }
          if (entryId) await deleteEntry(entryId).catch(() => undefined);
        })();
      discardRecordingRef.current = true;
      recordingActiveRef.current = false;
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
      if (recorderRef.current) recorderRef.current.onstop = null;
      if (recorderRef.current?.state === "recording")
        recorderRef.current.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setRecordingSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const openEditor = () => {
    setDraft(settings);
    setEditorOpen(true);
  };
  const saveSettings = async () => {
    setSettings(draft);
    window.localStorage.setItem("voonie-page-settings", JSON.stringify(draft));
    try {
      await updatePreferences({
        nickname: draft.nickname,
        quote: draft.quote,
        quote_note: draft.quoteNote,
      });
    } catch {
      setProfileHint("页面已保存到本地，云端偏好稍后再试。");
    }
    setEditorOpen(false);
  };
  const resetSettings = () => {
    setDraft(defaultSettings);
  };
  useEffect(() => {
    if (chatOpen && chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages, chatSubmitting, chatOpen]);

  const sendMessage = async (overrideText?: string) => {
    const textToSend = (overrideText ?? message).trim();
    if (!textToSend || chatSubmittingRef.current) return;
    chatSubmittingRef.current = true;
    if (!overrideText) setMessage("");
    setChatError("");
    setChatSubmitting(true);
    setMessages((current) => [...current, { from: "user", text: textToSend }]);

    const historyContext = messages.slice(-6).map((m) => ({
      role: m.from === "user" ? ("user" as const) : ("assistant" as const),
      content: m.text,
    }));

    try {
      const reply = await chatWithPet(
        textToSend,
        settings.nickname,
        historyContext,
      );
      const poseMap: Record<string, DogPose> = {
        happy: "happy",
        comfort: "look",
        think: "look",
        wave: "wave",
        sleepy: "sleep",
        sleep: "sleep",
        play: "play",
        look: "look",
      };
      const actionPose = poseMap[reply.pet_action] || "happy";
      setMessages((current) => [
        ...current,
        {
          from: "bot",
          text: reply.reply,
          action: actionPose,
          referencedMemories: reply.referenced_memories || [],
        },
      ]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "聊天暂时不可用");
    } finally {
      chatSubmittingRef.current = false;
      setChatSubmitting(false);
    }
  };

  const resetChat = () => {
    setMessages([getDefaultGreeting(settings.nickname)]);
    setChatError("");
    setMessage("");
  };

  const chatStarters = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 6) {
      return [
        "🌙 睡前温暖絮语",
        "🍵 听听我的心事",
        "⭐ 聊聊今天的小确幸",
        "😴 给小主人一个晚安抱抱",
      ];
    }
    if (hour < 12) {
      return [
        "🌅 开启元气满满的一天",
        "🌟 夸夸我今天",
        "🐾 讲个温暖的故事",
        "🐶 今天想和你玩",
      ];
    }
    return [
      "🐾 讲个温暖的故事",
      "🌟 夸夸我今天",
      "🍵 听听我的心事",
      "📖 聊聊我最近的日记",
    ];
  }, []);

  const toggleChatVoice = () => {
    if (chatRecording) {
      chatRecognitionRef.current?.stop();
      setChatRecording(false);
      return;
    }
    const speechWindow = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const SpeechRecognition =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setChatError("当前浏览器暂不支持实时语音识别，请直接打字交流哦");
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "zh-CN";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onstart = () => {
        setChatRecording(true);
        setChatError("");
      };
      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          setMessage(transcript);
        }
      };
      recognition.onerror = () => {
        setChatRecording(false);
      };
      recognition.onend = () => {
        setChatRecording(false);
      };
      chatRecognitionRef.current = recognition;
      recognition.start();
    } catch {
      setChatRecording(false);
      setChatError("麦克风启动失败，请检查麦克风权限");
    }
  };

  const openCreator = () => {
    setChatOpen(false);
    setRecording(false);
    setCreateError("");
    setDraftEntryId(null);
    showCreateScreen();
  };
  const saveTextOnly = async () => {
    if (!diaryText.trim() || requestingMicrophoneRef.current || recordingActiveRef.current) return;
    setRecording(false);
    setGenerating(true);
    setCreateError("");
    setGeneratingHint("正在保存今日日记…");
    try {
      const entry = draftEntryId
        ? await updateTextEntry(draftEntryId, diaryText.trim())
        : await createTextEntry(diaryText.trim());
      const newStory: StoryPage = {
        entryId: entry.id,
        title: "文字日记 · " + formatDateLabel(entry.created_at || entry.entry_date),
        mood: entry.emotion?.label || "记录",
        note: "写于 " + formatDateLabel(entry.created_at || entry.entry_date),
        dateLabel: formatDateLabel(entry.created_at || entry.entry_date),
        rawTranscript: entry.redacted_text,
        isTextOnly: true,
        pages: [
          {
            text: entry.redacted_text,
            pageType: "text_only",
          },
        ],
      };
      setCurrentStory(newStory);
      setRecords((current) => [
        newStory,
        ...current.filter((r) => r.entryId !== entry.id),
      ]);
      setDraftEntryId(null);
      setDiaryText("");
      setGenerating(false);
      setScreen("book");
      setActive("我的日记");
    } catch (error) {
      setGenerating(false);
      setCreateError(
        error instanceof Error ? error.message : "保存日记失败，请重试",
      );
    }
  };

  const generateDiary = async (
    refImageB64?: string,
    stylePreset?: string,
    targetEntryId?: string,
  ) => {
    const textToUse = diaryText.trim() || currentStory?.rawTranscript || "";
    if (
      !textToUse ||
      requestingMicrophoneRef.current ||
      recordingActiveRef.current ||
      generationInFlightRef.current
    ) return;
    generationInFlightRef.current = true;
    const generationRequestId = newLocalId("comic-job");
    setRecording(false);
    setGenerating(true);
    setCreateError("");
    setGeneratingHint("正在保存日记原文…");
    const controller = new AbortController();
    generationAbortRef.current = controller;
    try {
      const entryIdToUse = targetEntryId || draftEntryId;
      const entry = entryIdToUse
        ? { id: entryIdToUse }
        : await createTextEntry(textToUse);
      activeEntryRef.current = entry.id;
      if (controller.signal.aborted) {
        await deleteEntry(entry.id);
        activeEntryRef.current = null;
        return;
      }
      setGeneratingHint("正在理解今天的情绪与重要片段…");
      const queued = await createComicJob(
        entry.id,
        refImageB64,
        stylePreset,
        generationRequestId,
      );
      updateActiveJobId(queued.job_id);
      if (controller.signal.aborted) {
        await cancelJob(queued.job_id);
        await deleteDiary(queued.job_id);
        await deleteEntry(entry.id);
        activeEntryRef.current = null;
        return;
      }
      const job = await waitForJob(
        queued.job_id,
        (status) => {
          setGeneratingHint(
            status.stage === "rendering"
              ? "正在绘制少而准确的记忆插图…"
              : status.stage === "finalizing"
                ? "正在把插图放回相关文字附近…"
                : "正在整理完整日记与情绪曲线…",
          );
        },
        controller.signal,
      );
      if (job.status === "cancelled") {
        setGenerating(false);
        updateActiveJobId(null);
        setCreateError("这次生成已取消。");
        return;
      }
      if (job.status !== "done" || !job.result)
        throw new Error(friendlyGenerationError(job.error));
      const story = jobToStory(job);
      story.rawTranscript = story.rawTranscript || textToUse;
      story.entryId = entry.id;
      story.isTextOnly = false;
      setCurrentStory(story);
      setRecords((current) => [
        story,
        ...current.filter(
          (item) => item.jobId !== story.jobId && item.entryId !== entry.id,
        ),
      ]);
      setDraftEntryId(null);
      activeEntryRef.current = null;
      setGenerating(false);
      updateActiveJobId(null);
      setScreen("book");
      setActive("我的日记");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setGenerating(false);
      updateActiveJobId(null);
      setCreateError(
        error instanceof Error ? error.message : "生成失败，请稍后重试",
      );
    } finally {
      generationInFlightRef.current = false;
      if (generationAbortRef.current === controller)
        generationAbortRef.current = null;
    }
  };

  const handleUpdateDiaryText = async (newText: string, regenerateComic = false) => {
    if (!currentStory || !newText.trim()) return;
    try {
      let entryId = currentStory.entryId;
      if (entryId) {
        await updateTextEntry(entryId, newText.trim());
      } else {
        const created = await createTextEntry(newText.trim());
        entryId = created.id;
      }
      const updatedStory: StoryPage = {
        ...currentStory,
        entryId,
        rawTranscript: newText.trim(),
      };
      setCurrentStory(updatedStory);
      setRecords((current) =>
        current.map((item) =>
          (item.jobId && item.jobId === currentStory.jobId) ||
          (item.entryId && item.entryId === entryId)
            ? updatedStory
            : item,
        ),
      );
      if (regenerateComic) {
        setDiaryText(newText.trim());
        await generateDiary(undefined, undefined, entryId);
      }
    } catch (err) {
      throw err;
    }
  };

  const handleGenerateComicForDiary = (entryId?: string, text?: string) => {
    if (text) setDiaryText(text);
    if (entryId) setDraftEntryId(entryId);
    showCreateScreen();
  };

  const cancelGeneration = async () => {
    generationAbortRef.current?.abort();
    setGenerating(false);
    updateActiveJobId(null);
    setCreateError("已取消这次生成。");
    if (activeJobId) {
      try {
        await cancelJob(activeJobId);
        await deleteDiary(activeJobId);
        setRecords((current) =>
          current.filter((item) => item.jobId !== activeJobId),
        );
        if (currentStory?.jobId === activeJobId) setCurrentStory(null);
      } catch (error) {
        setCreateError(
          error instanceof Error
            ? `本地已取消，但服务器清理失败：${error.message}`
            : "本地已取消，但服务器清理失败。",
        );
      }
    }
    if (activeEntryRef.current) {
      const entryId = activeEntryRef.current;
      activeEntryRef.current = null;
      try {
        await deleteEntry(entryId);
        setDraftEntryId(null);
      } catch (error) {
        setCreateError(
          error instanceof Error
            ? `本地已取消，但原始记录清理失败：${error.message}`
            : "本地已取消，但原始记录清理失败。",
        );
      }
    }
  };

  const handleRegeneratePanel = async (panelNo: number, customPrompt?: string) => {
    if (!currentStory?.jobId) return;
    const updated = await regenerateDiaryPanel(currentStory.jobId, panelNo, customPrompt);
    const updatedStory = toStory(updated);
    updatedStory.rawTranscript = updatedStory.rawTranscript || currentStory.rawTranscript;
    updatedStory.entryId = currentStory.entryId;
    setCurrentStory(updatedStory);
    setRecords((current) =>
      current.map((item) => (item.jobId === updatedStory.jobId ? updatedStory : item)),
    );
  };

  const handleDeleteStory = async (jobId?: string, entryId?: string) => {
    if (!jobId && !entryId) return;
    if (!window.confirm("确定删除这篇日记记录吗？删除后将从云端永久移除。")) return;
    try {
      if (jobId) await deleteDiary(jobId);
      if (entryId) await deleteEntry(entryId);
      const next = records.filter(
        (row) =>
          (!jobId || row.jobId !== jobId) && (!entryId || row.entryId !== entryId),
      );
      setRecords(next);
      if (
        (jobId && currentStory?.jobId === jobId) ||
        (entryId && currentStory?.entryId === entryId)
      ) {
        setCurrentStory(next[0] ?? null);
        if (next.length === 0) {
          setScreen("home");
          setActive("首页");
        }
      }
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "删除失败，请重试。",
      );
    }
  };

  const handleNav = (label: string) => {
    stopRecording();
    if (generating) void cancelGeneration();
    setActive(label);
    setChatOpen(false);
    if (label === "首页") setScreen("home");
    if (label === "我的日记") setScreen("history");
    if (label === "情绪记录") setScreen("mood");
    if (label === "回忆日历") setScreen("calendar");
    if (label === "个人中心") setScreen("profile");
  };

  const handleMobileNav = (target: AppScreen) => {
    if (target === "create") {
      openCreator();
      return;
    }
    const labels: Partial<Record<AppScreen, string>> = {
      home: "首页",
      history: "我的日记",
      mood: "情绪记录",
      profile: "个人中心",
    };
    const label = labels[target];
    if (label) handleNav(label);
  };

  const themeStyle = {
    "--accent": settings.accent,
    "--dog-scale": settings.dogSize / 100,
  } as CSSProperties;
  const todayLabel = new Date().toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const timeGreeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 5) return `夜深了，${settings.nickname}`;
    if (hour < 11) return `早呀，${settings.nickname}`;
    if (hour < 14) return `中午好，${settings.nickname}`;
    if (hour < 18) return `下午好，${settings.nickname}`;
    return `晚上好，${settings.nickname}`;
  }, [settings.nickname]);

  const filteredRecords = useMemo(
    () =>
      records.filter(
        (item) =>
          !query.trim() ||
          `${item.title} ${item.pages.map((page) => page.text).join(" ")}`.includes(
            query.trim(),
          ),
      ),
    [query, records],
  );

  const moodFilteredRecords = useMemo(() => {
    if (moodFilter === "全部") return records;
    return records.filter((r) => r.mood.includes(moodFilter));
  }, [records, moodFilter]);

  const calendarFilteredRecords = useMemo(() => {
    if (!calendarDateFilter) return records;
    return records.filter((r) => r.dateLabel.includes(calendarDateFilter));
  }, [records, calendarDateFilter]);

  const currentMonthDays = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const entryDays = new Set<number>();
    records.forEach((r) => {
      const match = r.dateLabel.match(/(\d+)日/);
      if (match) {
        entryDays.add(Number.parseInt(match[1], 10));
      }
    });
    return { year, month: month + 1, daysInMonth, firstDayIndex, entryDays };
  }, [records]);

  const moodBars = useMemo(() => {
    const bars = Array.from({ length: 7 }, () => 28);
    records.slice(0, 7).forEach((item, index) => {
      const score = Number.parseInt(item.mood.replace(/\D/g, ""), 10);
      bars[6 - (index % 7)] = Number.isFinite(score)
        ? Math.max(28, Math.min(92, score))
        : 54;
    });
    return bars;
  }, [records]);

  const toggleRecording = async () => {
    if (recording && recorderRef.current) {
      recordingActiveRef.current = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      setAudioBars([20, 35, 60, 35, 20]);
      speechRecognitionRef.current?.stop();
      speechRecognitionRef.current = null;
      discardRecordingRef.current = false;
      recorderRef.current.stop();
      setRecording(false);
      setRecordingSeconds(0);
      return;
    }
    if (requestingMicrophoneRef.current) return;
    setCreateError("");
    requestingMicrophoneRef.current = true;
    setRequestingMicrophone(true);
    const requestVersion = ++microphoneRequestRef.current;
    let pendingStream: MediaStream | null = null;
    let pendingRecorder: MediaRecorder | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pendingStream = stream;
      if (
        !mountedRef.current ||
        requestVersion !== microphoneRequestRef.current ||
        screenRef.current !== "create" ||
        generationAbortRef.current !== null
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStreamRef.current = stream;
      discardRecordingRef.current = false;
      recordingActiveRef.current = true;
      speechRecognizedRef.current = false;
      speechBaseTextRef.current = diaryText.trim();
      speechFinalTextRef.current = "";

      // Setup Web Audio Analyser for dynamic live waveform visualization
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          analyserRef.current = analyser;
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const updateMeter = () => {
            if (!recordingActiveRef.current) return;
            analyser.getByteFrequencyData(dataArray);
            const b0 = Math.max(18, Math.min(95, Math.round((dataArray[1] || 0) / 2.4)));
            const b1 = Math.max(24, Math.min(100, Math.round((dataArray[3] || 0) / 2.1)));
            const b2 = Math.max(32, Math.min(100, Math.round((dataArray[5] || 0) / 1.8)));
            const b3 = Math.max(24, Math.min(100, Math.round((dataArray[7] || 0) / 2.1)));
            const b4 = Math.max(18, Math.min(95, Math.round((dataArray[9] || 0) / 2.4)));
            setAudioBars([b0, b1, b2, b3, b4]);
            animFrameRef.current = requestAnimationFrame(updateMeter);
          };
          animFrameRef.current = requestAnimationFrame(updateMeter);
        }
      } catch {
        // Non-critical audio meter
      }

      const preferredRecorderTypes = [
        "audio/webm;codecs=opus",
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4",
        "audio/webm",
      ];
      const supportedRecorderType =
        typeof MediaRecorder.isTypeSupported === "function"
          ? preferredRecorderTypes.find((type) => MediaRecorder.isTypeSupported(type))
          : undefined;
      const recorderOptions: MediaRecorderOptions = {
        audioBitsPerSecond: 48_000,
        ...(supportedRecorderType ? { mimeType: supportedRecorderType } : {}),
      };
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, recorderOptions);
      } catch {
        // Older mobile browsers may reject otherwise valid optional settings.
        recorder = new MediaRecorder(stream);
      }
      pendingRecorder = recorder;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          if (
            requestVersion !== microphoneRequestRef.current ||
            recorderRef.current !== recorder ||
            !recordingActiveRef.current
          ) return;
          recordingActiveRef.current = false;
          discardRecordingRef.current = true;
          if (animFrameRef.current) {
            cancelAnimationFrame(animFrameRef.current);
            animFrameRef.current = null;
          }
          if (audioContextRef.current && audioContextRef.current.state !== "closed") {
            audioContextRef.current.close().catch(() => {});
            audioContextRef.current = null;
          }
          analyserRef.current = null;
          setAudioBars([20, 35, 60, 35, 20]);
          speechRecognitionRef.current?.abort();
          speechRecognitionRef.current = null;
          if (recorder.state === "recording") recorder.stop();
          setRecording(false);
          setRecordingSeconds(0);
          setCreateError("麦克风监听已中断，录音没有上传。请检查系统麦克风后重试。");
        };
      }
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (
          requestVersion === microphoneRequestRef.current &&
          recorderRef.current === recorder &&
          event.data.size
        ) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== "closed") {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
        analyserRef.current = null;
        setAudioBars([20, 35, 60, 35, 20]);

        if (
          requestVersion !== microphoneRequestRef.current ||
          recorderRef.current !== recorder
        ) return;
        mediaStreamRef.current = null;
        recorderRef.current = null;
        if (discardRecordingRef.current) return;
        
        // If web speech API successfully recognized speech text or textarea already has text, keep it
        if ((speechRecognizedRef.current && speechFinalTextRef.current.trim()) || diaryText.trim()) {
          setGenerating(false);
          setGeneratingHint("");
          return;
        }
        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size < 200) {
          setGenerating(false);
          setGeneratingHint("");
          setCreateError("录音时间较短，未检测到语音内容，可以直接在上方输入框打字记录哦。");
          return;
        }
        setGenerating(true);
        setGeneratingHint("正在把语音转成文字…");
        const uploadController = new AbortController();
        voiceUploadAbortRef.current = uploadController;
        try {
          const entry = await createVoiceEntry(blob, uploadController.signal);
          if (
            uploadController.signal.aborted ||
            !mountedRef.current ||
            screenRef.current !== "create"
          )
            return;
          setDiaryText(entry.redacted_text);
          setDraftEntryId(entry.id);
          setGenerating(false);
          setGeneratingHint("");
        } catch (error) {
          if (uploadController.signal.aborted) return;
          setGenerating(false);
          setGeneratingHint("");
          setCreateError(
            error instanceof Error ? error.message : "未检测到清晰语音，可以直接在上方输入框打字记录哦",
          );
        } finally {
          if (voiceUploadAbortRef.current === uploadController)
            voiceUploadAbortRef.current = null;
        }
      };
      recorderRef.current = recorder;
      recorder.start(1000);
      const speechWindow = window as typeof window & {
        SpeechRecognition?: BrowserSpeechRecognitionConstructor;
        webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
      };
      const SpeechRecognition =
        speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = "zh-CN";
          recognition.onresult = (event) => {
            if (
              requestVersion !== microphoneRequestRef.current ||
              speechRecognitionRef.current !== recognition
            ) return;
            let interimText = "";
            for (let index = event.resultIndex; index < event.results.length; index += 1) {
              const result = event.results[index];
              const transcript = result[0].transcript.trim();
              if (!transcript) continue;
              if (result.isFinal) {
                speechFinalTextRef.current = [speechFinalTextRef.current, transcript]
                  .filter(Boolean)
                  .join(" ");
                speechRecognizedRef.current = true;
              } else {
                interimText += `${transcript} `;
              }
            }
            const recognizedText = [speechFinalTextRef.current, interimText.trim()]
              .filter(Boolean)
              .join(" ");
            setDiaryText(
              [speechBaseTextRef.current, recognizedText].filter(Boolean).join("\n"),
            );
          };
          recognition.onerror = (event) => {
            if (
              requestVersion !== microphoneRequestRef.current ||
              speechRecognitionRef.current !== recognition
            ) return;
            // Web Speech API warnings (e.g. network/no-speech) are non-blocking as MediaRecorder is active
            console.warn("Web speech recognition event:", event.error);
          };
          recognition.onend = () => {
            if (
              requestVersion !== microphoneRequestRef.current ||
              speechRecognitionRef.current !== recognition
            ) return;
            // Chrome may end recognition after a pause even in continuous mode.
            // Keep the visible recording session alive and resume recognition
            // so later speech is not silently lost.
            if (!recordingActiveRef.current) return;
            window.setTimeout(() => {
              if (
                requestVersion !== microphoneRequestRef.current ||
                speechRecognitionRef.current !== recognition ||
                !recordingActiveRef.current
              ) return;
              try {
                recognition.start();
              } catch (error) {
                console.warn("Could not resume Web Speech API:", error);
              }
            }, 250);
          };
          speechRecognitionRef.current = recognition;
          recognition.start();
        } catch (e) {
          console.warn("Could not start Web Speech API:", e);
        }
      }
      setRecording(true);
      setRecordingSeconds(0);
      setCreateError("");
    } catch {
      if (pendingRecorder?.state === "recording") pendingRecorder.stop();
      pendingStream?.getTracks().forEach((track) => track.stop());
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      setAudioBars([20, 35, 60, 35, 20]);

      if (requestVersion === microphoneRequestRef.current) {
        discardRecordingRef.current = true;
        recordingActiveRef.current = false;
        speechRecognitionRef.current?.abort();
        speechRecognitionRef.current = null;
        if (mediaStreamRef.current === pendingStream) mediaStreamRef.current = null;
        if (recorderRef.current === pendingRecorder) recorderRef.current = null;
        setRecording(false);
        setRecordingSeconds(0);
        setCreateError("无法使用麦克风，请检查浏览器权限设置。");
      }
    } finally {
      if (requestVersion === microphoneRequestRef.current) {
        requestingMicrophoneRef.current = false;
        setRequestingMicrophone(false);
      }
    }
  };

  return (
    <main className="app-shell" style={themeStyle} data-screen={screen}>
      <aside className="sidebar">
        <div className="brand">
          <PawPrint size={25} />
          <span>Voonie</span>
        </div>
        <nav>
          <p className="nav-label">记录我的生活</p>
          {navItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              aria-label={label}
              onClick={() => handleNav(label)}
              className={`nav-item ${active === label ? "active" : ""}`}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-item"
            aria-label="编辑页面"
            onClick={openEditor}
          >
            <Settings size={20} />
            <span>编辑页面</span>
          </button>
          <div className="profile-mini">
            <div className="mini-avatar">{settings.nickname.slice(0, 1)}</div>
            <div>
              <strong>{settings.nickname}</strong>
              <small>
                {records.length
                  ? `已记录 ${records.length} 篇日记`
                  : "还没有云端日记"}
              </small>
            </div>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>

      <nav className="mobile-bottom-nav" aria-label="移动端主要导航">
        {mobileNavItems.map(({ label, icon: Icon, screen: target, primary }) => (
          <button
            key={label}
            type="button"
            className={`${primary ? "mobile-nav-primary" : ""} ${
              screen === target || (target === "history" && (screen === "search" || screen === "calendar" || screen === "book"))
                ? "active"
                : ""
            }`}
            aria-current={screen === target ? "page" : undefined}
            aria-label={primary ? "开始记录今天" : label}
            onClick={() => handleMobileNav(target)}
          >
            <Icon size={primary ? 23 : 21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {screen === "home" ? (
        <section className="workspace">
          <header className="topbar">
            <div>
              <p>{todayLabel}</p>
              <h1>
                {timeGreeting} <Sun size={24} />
              </h1>
              {loadError ? <p>{loadError}</p> : null}
              {notificationHint ? (
                <p role="status">{notificationHint}</p>
              ) : null}
            </div>
            <div className="top-actions">
              <button
                className="mobile-search-button"
                aria-label="搜索回忆"
                onClick={() => {
                  setScreen("search");
                  setActive("我的日记");
                }}
              >
                <Search size={19} />
              </button>
              <button
                className="auth-user-pill"
                onClick={() => {
                  if (currentUser?.email) {
                    handleNav("个人中心");
                  } else {
                    setAuthModalMode("login");
                    setAuthModalOpen(true);
                  }
                }}
                title={currentUser?.email ? `已登录: ${currentUser.email}` : "点击登录/注册专属账号"}
              >
                <PawPrint size={14} />
                <span>{currentUser?.email ? currentUser.nickname || "小主人" : "登录 / 注册"}</span>
              </button>
              <button className="edit-page-button" onClick={openEditor}>
                <Palette size={17} />
                编辑页面
              </button>
              <label className="search">
                <Search size={18} />
                <input
                  aria-label="搜索记录"
                  placeholder="搜索你的回忆"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                className="icon-button"
                aria-label="查看通知"
                onClick={() => setNotificationHint("目前没有新通知。")}
              >
                <Bell size={20} />
              </button>
            </div>
          </header>
          <div className="dashboard">
            <div className="main-column">
              <section className="hero-card">
                <div className="hero-copy">
                  <span className="eyebrow">
                    <Sparkles size={15} /> 每日一句
                  </span>
                  <blockquote>“{settings.quote}”</blockquote>
                  <p>{settings.quoteNote}</p>
                  <div className="hero-mobile-actions">
                    <button onClick={openCreator} className="record-button">
                      <Mic size={21} />
                      说说今天发生了什么
                    </button>
                    <button className="companion-inline-button" onClick={() => setChatOpen(true)}>
                      <PawPrint size={18} />
                      和 Voonie 聊聊
                    </button>
                  </div>
                </div>
                <VoonieDog pose="sleep" className="hero-dog" />
              </section>
              {settings.showBooks && (
                <section className="section-block">
                  <div className="section-title">
                    <div>
                      <h2>我的日记本</h2>
                      <p>把不同心情，放进不同的小世界</p>
                    </div>
                    <button
                      onClick={() => {
                        setCurrentStory(records[0] ?? null);
                        setScreen("book");
                        setActive("我的日记");
                      }}
                    >
                      查看全部 <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="book-grid">
                    {[
                      {
                        title: "全部日记",
                        color: "peach",
                        symbol: "★",
                        count: records.length,
                      },
                      {
                        title: "最近一篇",
                        color: "blue",
                        symbol: "☁",
                        count: records.length ? 1 : 0,
                      },
                      {
                        title: "心情记录",
                        color: "green",
                        symbol: "✿",
                        count: records.length,
                      },
                    ].map((book) => (
                      <button
                        className="book-card"
                        key={book.title}
                        onClick={() => {
                          setCurrentStory(records[0] ?? null);
                          setScreen(
                            book.title === "心情记录" ? "mood" : "book",
                          );
                          setActive(
                            book.title === "心情记录" ? "情绪记录" : "我的日记",
                          );
                        }}
                      >
                        <div className={`book-symbol ${book.color}`}>
                          {book.symbol}
                        </div>
                        <div>
                          <strong>{book.title}</strong>
                          <span>{book.count} 篇记录</span>
                        </div>
                        <ChevronRight size={18} />
                      </button>
                    ))}
                    <button
                      className="book-card add-book"
                      onClick={openCreator}
                    >
                      <div className="plus">＋</div>
                      <div>
                        <strong>继续记录</strong>
                        <span>把今天说给 Voonie 听</span>
                      </div>
                    </button>
                  </div>
                </section>
              )}
              <section className="section-block records">
                <div className="section-title">
                  <div>
                    <h2>最近记录</h2>
                    <p>每个平凡瞬间，都有它的光</p>
                  </div>
                  <button
                    onClick={() => {
                      setCurrentStory(records[0] ?? null);
                      setScreen("book");
                      setActive("我的日记");
                    }}
                  >
                    全部记录 <ChevronRight size={16} />
                  </button>
                </div>
                {recordsLoading ? (
                  <article className="record-card">
                    <div className="record-content">
                      <h3>正在读取你的记录…</h3>
                      <p>请稍候，Voonie 正在整理日记。</p>
                    </div>
                  </article>
                ) : loadError ? (
                  <article className="record-card">
                    <div className="record-content">
                      <h3>记录暂时无法读取</h3>
                      <p>{loadError}</p>
                      <button
                        className="voice-record"
                        onClick={() => window.location.reload()}
                      >
                        重新读取
                      </button>
                    </div>
                  </article>
                ) : filteredRecords.length === 0 ? (
                  <article className="record-card">
                    <div className="memory-art meadow">
                      <VoonieDog pose="play" />
                    </div>
                    <div className="record-content">
                      <div className="record-meta">
                        <span>
                          {query.trim() ? "没有匹配结果" : "还没有记录"}
                        </span>
                      </div>
                      <h3>
                        {query.trim()
                          ? "没有找到这段回忆"
                          : "今天的第一页还空着"}
                      </h3>
                      <p>
                        {query.trim()
                          ? "换一个关键词试试，或清空搜索查看全部日记。"
                          : "点右下角或首页按钮，把今天说给 Voonie 听。"}
                      </p>
                    </div>
                  </article>
                ) : (
                  filteredRecords.map((item) => (
                    <article
                      className="record-card"
                      key={item.jobId ?? item.entryId ?? item.title + item.dateLabel}
                    >
                      <div className={`memory-art ${item.isTextOnly ? "text-entry-art" : "meadow"}`}>
                        {item.cover ? (
                          <img src={item.cover} alt="" />
                        ) : item.isTextOnly ? (
                          <div className="techo-stamp-badge">
                            <FileText size={26} />
                            <span>文字手帐</span>
                          </div>
                        ) : (
                          <VoonieDog pose="play" />
                        )}
                      </div>
                      <div className="record-content">
                        <div className="record-meta">
                          <span>
                            <Sun size={15} /> {item.dateLabel}
                          </span>
                          <span
                            className={`memory-type-badge ${item.isTextOnly ? "text" : "comic"}`}
                          >
                            {item.isTextOnly ? "📝 文字日记" : "📖 图文日记"}
                          </span>
                        </div>
                        <h3>{item.title}</h3>
                        <p>{item.rawTranscript || item.pages[1]?.text || item.note}</p>
                        <div className="tags">
                          <span>#{item.mood}</span>
                        </div>
                      </div>
                      <div className="card-actions-group">
                        <button
                          className="open-book-btn"
                          onClick={() => {
                            setCurrentStory(item);
                            setScreen("book");
                            setActive("我的日记");
                          }}
                        >
                          打开
                        </button>
                        <button
                          className="delete-entry-btn"
                          onClick={() => handleDeleteStory(item.jobId, item.entryId)}
                          title="删除这篇记录"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </section>
            </div>
            <aside className="right-column">
              <section className="companion-card">
                <div className="companion-head">
                  <span>Voonie 在听…</span>
                  <button
                    aria-label="打开陪伴对话"
                    onClick={() => setChatOpen(true)}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </div>
                <VoonieDog pose="wave" className="companion-dog" />
                <div className="speech">
                  {settings.nickname}，今天的阳光很好哦～
                  <br />
                  有什么快乐想告诉我吗？
                </div>
                <button
                  className="talk-button"
                  onClick={() => setChatOpen(true)}
                >
                  <PawPrint size={18} />和 Voonie 聊聊天
                </button>
              </section>
              {settings.showMood && (
                <section className="mood-card">
                  <div className="section-title compact">
                    <div>
                      <h2>本周心情</h2>
                      <p>
                        {records.length
                          ? `你已经认真记录 ${records.length} 篇啦`
                          : "还没有本周记录"}
                      </p>
                    </div>
                    <button
                      aria-label="查看全部心情记录"
                      onClick={() => handleNav("情绪记录")}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                  <div className="mood-chart">
                    {moodBars.map((height, i) => (
                      <div key={i}>
                        <span
                          className={i === 5 ? "today" : ""}
                          style={{ height }}
                        />
                        <small>
                          {["一", "二", "三", "四", "五", "六", "日"][i]}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div className="mood-summary">
                    <div>
                      <strong>{records[0]?.mood ?? "尚无心情"}</strong>
                      <span>最近一次情绪</span>
                    </div>
                    <b>{records.length}</b>
                  </div>
                </section>
              )}
              <section className="create-card">
                <div className="create-icon">
                  <ImageIcon size={25} />
                </div>
                <div>
                  <span className="eyebrow">语音图文日记</span>
                  <h3>说完今天，就得到今天的小日记</h3>
                  <p>完整文字会保留，只有重要瞬间会被画下来。</p>
                </div>
                <button onClick={openCreator}>
                  <PenLine size={17} />
                  开始创作
                </button>
              </section>
            </aside>
          </div>
        </section>
      ) : screen === "history" || screen === "search" ? (
        <section className="workspace memory-workspace" id="main-content">
          <header className="topbar memory-page-header">
            <div>
              <p>{screen === "search" ? "寻找某一段记忆" : todayLabel}</p>
              <h1>{screen === "search" ? "搜索回忆" : "我的回忆"}</h1>
            </div>
            <div className="memory-header-actions">
              {screen === "history" ? (
                <>
                  <button
                    className="memory-header-button"
                    aria-label="搜索回忆"
                    onClick={() => setScreen("search")}
                  >
                    <Search size={18} />
                    <span>搜索</span>
                  </button>
                  <button
                    className="memory-header-button"
                    aria-label="打开回忆日历"
                    onClick={() => setScreen("calendar")}
                  >
                    <CalendarDays size={18} />
                    <span>日历</span>
                  </button>
                </>
              ) : (
                <button
                  className="memory-header-button"
                  aria-label="关闭搜索"
                  onClick={() => {
                    setQuery("");
                    setScreen("history");
                  }}
                >
                  <X size={18} />
                  <span>关闭</span>
                </button>
              )}
            </div>
          </header>

          {screen === "search" ? (
            <div className="mobile-search-surface">
              <Search size={20} aria-hidden="true" />
              <input
                autoFocus
                aria-label="搜索回忆"
                placeholder="搜索标题、正文或心情"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button aria-label="清空搜索" onClick={() => setQuery("")}>
                  <X size={18} />
                </button>
              ) : null}
            </div>
          ) : (
            <div className="memory-intro-row">
              <span>按时间重新走过这些日子</span>
              <strong>{records.length} 篇</strong>
            </div>
          )}

          <div className="memory-feed" aria-live="polite">
            {recordsLoading ? (
              <div className="memory-state">
                <LoaderCircle className="animate-spin" size={26} />
                <h2>正在翻开你的回忆</h2>
                <p>Voonie 正在整理日记，请稍候。</p>
              </div>
            ) : loadError ? (
              <div className="memory-state" role="alert">
                <VoonieDog pose="look" />
                <h2>回忆暂时没有打开</h2>
                <p>{loadError}</p>
                <button className="primary-action-btn" onClick={() => window.location.reload()}>
                  重新读取
                </button>
              </div>
            ) : (screen === "search" ? filteredRecords : records).length === 0 ? (
              <div className="memory-state">
                <VoonieDog pose={query ? "look" : "sleep"} />
                <h2>{query ? "没有找到这段回忆" : "这里还没有日记"}</h2>
                <p>{query ? "换一个关键词试试。" : "说说今天，Voonie 会帮你把重要的瞬间留下来。"}</p>
                {!query ? (
                  <button className="primary-action-btn" onClick={openCreator}>
                    <Mic size={17} />
                    开始记录
                  </button>
                ) : null}
              </div>
            ) : (
              (screen === "search" ? filteredRecords : records).map((item) => (
                <article
                  className="memory-feed-item"
                  key={item.jobId ?? item.entryId ?? item.title + item.dateLabel}
                >
                  <button
                    className="memory-feed-open"
                    onClick={() => {
                      setCurrentStory(item);
                      setScreen("book");
                      setActive("我的日记");
                    }}
                  >
                    <div className={`memory-feed-thumb ${item.isTextOnly ? "text-entry-art" : ""}`}>
                      {item.cover ? (
                        <img src={item.cover} alt="" />
                      ) : item.isTextOnly ? (
                        <FileText size={24} />
                      ) : (
                        <VoonieDog pose="play" />
                      )}
                    </div>
                    <div className="memory-feed-copy">
                      <div className="memory-feed-meta">
                        <span>{item.dateLabel}</span>
                        <span>#{item.mood}</span>
                      </div>
                      <h2>{item.title}</h2>
                      <p>{item.rawTranscript || item.pages[1]?.text || item.note}</p>
                    </div>
                    <ChevronRight size={20} aria-hidden="true" />
                  </button>
                  <button
                    className="memory-feed-delete"
                    aria-label={`删除日记：${item.title}`}
                    onClick={() => handleDeleteStory(item.jobId, item.entryId)}
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))
            )}
          </div>
        </section>
      ) : screen === "create" ? (
        <DiaryCreator
          text={diaryText}
          setText={setDiaryText}
          recording={recording}
          requestingMicrophone={requestingMicrophone}
          recordingSeconds={recordingSeconds}
          audioBars={audioBars}
          generating={generating}
          generatingHint={generatingHint}
          error={createError}
          onGenerate={generateDiary}
          onSaveTextOnly={saveTextOnly}
          onRecord={toggleRecording}
          onCancelRecording={() => {
            stopRecording(true);
            setCreateError("录音已取消，没有上传任何语音。");
          }}
          onCancel={cancelGeneration}
          onBack={() => {
            stopRecording();
            setScreen("home");
            setActive("首页");
          }}
        />
      ) : screen === "book" ? (
        <StoryBook
          key={currentStory?.jobId ?? currentStory?.entryId ?? currentStory?.title ?? "empty"}
          story={currentStory}
          onBack={showCreateScreen}
          onHome={() => {
            setScreen("history");
            setActive("我的日记");
          }}
          onRegeneratePanel={handleRegeneratePanel}
          onDelete={handleDeleteStory}
          onUpdateDiaryText={handleUpdateDiaryText}
          onGenerateComicForDiary={handleGenerateComicForDiary}
        />
      ) : screen === "mood" ? (
        <section className="workspace">
          <header className="topbar">
            <div>
              <p>{todayLabel}</p>
              <h1>情绪记录</h1>
            </div>
          </header>
          <div className="section-block">
            <div className="mood-overview-banner">
              <div className="mood-stat-box">
                <span>累计记录</span>
                <strong>{records.length} 篇</strong>
              </div>
              <div className="mood-stat-box">
                <span>最近情绪</span>
                <strong>{records[0]?.mood ?? "平静 80%"}</strong>
              </div>
              <div className="mood-stat-box">
                <span>陪伴状态</span>
                <strong>Voonie 守护中</strong>
              </div>
            </div>

            <div className="mood-filter-tabs" role="tablist" aria-label="心情筛选">
              {["全部", "开心", "治愈", "平静", "充实", "思念", "疲惫"].map((tag) => (
                <button
                  key={tag}
                  role="tab"
                  aria-selected={moodFilter === tag}
                  className={`mood-filter-chip ${moodFilter === tag ? "active" : ""}`}
                  onClick={() => setMoodFilter(tag)}
                >
                  {tag === "全部" ? "🌟 全部心情" : `#${tag}`}
                </button>
              ))}
            </div>
          </div>
          <div className="section-block records">
            {moodFilteredRecords.length === 0 ? (
              <article className="record-card empty-state-card">
                <VoonieDog pose="sleep" />
                <div className="record-content" style={{ textAlign: "center", marginTop: "12px" }}>
                  <h3>{moodFilter === "全部" ? "还没有情绪记录" : `还没有 #${moodFilter} 的记录`}</h3>
                  <p>
                    {moodFilter === "全部"
                      ? "写一篇日记，Voonie 会帮你记住当天的心情与故事。"
                      : "尝试切换其他心情分类，或说说今天、记录当下的心情。"}
                  </p>
                  <button className="primary-action-btn" onClick={openCreator} style={{ marginTop: "16px" }}>
                    <PenLine size={16} />
                    去记录今天
                  </button>
                </div>
              </article>
            ) : (
              moodFilteredRecords.map((item) => (
                <article
                  className="record-card memory-entry-card"
                  key={item.jobId ?? item.entryId ?? item.title + item.dateLabel}
                >
                  <div className={`memory-art ${item.isTextOnly ? "text-entry-art" : "meadow"}`}>
                    {item.cover ? (
                      <img src={item.cover} alt="" />
                    ) : item.isTextOnly ? (
                      <div className="techo-stamp-badge">
                        <FileText size={26} />
                        <span>文字手帐</span>
                      </div>
                    ) : (
                      <VoonieDog pose="play" />
                    )}
                  </div>
                  <div className="record-content">
                    <div className="record-meta">
                      <span>{item.dateLabel}</span>
                      <span className="mood-tag-badge">#{item.mood}</span>
                      <span
                        className={`memory-type-badge ${item.isTextOnly ? "text" : "comic"}`}
                      >
                        {item.isTextOnly ? "📝 文字日记" : "📖 图文日记"}
                      </span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.rawTranscript || item.pages[1]?.text || item.note}</p>
                  </div>
                  <div className="card-actions-group">
                    <button
                      className="open-book-btn"
                      onClick={() => {
                        setCurrentStory(item);
                        setScreen("book");
                        setActive("我的日记");
                      }}
                    >
                      阅读日记
                    </button>
                    <button
                      className="delete-entry-btn"
                      onClick={() => handleDeleteStory(item.jobId, item.entryId)}
                      title="删除这篇记录"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : screen === "calendar" ? (
        <section className="workspace">
          <header className="topbar">
            <div>
              <p>{todayLabel}</p>
              <h1>回忆日历</h1>
            </div>
          </header>

          <div className="calendar-card">
            <div className="calendar-header-row">
              <h3>📅 {currentMonthDays.year} 年 {currentMonthDays.month} 月回忆日历</h3>
              {calendarDateFilter ? (
                <button
                  className="clear-filter-btn"
                  onClick={() => setCalendarDateFilter(null)}
                >
                  查看全部日期
                </button>
              ) : null}
            </div>
            <div className="calendar-grid-wrapper">
              {["日", "一", "二", "三", "四", "五", "六"].map((w) => (
                <div key={w} className="calendar-weekday-header">
                  {w}
                </div>
              ))}
              {Array.from({ length: currentMonthDays.firstDayIndex }).map((_, i) => (
                <button key={`empty-${i}`} disabled className="calendar-cell" aria-hidden="true" />
              ))}
              {Array.from({ length: currentMonthDays.daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const dayLabel = `${currentMonthDays.month}月${dayNum}日`;
                const hasEntry = currentMonthDays.entryDays.has(dayNum);
                const isSelected = calendarDateFilter === `${dayNum}日` || calendarDateFilter === dayLabel;
                return (
                  <button
                    key={dayNum}
                    className={`calendar-cell ${hasEntry ? "has-entry" : ""} ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      if (isSelected) setCalendarDateFilter(null);
                      else setCalendarDateFilter(`${dayNum}日`);
                    }}
                    title={hasEntry ? `${dayNum}日有日记回忆` : `${dayNum}日`}
                    aria-label={`${currentMonthDays.month}月${dayNum}日${hasEntry ? "，有日记记录" : ""}`}
                  >
                    <span>{dayNum}</span>
                    {hasEntry ? <i className="calendar-dot" /> : null}
                  </button>
                );
              })}
            </div>
            {calendarDateFilter ? (
              <div className="calendar-active-filter-bar">
                <span>正在查看：<strong>{calendarDateFilter}</strong> 的回忆 ({calendarFilteredRecords.length} 篇)</span>
                <button className="clear-filter-btn" onClick={() => setCalendarDateFilter(null)}>
                  ✕ 清除筛选
                </button>
              </div>
            ) : null}
          </div>

          <div className="section-block records">
            {calendarFilteredRecords.length === 0 ? (
              <article className="record-card empty-state-card">
                <VoonieDog pose="look" />
                <div className="record-content" style={{ textAlign: "center", marginTop: "12px" }}>
                  <h3>{calendarDateFilter ? `${calendarDateFilter} 暂无回忆` : "日历还是空的"}</h3>
                  <p>
                    {calendarDateFilter
                      ? "当天还没有记录绘本，点击下方按钮写一篇吧。"
                      : "记录下日记或绘本后，珍贵的回忆会按日期珍藏在这里。"}
                  </p>
                  <button className="primary-action-btn" onClick={openCreator} style={{ marginTop: "16px" }}>
                    <PenLine size={16} />
                    创作绘本
                  </button>
                </div>
              </article>
            ) : (
              calendarFilteredRecords.map((item) => (
                <article
                  className="record-card memory-entry-card"
                  key={item.jobId ?? item.entryId ?? item.dateLabel + item.title}
                >
                  <div className={`memory-art ${item.isTextOnly ? "text-entry-art" : "meadow"}`}>
                    {item.cover ? (
                      <img src={item.cover} alt="" />
                    ) : item.isTextOnly ? (
                      <div className="techo-stamp-badge">
                        <FileText size={26} />
                        <span>文字手帐</span>
                      </div>
                    ) : (
                      <VoonieDog pose="play" />
                    )}
                  </div>
                  <div className="record-content">
                    <div className="record-meta">
                      <span>{item.dateLabel}</span>
                      <span className="mood-tag-badge">#{item.mood}</span>
                      <span
                        className={`memory-type-badge ${item.isTextOnly ? "text" : "comic"}`}
                      >
                        {item.isTextOnly ? "📝 文字日记" : "📖 图文日记"}
                      </span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.rawTranscript || item.note}</p>
                  </div>
                  <div className="card-actions-group">
                    <button
                      className="open-book-btn"
                      onClick={() => {
                        setCurrentStory(item);
                        setScreen("book");
                        setActive("我的日记");
                      }}
                    >
                      阅读日记
                    </button>
                    <button
                      className="delete-entry-btn"
                      onClick={() => handleDeleteStory(item.jobId, item.entryId)}
                      title="删除这篇记录"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : (
        <section className="workspace">
          <header className="topbar">
            <div>
              <p>个人中心</p>
              <h1>{settings.nickname} 的治愈小窝</h1>
            </div>
          </header>
          <div className="profile-container">
            <div className="profile-hero-card">
              <div className="profile-avatar-box">
                <PawPrint size={32} />
              </div>
              <div className="profile-info-text" style={{ flex: 1 }}>
                <h2>{settings.nickname}</h2>
                <p className="profile-quote-line">“{settings.quote}”</p>
                <small>{settings.quoteNote}</small>
              </div>
              <button
                className="profile-edit-trigger"
                onClick={() => setShowQuickEditor(!showQuickEditor)}
              >
                <Palette size={15} />
                <span>{showQuickEditor ? "收起设置" : "修改资料与寄语"}</span>
              </button>
            </div>

            {showQuickEditor ? (
              <div className="profile-quick-editor">
                <h3>✏️ 个性化资料设置</h3>
                <div className="profile-form-grid">
                  <div>
                    <label className="profile-field-label">小主人昵称</label>
                    <input
                      className="profile-input"
                      value={quickNickname}
                      onChange={(e) => setQuickNickname(e.target.value)}
                      placeholder="你的称呼"
                    />
                  </div>
                  <div>
                    <label className="profile-field-label">签名 / 寄语出处</label>
                    <input
                      className="profile-input"
                      value={quickQuoteNote}
                      onChange={(e) => setQuickQuoteNote(e.target.value)}
                      placeholder="例如：给今天认真生活的自己"
                    />
                  </div>
                  <div className="profile-form-full">
                    <label className="profile-field-label">每日寄语</label>
                    <textarea
                      className="profile-input"
                      rows={2}
                      value={quickQuote}
                      onChange={(e) => setQuickQuote(e.target.value)}
                      placeholder="写一句温暖鼓励自己的话"
                    />
                  </div>
                </div>
                <button
                  className="profile-save-btn"
                  onClick={async () => {
                    const next = {
                      ...settings,
                      nickname: quickNickname.trim() || settings.nickname,
                      quote: quickQuote.trim() || settings.quote,
                      quoteNote: quickQuoteNote.trim() || settings.quoteNote,
                    };
                    setSettings(next);
                    window.localStorage.setItem("voonie-page-settings", JSON.stringify(next));
                    try {
                      await updatePreferences({
                        nickname: next.nickname,
                        quote: next.quote,
                        quote_note: next.quoteNote,
                      });
                      setProfileHint("个性化资料已同步更新！");
                    } catch {
                      setProfileHint("已保存到本地。");
                    }
                    setShowQuickEditor(false);
                  }}
                >
                  <Save size={15} />
                  <span>保存设置</span>
                </button>
              </div>
            ) : null}

            <div className="profile-section-card account-card">
              <div className="account-card-header">
                <div>
                  <div className="memory-title-line">
                    <User size={16} style={{ color: "var(--accent)" }} />
                    <h3>{currentUser?.email ? "专属云端账号" : "免密游客模式"}</h3>
                    <span className={`memory-status-tag ${currentUser?.email ? "active" : "inactive"}`}>
                      {currentUser?.email ? "● 已登录专属账号" : "○ 本地免密模式"}
                    </span>
                  </div>
                  <p className="profile-section-desc" style={{ marginTop: "6px", marginBottom: "14px" }}>
                    {currentUser?.email
                      ? `当前绑定邮箱：${currentUser.email}。你的所有日记、绘本与小狗记忆已进行独立的云端数据隔离保护。`
                      : "当前为单机免密模式。注册或登录邮箱后，即可在其他设备随时同步，并享受独立数据隔离。"}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {currentUser?.email ? (
                    <>
                      <button
                        className="export-data-btn"
                        onClick={() => {
                          setAuthModalMode("login");
                          setAuthModalOpen(true);
                        }}
                      >
                        <RotateCcw size={15} />
                        切换账号
                      </button>
                      <button
                        className="delete-cloud-btn"
                        onClick={async () => {
                          await logoutUser();
                          setCurrentUser(null);
                          setProfileHint("已退出登录。");
                          void loadData();
                        }}
                      >
                        <X size={15} />
                        退出登录
                      </button>
                    </>
                  ) : (
                    <button
                      className="export-data-btn"
                      style={{ background: "var(--accent)", color: "#fff", border: "none" }}
                      onClick={() => {
                        setAuthModalMode("login");
                        setAuthModalOpen(true);
                      }}
                    >
                      <Sparkles size={15} />
                      登录 / 注册专属账号
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="profile-section-card memory-config-card">
              <div className="switch-row memory-switch-row">
                <div id="memory-setting-label" className="memory-info-col">
                  <div className="memory-title-line">
                    <Sparkles size={16} style={{ color: "var(--accent)" }} />
                    <h3>云端个性化记忆</h3>
                    <span className={`memory-status-tag ${memoryOptIn ? "active" : "inactive"}`}>
                      {memoryOptIn ? "● 已开启记忆" : "○ 已关闭记忆"}
                    </span>
                  </div>
                  <small>开启后，Voonie 小狗在对话和绘本创作时会结合过往回忆更懂你；关闭后即刻断开并清除。</small>
                </div>
                <div className="switch-control-box">
                  <Switch
                    aria-labelledby="memory-setting-label"
                    checked={memoryOptIn}
                    onCheckedChange={async (checked) => {
                      try {
                        const prefs = await updatePreferences({
                          memory_opt_in: checked,
                        });
                        setMemoryOptIn(prefs.memory_opt_in);
                      } catch (error) {
                        setProfileHint(
                          error instanceof Error
                            ? error.message
                            : "记忆设置更新失败。",
                        );
                      }
                    }}
                  />
                  <span className="switch-label-text">{memoryOptIn ? "开启中" : "已关闭"}</span>
                </div>
              </div>
            </div>

            <div className="profile-section-card">
              <h3>数据与隐私管理</h3>
              <p className="profile-section-desc">
                你可以随时导出你的全部图文日记和情绪数据备份，或彻底抹除云端记录。
              </p>
              <div className="profile-data-actions">
                <button
                  className="export-data-btn"
                  onClick={async () => {
                    try {
                      const data = await exportMyData();
                      const blob = new Blob([JSON.stringify(data, null, 2)], {
                        type: "application/json",
                      });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = "voonie-export.json";
                      link.click();
                      URL.revokeObjectURL(url);
                      setProfileHint("已成功导出数据备份文件。");
                    } catch (error) {
                      setProfileHint(
                        error instanceof Error ? error.message : "导出失败。",
                      );
                    }
                  }}
                >
                  <Download size={16} />
                  导出数据备份 (.json)
                </button>
                <button
                  className="delete-cloud-btn"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "确定删除云端日记、绘本和记忆吗？此操作不可恢复。",
                      )
                    )
                      return;
                    try {
                      await deleteMyData();
                      setRecords([]);
                      setCurrentStory(null);
                      setProfileHint("云端数据已彻底清除。");
                    } catch (error) {
                      setProfileHint(
                        error instanceof Error ? error.message : "删除失败。",
                      );
                    }
                  }}
                >
                  <Trash2 size={16} />
                  删除云端数据
                </button>
              </div>
              {profileHint ? <p className="mock-hint" style={{ marginTop: "14px" }}>{profileHint}</p> : null}
            </div>
          </div>
        </section>
      )}

      {!chatOpen && (screen === "home" || screen === "mood" || screen === "calendar" || screen === "profile") ? (
        <DesktopPet
          nickname={settings.nickname || "小主人"}
          onOpenChat={() => setChatOpen(true)}
          chatOpen={chatOpen}
          appState={
            recording || chatRecording
              ? "listening"
              : generating || chatSubmitting
              ? "thinking"
              : "idle"
          }
        />
      ) : null}

      {chatOpen ? (
        <aside className="chat-panel floating-chat-window" aria-label="Voonie 伴侣聊天窗口">
          <header>
            <div>
              <div className="chat-avatar">
                <PawPrint size={20} />
              </div>
              <div>
                <h3 id="chat-title">Voonie</h3>
                <span>
                  <i /> 陪伴着 {settings.nickname || "小主人"}
                </span>
              </div>
            </div>
            <div className="chat-header-actions">
              <button
                className="chat-tool-btn"
                onClick={resetChat}
                title="开启新话题 / 清空记录"
                aria-label="开启新话题"
              >
                <RotateCcw size={15} />
              </button>
              <button
                className="chat-tool-btn"
                onClick={() => setChatOpen(false)}
                aria-label="关闭对话"
              >
                <X size={18} />
              </button>
            </div>
          </header>
          <div className="chat-body" ref={chatBodyRef} role="log" aria-live="polite">
            <div className="date-divider">今天</div>
            {messages.map((item, i) =>
              item.from === "bot" ? (
                <div className="bot-message" key={i}>
                  <VoonieDog pose={item.action || "happy"} />
                  <div>
                    <p>{item.text}</p>
                    {item.referencedMemories && item.referencedMemories.length > 0 && (
                      <div className="memory-pill-list">
                        {item.referencedMemories.map((mem, idx) => (
                          <span key={idx} className="memory-pill">
                            📌 记忆：{mem}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="user-message" key={i}>
                  {item.text}
                </div>
              ),
            )}
            {chatSubmitting && (
              <div className="bot-message bot-typing">
                <VoonieDog pose="look" />
                <p className="typing-bubble">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </p>
              </div>
            )}
            {chatError && (
              <div className="bot-message" role="alert">
                <VoonieDog pose="look" />
                <p>{chatError}</p>
              </div>
            )}
          </div>
          <div className="chat-starters">
            {chatStarters.map((starter) => (
              <button
                key={starter}
                type="button"
                className="starter-chip"
                onClick={() => {
                  const text = starter.replace(/^[^\s]+\s*/, "");
                  void sendMessage(text);
                }}
              >
                {starter}
              </button>
            ))}
          </div>
          <footer>
            <button
              className={`mic-mini ${chatRecording ? "recording" : ""}`}
              aria-label={chatRecording ? "结束语音输入" : "语音输入"}
              title={chatRecording ? "点击结束语音输入" : "点击说话"}
              onClick={toggleChatVoice}
            >
              <Mic size={18} />
            </button>
            <input
              autoFocus
              aria-label="给 Voonie 的消息"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) =>
                event.key === "Enter" && !chatSubmitting && sendMessage()
              }
              placeholder={chatRecording ? "正在听你说…" : "和 Voonie 说点什么…"}
              disabled={chatSubmitting}
            />
            <button
              className="send"
              aria-label="发送消息"
              onClick={() => sendMessage()}
              disabled={chatSubmitting || !message.trim()}
            >
              <Send size={17} />
            </button>
          </footer>
        </aside>
      ) : null}

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent className="editor-sheet">
          <SheetHeader className="editor-header">
            <SheetTitle>编辑 Voonie 首页</SheetTitle>
            <SheetDescription>修改后点击“保存到我的页面”。</SheetDescription>
          </SheetHeader>
          <div className="editor-body">
            <label className="editor-field">
              <span>Voonie 怎么称呼你</span>
              <input
                value={draft.nickname}
                maxLength={12}
                onChange={(event) =>
                  setDraft({ ...draft, nickname: event.target.value })
                }
              />
            </label>
            <label className="editor-field">
              <span>每日一句</span>
              <textarea
                value={draft.quote}
                maxLength={80}
                rows={3}
                onChange={(event) =>
                  setDraft({ ...draft, quote: event.target.value })
                }
              />
            </label>
            <label className="editor-field">
              <span>补充文字</span>
              <input
                value={draft.quoteNote}
                maxLength={40}
                onChange={(event) =>
                  setDraft({ ...draft, quoteNote: event.target.value })
                }
              />
            </label>
            <div className="editor-field">
              <span className="editor-field-title">主题颜色</span>
              <div className="color-options">
                {["#d9845b", "#a85f43", "#6f7950", "#9a6d82", "#526e7d"].map(
                  (color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-dot ${draft.accent === color ? "selected" : ""}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setDraft({ ...draft, accent: color })}
                      aria-label={`选择颜色 ${color}`}
                    />
                  ),
                )}
                <label className="custom-color-picker" title="自定义调色盘">
                  <input
                    aria-label="自定义主题颜色"
                    type="color"
                    value={draft.accent}
                    onChange={(event) =>
                      setDraft({ ...draft, accent: event.target.value })
                    }
                  />
                  <Palette size={16} />
                </label>
              </div>
            </div>
            <div className="editor-field">
              <div className="field-row">
                <span id="dog-size-label" className="editor-field-title">小狗大小</span>
                <b className="slider-value-badge">{draft.dogSize}%</b>
              </div>
              <Slider
                aria-labelledby="dog-size-label"
                min={75}
                max={125}
                step={5}
                value={[draft.dogSize]}
                onValueChange={(value) =>
                  setDraft({ ...draft, dogSize: value[0] })
                }
              />
            </div>
            <div className="editor-switch-row">
              <div id="show-books-label" className="switch-text-col">
                <strong>显示“我的日记本”</strong>
                <small>首页的日记分类卡片</small>
              </div>
              <Switch
                aria-labelledby="show-books-label"
                checked={draft.showBooks}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, showBooks: checked })
                }
              />
            </div>
            <div className="editor-switch-row">
              <div id="show-mood-label" className="switch-text-col">
                <strong>显示“本周心情”</strong>
                <small>右侧的心情统计卡片</small>
              </div>
              <Switch
                aria-labelledby="show-mood-label"
                checked={draft.showMood}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, showMood: checked })
                }
              />
            </div>
            <div className="edit-hint">
              💡 保存后，这些设置会保存在你当前使用的浏览器中。
            </div>
          </div>
          <SheetFooter className="editor-footer">
            <button className="reset-button" onClick={resetSettings}>
              <RotateCcw size={15} />
              <span>恢复默认</span>
            </button>
            <button className="save-button" onClick={saveSettings}>
              <Save size={15} />
              <span>保存到我的页面</span>
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authModalMode}
        onSuccess={(user) => {
          setCurrentUser(user);
          if (user.nickname) {
            setSettings((s) => ({ ...s, nickname: user.nickname }));
          }
          setProfileHint(`欢迎回来，${user.nickname}！`);
          void loadData();
        }}
      />
    </main>
  );
}
