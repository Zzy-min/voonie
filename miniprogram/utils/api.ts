// utils/api.ts - Voonie 微信小程序 API 客户端
// 严格复用后端契约，支持 Token 自动刷新与错误友好映射
//
// 后端真源（见 docs/pi-briefs/2026-09-05-api-integration.md）：
//   - POST /api/v1/auth/refresh
//   - POST /api/v1/auth/login|register
//   - GET  /api/v1/auth/me
//   - POST /api/v1/entries/text
//   - POST /api/v1/entries/voice          （multipart 语音）
//   - POST /api/v1/entries/{entry_id}/comic-jobs
//   - GET  /api/v1/jobs/{job_id}
//   - GET  /api/v1/diaries  /diaries/{job_id}
//   - POST /api/v1/pet/chat
// 废弃/错误端点已移除：auth/bootstrap、entries/transcribe、
//   entries/{id}/process、artifacts/diaries、characters/dialogue。

export const DEFAULT_API_BASE = "https://vonnie.xyz"; // 生产服务器（/api/v1 前缀由各端点显式写出）
const API_BASE_KEY = "voonie_api_base"; // 本地覆盖键，方便开发者工具指向局域网后端
const VOICE_UPLOAD_TIMEOUT_MS = 90000;

const DEVICE_KEY = "voonie_device_id";
const ACCESS_TOKEN_KEY = "voonie_access_token";
const REFRESH_TOKEN_KEY = "voonie_refresh_token";
export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface UserProfile {
  id: string;
  email?: string | null;
  nickname: string;
  quote?: string;
  quote_note?: string;
  created_at?: string;
  companion_days?: number;
}

export interface UserPreferences {
  user_id: string;
  nickname: string;
  quote: string;
  quote_note: string;
  memory_opt_in: boolean;
}

// 后端 /diaries 返回的 ComicGenerationResponse（raw）与此处 DiaryItem 字段不一致，
// 统一经由 mapDiary() 收敛为页面友好结构（契约适配层）。
export interface RawComicDiary {
  task_id: string;
  job_id?: string | null;
  entry_id?: string | null;
  title: string;
  raw_transcript: string;
  organized_diary: string;
  emotion: {
    primary_emotion: string;
    emotion_label_zh: string;
    mood_score: number;
    analysis: string;
  };
  emotion_curve: Array<{ label: string; intensity: number; evidence: string }>;
  key_quote?: string | null;
  panels: Array<{
    panel_id: number;
    shot_type?: string;
    scene_desc: string;
    character_action?: string;
    narration?: string | null;
    speech_bubble?: { text: string; bubble_type?: string } | null;
    sfx?: string | null;
    image_url?: string | null;
    source_excerpt?: string;
  }>;
  composite_comic_url?: string | null;
  companion_note: string;
  created_at: string;
  edit_version?: number;
  entry_date?: string | null;
  timezone?: string | null;
  updated_at?: string | null;
}

export interface DiaryPanel {
  id: string;
  position: number; // 1 ~ N
  title: string;
  scene_prompt: string;
  narration: string;
  dialogue?: string;
  sfx?: string;
  image_url?: string;
}

export interface DiaryItem {
  id: string;
  entry_id: string;
  title: string;
  summary: string;
  mood: string;
  mood_score?: number;
  full_content: string;
  created_at: string;
  date_label?: string;
  panels: DiaryPanel[];
  tags?: string[];
  is_public?: boolean;
  edit_version?: number;
  entry_date?: string;
  timezone?: string;
  updated_at?: string;
}

export interface SharePost {
  id: string;
  artifact_id: string;
  author: string;
  caption: string;
  tags: string[];
  mood: string;
  image_url?: string | null;
  is_public: boolean;
  hide_date: boolean;
  created_at: string;
  likes: number;
  collects: number;
  is_liked: boolean;
  is_collected: boolean;
  is_owner: boolean;
}

// /api/v1/jobs/{id} 的真实返回（JobStatusResponse）
export interface JobStatus {
  job_id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  stage: string; // planning | rendering | finalizing | done | failed
  progress: number; // 0.0 ~ 1.0
  error?: string | null;
  result?: any;
  finished_at?: string | null;
}

// ==================== 基础辅助 ====================

export function getApiBase(): string {
  const override = wx.getStorageSync(API_BASE_KEY);
  return (override && typeof override === "string" && override.trim()) || DEFAULT_API_BASE;
}

export function setApiBase(base: string): void {
  if (base && base.trim()) {
    wx.setStorageSync(API_BASE_KEY, base.trim());
  } else {
    wx.removeStorageSync(API_BASE_KEY);
  }
}

export function mediaUrl(value?: string | null): string {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${getApiBase()}${value.startsWith("/") ? value : `/${value}`}`;
}

const mediaDownloadCache = new Map<string, Promise<string>>();

function mediaCachePath(url: string): string {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const extensionMatch = url.match(/\.(png|jpe?g|webp)(?:\?|$)/i);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "png";
  return `${wx.env.USER_DATA_PATH}/media-${(hash >>> 0).toString(16)}.${extension}`;
}

/**
 * 微信 image 组件不能附带 Bearer token。受保护媒体必须先用
 * wx.request 携带当前会话读取二进制，再把本地文件路径交给 image。
 * 使用 request 是因为真机对 downloadFile 另有独立的合法域名白名单。
 */
export function authenticatedMediaUrl(value?: string | null, retry = true): Promise<string> {
  const url = mediaUrl(value);
  if (!url || !/^https?:\/\//i.test(url)) return Promise.resolve(url);

  const cached = mediaDownloadCache.get(url);
  if (cached) return cached;

  const download = new Promise<string>((resolve, reject) => {
    const token = getAccessToken();
    wx.request({
      url,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      responseType: "arraybuffer",
      success: async (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data) {
          const filePath = mediaCachePath(url);
          wx.getFileSystemManager().writeFile({
            filePath,
            data: res.data as ArrayBuffer,
            success: () => resolve(filePath),
            fail: (err) => reject(new ApiError(0, "media_cache_failed", err.errMsg || "插图缓存失败")),
          });
          return;
        }
        if (res.statusCode === 401 && retry && await refreshSession()) {
          mediaDownloadCache.delete(url);
          try {
            resolve(await authenticatedMediaUrl(value, false));
          } catch (error) {
            reject(error);
          }
          return;
        }
        reject(new ApiError(res.statusCode, "media_download_failed", "插图加载失败"));
      },
      fail: (err) => reject(new ApiError(0, "network_error", err.errMsg || "插图加载失败")),
    });
  });
  mediaDownloadCache.set(url, download);
  download.catch(() => mediaDownloadCache.delete(url));
  return download;
}

export function getDeviceId(): string {
  let id = wx.getStorageSync(DEVICE_KEY);
  if (!id || String(id).length < 8) {
    // 后端要求 device_id 至少 8 字符
    id = "mp-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now();
    wx.setStorageSync(DEVICE_KEY, id);
  }
  return id;
}

export function getAccessToken(): string {
  return wx.getStorageSync(ACCESS_TOKEN_KEY) || "";
}

export function setTokens(access: string, refresh?: string) {
  if (access) wx.setStorageSync(ACCESS_TOKEN_KEY, access);
  if (refresh) wx.setStorageSync(REFRESH_TOKEN_KEY, refresh);
}

export function clearTokens() {
  wx.removeStorageSync(ACCESS_TOKEN_KEY);
  wx.removeStorageSync(REFRESH_TOKEN_KEY);
}

export function ensureIdempotencyKey(): string {
  // 本地/幂等键，用于 entries 上传与 comic job 去重
  return "mp-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now();
}

export function diaryDraftKey(): string {
  const app = getApp<any>();
  const userId = app && app.globalData && app.globalData.currentUser && app.globalData.currentUser.id;
  return userId ? `voonie_diary_draft:${userId}` : "voonie_diary_draft";
}

export function nowIsoDate(): string {
  // 带 UTC 偏移的 ISO 时间，符合后端 entry_date 校验（必须有 offset）
  return new Date().toISOString();
}

export function localTimezone(): string {
  // 后端用 IANA 时区名校验（ZoneInfo），不接受 "+08:00" 形固定偏移。
  // WeChat Android can expose a UTC Date offset even when the device is in
  // China, while Intl still reports the actual IANA zone. Prefer that source
  // so records created around local midnight are not stored on the prior day.
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const segments = zone ? zone.split("/") : [];
    const validIana = segments.length >= 2 && segments.every((segment) =>
      segment !== "." && segment !== ".." && /^[A-Za-z0-9._+-]+$/.test(segment)
    );
    if (zone && zone.length < 128 && (zone === "UTC" || validIana)) {
      return zone;
    }
  } catch (_) {}
  // getTimezoneOffset() 东八区返回 -480；取反后 mins=480（UTC+8 → Asia/Shanghai）。
  const mins = -new Date().getTimezoneOffset();
  const table: Record<string, string> = {
    "-480": "America/Los_Angeles",
    "-300": "America/New_York",
    "0": "UTC",
    "120": "Europe/Athens",
    "300": "Asia/Karachi",
    "330": "Asia/Kolkata",
    "420": "Asia/Bangkok",
    "480": "Asia/Shanghai",
    "540": "Asia/Tokyo",
    "600": "Australia/Sydney",
  };
  return table[String(mins)] || "Asia/Shanghai";
}

// ==================== 认证接口 ====================

// 冷启动仅恢复已验证的登录会话，不创建匿名设备身份。
export async function ensureSession(): Promise<boolean> {
  const token = getAccessToken();
  if (token) return true;
  const refreshToken = wx.getStorageSync(REFRESH_TOKEN_KEY);
  return refreshToken ? refreshSession() : false;
}

export async function refreshSession(): Promise<boolean> {
  const refreshToken = wx.getStorageSync(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;

  try {
    const res: any = await request(
      "/api/v1/auth/refresh",
      { method: "POST", data: { refresh_token: refreshToken } },
      false // 刷新接口自身不再触发 401 刷新，避免递归
    );
    if (res && res.access_token) {
      setTokens(res.access_token, res.refresh_token);
      return true;
    }
    return false;
  } catch {
    clearTokens();
    return false;
  }
}

export async function loginUser(email: string, password: string): Promise<any> {
  const res: any = await request("/api/v1/auth/login", {
    method: "POST",
    data: { email: email.trim(), password },
  });
  setTokens(res.access_token, res.refresh_token);
  return res;
}

export async function loginWithWeChatCode(code: string): Promise<any> {
  // 微信官方登录：后端用 code 换 openid 并签发 JWT（session_key 不下发）
  const res: any = await request("/api/v1/auth/wechat", {
    method: "POST",
    data: { code },
  });
  setTokens(res.access_token, res.refresh_token);
  return res;
}

export async function registerUser(
  email: string,
  password: string,
  nickname: string,
  confirmPassword?: string
): Promise<any> {
  const res: any = await request("/api/v1/auth/register", {
    method: "POST",
    data: {
      email: email.trim(),
      password,
      confirm_password: confirmPassword || undefined,
      nickname: nickname.trim() || "小主人",
    },
  });
  setTokens(res.access_token, res.refresh_token);
  return res;
}

export async function getCurrentUser(): Promise<UserProfile | null> {
  try {
    return await request<UserProfile>("/api/v1/auth/me");
  } catch (err) {
    // 仅确认的鉴权失效代表“未登录”；断网/超时/服务端错误必须上抛，
    // 让启动页保留现有凭证并展示可恢复的网络错误。
    if (err instanceof ApiError && err.status === 401) {
      clearTokens();
      return null;
    }
    throw err;
  }
}

export async function logoutUser(): Promise<void> {
  try {
    await request("/api/v1/auth/logout", { method: "POST" });
  } catch {
    // ignore
  } finally {
    clearTokens();
  }
}

export async function getPreferences(): Promise<UserPreferences> {
  return await request<UserPreferences>("/api/v1/me/preferences");
}

export async function updatePreferences(payload: Partial<Pick<UserPreferences, "nickname" | "quote" | "quote_note" | "memory_opt_in">>): Promise<UserPreferences> {
  return await request<UserPreferences>("/api/v1/me/preferences", { method: "PATCH", data: payload });
}

// ==================== 日记与录音接口 ====================

// POST /api/v1/entries/voice（multipart）→ EntryResponse
export async function uploadVoiceFile(
  tempFilePath: string,
  localId = ensureIdempotencyKey(),
  metadata: { entryDate: string; timezone: string } = {
    entryDate: nowIsoDate(),
    timezone: localTimezone(),
  },
  retry = true
): Promise<{ transcript: string; entry_id: string }> {
  const apiBase = getApiBase();
  const token = getAccessToken();

  return new Promise((resolve, reject) => {
    let settled = false;
    let uploadTask: WechatMiniprogram.UploadTask;
    const finishResolve = (value: { transcript: string; entry_id: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      resolve(value);
    };
    const finishReject = (error: ApiError | unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      reject(error);
    };
    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      uploadTask.abort();
      finishReject(new ApiError(0, "network_timeout", "语音上传超时，请稍后重试"));
    }, VOICE_UPLOAD_TIMEOUT_MS);

    uploadTask = wx.uploadFile({
      url: `${apiBase}/api/v1/entries/voice`,
      filePath: tempFilePath,
      name: "audio_file",
      formData: {
        local_id: localId,
        entry_date: metadata.entryDate,
        timezone: metadata.timezone,
      },
      header: {
        Authorization: token ? `Bearer ${token}` : "",
        "Idempotency-Key": localId,
      },
      success: async (res) => {
        if (settled) return;
        // The upload request has received its terminal HTTP response. Any 401
        // refresh/retry below owns a fresh timeout, so the original timer must
        // not race and reject while that retry is still active.
        clearTimeout(timeoutTimer);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const data = JSON.parse(res.data as string);
            finishResolve({ transcript: (data && data.redacted_text) || "", entry_id: (data && data.id) || "" });
          } catch (e) {
            finishReject(new ApiError(res.statusCode, "parse_error", "语音上传结果解析失败"));
          }
        } else if (res.statusCode === 401 && retry) {
          if (!refreshPromise) {
            refreshPromise = refreshSession().catch(() => false).finally(() => {
              refreshPromise = null;
            });
          }
          const refreshed = await refreshPromise;
          if (refreshed) {
            try {
              finishResolve(await uploadVoiceFile(tempFilePath, localId, metadata, false));
            } catch (retryErr) {
              finishReject(retryErr);
            }
          } else {
            clearTokens();
            finishReject(new ApiError(401, "unauthorized", "登录会话已过期，请重新登录"));
          }
        } else if (res.statusCode === 401) {
          clearTokens();
          finishReject(new ApiError(401, "unauthorized", "登录会话已过期，请重新登录"));
        } else {
          finishReject(new ApiError(res.statusCode, "upload_failed", "语音上传转写失败，请稍后重试"));
        }
      },
      fail: (err) => {
        if (settled) return;
        console.warn("Voice upload transport failed", err && err.errMsg ? err.errMsg : "unknown");
        finishReject(new ApiError(0, "network_error", "语音上传失败，请检查网络"));
      },
    });
  });
}

// 发送时把来自 record 的 entryId / transcript 落到草稿、并创建 comic job。
// 返回匹配后端的 job_id 语义。
export async function createTextEntry(
  content: string,
  entryDate?: string,
  timezone?: string,
  localId?: string
): Promise<{ id: string; text: string }> {
  const key = localId || ensureIdempotencyKey();
  const res: any = await request("/api/v1/entries/text", {
    method: "POST",
    data: {
      local_id: key,
      text: content,
      entry_date: entryDate || nowIsoDate(),
      timezone: timezone || localTimezone(),
    },
    header: { "Idempotency-Key": key },
  });
  return { id: res.id, text: res.redacted_text || content };
}

export async function createComicJob(
  entryId: string,
  idempotencyKey = ensureIdempotencyKey()
): Promise<{ job_id: string; status: string }> {
  return await request<{ job_id: string; status: string }>(
    `/api/v1/entries/${entryId}/comic-jobs`,
    { method: "POST", header: { "Idempotency-Key": idempotencyKey } }
  );
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  return await request<JobStatus>(`/api/v1/jobs/${jobId}`);
}

export async function retryJob(jobId: string): Promise<{ job_id: string }> {
  return await request<{ job_id: string }>(`/api/v1/jobs/${jobId}/retry`, { method: "POST" });
}

export async function waitForJob(
  jobId: string,
  onProgress?: (status: JobStatus) => void,
  shouldContinue?: () => boolean
): Promise<JobStatus> {
  const deadline = Date.now() + 180000;
  let consecutiveNetworkErrors = 0;
  const maxConsecutiveNetworkErrors = 5;

  while (Date.now() < deadline) {
    // 页面销毁后应静默停止轮询（由调用方通过 shouldContinue 提供终止信号）
    if (shouldContinue && !shouldContinue()) throw new JobCanceledError();

    let status: JobStatus;
    try {
      status = await getJobStatus(jobId);
      consecutiveNetworkErrors = 0;
    } catch (err) {
      // 请求过程中页面可能已被销毁：若已取消则直接静默退出，不抛网络错误
      if (shouldContinue && !shouldContinue()) throw new JobCanceledError();
      const retryable = !(err instanceof ApiError) || err.status === 0 || err.status === 429 || err.status >= 500;
      if (!retryable) throw err;
      consecutiveNetworkErrors++;
      if (consecutiveNetworkErrors < maxConsecutiveNetworkErrors && Date.now() < deadline) {
        const remainingMs = deadline - Date.now();
        await new Promise((r) => setTimeout(r, Math.min(2000, remainingMs)));
        continue;
      }
      throw err;
    }
    if (shouldContinue && !shouldContinue()) throw new JobCanceledError();

    if (onProgress) onProgress(status);

    if (status.status === "done") return status;
    if (status.status === "failed" || status.status === "cancelled") {
      throw new ApiError(500, "job_failed", status.error || "图文日记生成失败，请稍后重试");
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await new Promise((r) => setTimeout(r, Math.min(2000, remainingMs)));
    }
  }
  throw new ApiError(408, "timeout", "日记生成耗时较长，已在后台为您继续生成，可稍后到书架查看");
}

/** 专用取消错误：表示轮询已随页面销毁而终止，调用方应静默吞掉，不提示失败。 */
export class JobCanceledError extends Error {
  constructor() {
    super("job_polling_cancelled");
    this.name = "JobCanceledError";
  }
}

// /api/v1/diaries → 真实 list[ComicGenerationResponse]，mapDiary 统一为 DiaryItem
export async function listDiaries(): Promise<DiaryItem[]> {
  const raw = await request<RawComicDiary[]>("/api/v1/diaries");
  if (Array.isArray(raw)) {
    return raw.map(mapDiary);
  }
  if (raw && typeof raw === "object") {
    const candidate = (raw as any).diaries || (raw as any).items || (raw as any).data;
    if (Array.isArray(candidate)) {
      return candidate.map(mapDiary);
    }
  }
  return [];
}

export async function getDiaryDetail(id: string): Promise<DiaryItem> {
  const raw = await request<RawComicDiary>(`/api/v1/diaries/${id}`);
  return mapDiary(raw);
}

export async function updateDiary(
  id: string,
  payload: { title: string; content: string; expected_version: number }
): Promise<DiaryItem> {
  const raw = await request<RawComicDiary>(`/api/v1/diaries/${id}`, { method: "PATCH", data: payload });
  return mapDiary(raw);
}

export async function deleteDiary(id: string): Promise<void> {
  await request(`/api/v1/diaries/${id}`, { method: "DELETE" });
}

export async function publishShare(payload: {
  artifact_id: string; caption: string; tags?: string[]; show_location?: boolean;
  hide_date?: boolean; is_public?: boolean;
}): Promise<SharePost> {
  return await request<SharePost>("/api/v1/shares", { method: "POST", data: payload });
}

export async function listShares(order: "recommend" | "latest" = "recommend"): Promise<SharePost[]> {
  return await request<SharePost[]>(`/api/v1/shares?order=${order}`);
}

export async function toggleShareReaction(postId: string, kind: "like" | "collect"):
Promise<{ active: boolean; count: number }> {
  return await request(`/api/v1/shares/${postId}/reactions/${kind}`, { method: "PUT" });
}

export async function updateShareVisibility(postId: string, isPublic: boolean): Promise<SharePost> {
  return await request<SharePost>(`/api/v1/shares/${postId}`, { method: "PATCH", data: { is_public: isPublic } });
}

export async function deleteShare(postId: string): Promise<void> {
  await request(`/api/v1/shares/${postId}`, { method: "DELETE" });
}

export async function reportShare(postId: string, reason: string, detail?: string): Promise<{ submitted: boolean }> {
  return await request(`/api/v1/shares/${postId}/reports`, { method: "POST", data: { reason, detail } });
}

// ==================== 陪伴萌宠 ====================

export interface PetChatResult {
  reply: string;
  pet_action?: string;
  referenced_memories?: string[];
}

export async function chatWithPet(
  message: string,
  opts?: { pet_name?: string; pet_type?: string; history?: Array<{ role: string; content: string }> }
): Promise<PetChatResult> {
  return await request<PetChatResult>("/api/v1/pet/chat", {
    method: "POST",
    timeout: 75000,
    data: {
      message,
      pet_name: opts?.pet_name || undefined,
      pet_type: opts?.pet_type || undefined,
      history: opts?.history || undefined,
    },
  });
}

export async function getPetStatus(petName = "Voonie"): Promise<{ greeting: string; status: string }> {
  try {
    const res = await request<{ greeting?: string; status?: string }>(`/api/v1/pet/status?pet_name=${encodeURIComponent(petName)}`);
    return {
      greeting: (res && res.greeting) || "小主人，今天过得怎么样呀？想和我说话，或唠叨心底的愿望？🐾",
      status: (res && res.status) || "ready",
    };
  } catch (err) {
    console.warn("getPetStatus fallback:", err);
    return {
      greeting: "小主人，今天过得怎么样呀？想和我说话，或唠叨心底的愿望？🐾",
      status: "ready",
    };
  }
}

export async function getPetMemories(query?: string): Promise<any[]> {
  try {
    const res = await request(`/api/v1/pet/memories${query ? `?query=${encodeURIComponent(query)}` : ""}`);
    if (Array.isArray(res)) {
      return res;
    }
    if (res && typeof res === "object") {
      const candidate = (res as any).memories || (res as any).items || (res as any).data;
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
    return [];
  } catch (err) {
    console.warn("getPetMemories fallback to empty array:", err);
    return [];
  }
}

// ==================== 契约适配层（Raw → DiaryItem） ====================
function mapDiary(raw: RawComicDiary): DiaryItem {
  if (!raw || typeof raw !== "object") {
    return {
      id: "",
      entry_id: "",
      title: "未命名手帐",
      summary: "",
      mood: "平静",
      full_content: "",
      created_at: "",
      panels: [],
      is_public: false,
    };
  }

  const rawPanels = Array.isArray(raw.panels) ? raw.panels : [];
  const panels: DiaryPanel[] = rawPanels.map((p, idx) => ({
    id: `panel-${(p && p.panel_id) || idx + 1}`,
    position: (p && p.panel_id) || idx + 1,
    title: (p && p.scene_desc) || "回忆画面",
    scene_prompt: `${(p && p.scene_desc) || ""} ${(p && p.character_action) || ""}`.trim(),
    narration: (p && (p.narration || p.speech_bubble?.text)) || "",
    dialogue: p && p.speech_bubble ? p.speech_bubble.text : undefined,
    sfx: p ? p.sfx || undefined : undefined,
    image_url: p ? p.image_url || undefined : undefined,
  }));

  const emotion = (raw.emotion && typeof raw.emotion === "object") ? raw.emotion : ({} as any);
  const moodLabel = emotion.emotion_label_zh || "平静";
  const organized = raw.organized_diary || raw.raw_transcript || "";

  // full_content 由“整理正文 + 由小宠物笔记/引言构成的摘要”拼装，保证阅读完整度
  const parts: string[] = [];
  if (organized) parts.push(organized);
  if (raw.key_quote) parts.push(`「${raw.key_quote}」`);
  if (emotion.analysis) parts.push(emotion.analysis);

  return {
    id: raw.job_id || raw.task_id || "",
    entry_id: raw.entry_id || raw.task_id || "",
    title: raw.title || "未命名手帐",
    summary: raw.companion_note || moodLabel,
    mood: moodLabel,
    mood_score: typeof emotion.mood_score === "number" ? emotion.mood_score : undefined,
    full_content: parts.join("\n\n") || raw.organized_diary || "",
    created_at: raw.created_at || "",
    date_label: formatDateLabel(raw.created_at),
    panels,
    is_public: false, // 后端暂无公开字段时坚持默认私密，避免客户端误判为公开
    edit_version: typeof raw.edit_version === "number" ? raw.edit_version : 0,
    entry_date: raw.entry_date || undefined,
    timezone: raw.timezone || undefined,
    updated_at: raw.updated_at || undefined,
  };
}

function formatDateLabel(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  return `${d.getMonth() + 1}月${d.getDate()}日 · 星期${days[d.getDay()]}`;
}

// ==================== 统一网络请求包装 ====================

let refreshPromise: Promise<boolean> | null = null;
async function request<T = any>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    data?: any;
    header?: Record<string, string>;
    timeout?: number;
  } = {},
  retry = true
): Promise<T> {
  const url = `${getApiBase()}${path}`;
  const token = getAccessToken();
  const deviceId = getDeviceId();

  const headers: Record<string, string> = Object.assign({
    "Content-Type": "application/json",
    "X-Device-Id": deviceId,
  }, options.header || {});
  if (token) headers["Authorization"] = `Bearer ${token}`;

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url,
      method: options.method || "GET",
      data: options.data,
      header: headers,
      timeout: options.timeout ?? 15000,
      success: async (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else if (res.statusCode === 401 && retry) {
          if (!refreshPromise) {
            refreshPromise = refreshSession().catch(() => false).finally(() => {
              refreshPromise = null;
            });
          }
          const refreshed = await refreshPromise;
          if (refreshed) {
            try {
              const retryRes = await request<T>(path, options, false);
              resolve(retryRes);
            } catch (retryErr) {
              reject(retryErr);
            }
          } else {
            clearTokens();
            reject(new ApiError(401, "unauthorized", "登录会话已过期，请重新登录"));
          }
        } else {
          const body: any = res.data || {};
          const backendError = body.error || {};
          const detail = body.detail || backendError.message;
          const msg =
            (typeof detail === "string" && detail) ||
            (Array.isArray(detail) && detail.map((d: any) => d.msg).join("; ")) ||
            body.message || backendError.message ||
            "请求失败，请稍后重试";
          reject(new ApiError(res.statusCode, body.code || backendError.code || "error", msg));
        }
      },
      fail: (err) => {
        const rawMessage = err.errMsg || "";
        const isDomainError = /domain|合法域名|not in domain list/i.test(rawMessage);
        reject(new ApiError(
          0,
          isDomainError ? "request_domain_not_configured" : "network_error",
          isDomainError ? "服务器域名尚未生效，请更新小程序版本后重试" : "网络连接异常，请检查网络后重试"
        ));
      },
    });
  });
}
