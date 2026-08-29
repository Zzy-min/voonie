const DEVICE_KEY = "voonie-device-id";
const DEVICE_SECRET_KEY = "voonie-device-secret";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
let sessionReady = false;
let sessionPromise: Promise<void> | null = null;
let refreshPromise: Promise<boolean> | null = null;

function apiPath(path: string) {
  return `${API_BASE}${path}`;
}

export function mediaUrl(value?: string | null) {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return apiPath(value.startsWith("/") ? value : `/${value}`);
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function friendlyGenerationError(error?: string | null) {
  if (error === "image_prompt_rejected") {
    return "这段内容暂时无法生成插图，日记文字已保留，请稍后重试。";
  }
  return "图文日记生成失败，请稍后重试。日记文字已保留。";
}

function randomId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function deviceId() {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = randomId("device");
  localStorage.setItem(DEVICE_KEY, created);
  return created;
}

function deviceSecret() {
  return localStorage.getItem(DEVICE_SECRET_KEY) || undefined;
}

async function parseError(response: Response) {
  try {
    const body = await response.json();
    const error = body.error ?? body.detail ?? {};
    let message = "";
    if (typeof body.error === "object" && body.error?.message) {
      message = body.error.message;
    } else if (typeof body.detail === "string") {
      message = body.detail;
    } else if (Array.isArray(body.detail) && body.detail.length > 0) {
      message = body.detail
        .map((d: { msg?: string; message?: string }) => d.msg || d.message)
        .filter(Boolean)
        .join("；");
    } else if (typeof error === "string") {
      message = error;
    } else if (error && typeof error.message === "string") {
      message = error.message;
    } else if (error && typeof error.msg === "string") {
      message = error.msg;
    }

    if (!message || message === "Internal Server Error" || message === "Bad Request") {
      if (response.status === 422) message = "输入内容格式有误，请检查后重试";
      else if (response.status === 413) message = "音频或内容过长，请精简后重试";
      else if (response.status === 415) message = "音频格式暂不支持，请直接在输入框打字记录";
      else if (response.status === 503) message = "语音服务暂未就绪，可以直接在上方输入框打字记录";
      else if (response.status >= 500) message = "服务器处理出错，请重试或直接打字记录";
      else message = "操作失败，请稍后重试";
    }

    return new ApiError(
      response.status,
      body.error?.code ?? error?.code ?? "request_failed",
      message,
    );
  } catch {
    let fallback = "操作失败，请稍后重试";
    if (response.status >= 500) fallback = "服务器暂时不可用，请稍后重试";
    return new ApiError(response.status, "request_failed", fallback);
  }
}

async function request(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const response = await fetch(apiPath(path), {
    ...init,
    headers,
    credentials: "include",
  });
  if (response.status !== 401 || !retry) return response;
  const refreshed = await refreshSession();
  if (!refreshed) return response;
  return request(path, init, false);
}

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(apiPath("/api/v1/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        sessionReady = false;
        return false;
      }
      sessionReady = true;
      return true;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export interface UserProfile {
  id: string;
  email?: string | null;
  nickname: string;
  quote: string;
  quote_note: string;
  memory_opt_in: boolean;
  created_at?: string | null;
}

export async function getCurrentUser(): Promise<UserProfile | null> {
  try {
    const response = await fetch(apiPath("/api/v1/auth/me"), {
      method: "GET",
      credentials: "include",
    });
    if (response.ok) {
      const data = await response.json();
      sessionReady = true;
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function registerWithEmail(params: {
  email: string;
  password: string;
  confirm_password?: string;
  nickname?: string;
}): Promise<UserProfile> {
  const response = await fetch(apiPath("/api/v1/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  if (!response.ok) throw await parseError(response);
  sessionReady = true;
  const me = await getCurrentUser();
  if (me) return me;
  const data = await response.json();
  return {
    id: data.user_id,
    email: data.email,
    nickname: data.nickname || "小主人",
    quote: "生活或许忙碌，但记得停下来，听一听自己的声音。",
    quote_note: "今天也值得被好好收藏。",
    memory_opt_in: true,
  };
}

export async function loginWithEmail(params: {
  email: string;
  password: string;
}): Promise<UserProfile> {
  const response = await fetch(apiPath("/api/v1/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  if (!response.ok) throw await parseError(response);
  sessionReady = true;
  const me = await getCurrentUser();
  if (me) return me;
  const data = await response.json();
  return {
    id: data.user_id,
    email: data.email,
    nickname: data.nickname || "小主人",
    quote: "生活或许忙碌，但记得停下来，听一听自己的声音。",
    quote_note: "今天也值得被好好收藏。",
    memory_opt_in: true,
  };
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch(apiPath("/api/v1/auth/logout"), {
      method: "POST",
      credentials: "include",
    });
  } catch {}
  sessionReady = false;
  localStorage.removeItem(DEVICE_KEY);
  localStorage.removeItem(DEVICE_SECRET_KEY);
}

export async function ensureSession() {
  if (sessionReady) return;
  if (!sessionPromise) {
    sessionPromise = (async () => {
      // 1. First try existing cookie session
      const user = await getCurrentUser();
      if (user) {
        sessionReady = true;
        return;
      }

      // 2. Fallback to device guest session
      let currentDeviceId = deviceId();
      let currentDeviceSecret = deviceSecret();

      let response = await fetch(apiPath("/api/v1/auth/device"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          device_id: currentDeviceId,
          device_secret: currentDeviceSecret,
          app_version: "web-v2",
        }),
      });

      // If device proof is required (e.g. stale device ID in localStorage without proof),
      // generate a fresh device ID and re-register
      if (response.status === 401) {
        localStorage.removeItem(DEVICE_KEY);
        localStorage.removeItem(DEVICE_SECRET_KEY);
        currentDeviceId = deviceId();
        currentDeviceSecret = undefined;

        response = await fetch(apiPath("/api/v1/auth/device"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            device_id: currentDeviceId,
            app_version: "web-v2",
          }),
        });
      }

      if (!response.ok) throw await parseError(response);
      const data = await response.json().catch(() => null);
      if (data?.device_secret) {
        localStorage.setItem(DEVICE_SECRET_KEY, data.device_secret);
      }
      sessionReady = true;
    })().finally(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  await ensureSession();
  const headers = new Headers(init.headers);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  const response = await request(path, { ...init, headers });
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function newLocalId(kind: string) {
  return randomId(kind);
}

export type EntryRecord = {
  id: string;
  local_id: string;
  entry_date: string;
  timezone: string;
  input_type: "text" | "voice";
  redacted_text: string;
  emotion: { label?: string; intensity?: number; description?: string };
  events: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
};

export type JobStatus = {
  job_id: string;
  status: string;
  stage: string;
  progress: number;
  error: string | null;
  result: {
    title?: string;
    companion_note?: string;
    organized_diary?: string;
    emotion?: { emotion_label_zh?: string; mood_score?: number };
    emotion_curve?: Array<{ label: string; intensity: number; evidence: string }>;
    key_quote?: string | null;
    panels?: Array<{
      panel_id: number;
      narration?: string | null;
      speech_bubble?: { text?: string } | null;
      image_url?: string | null;
      source_excerpt?: string;
      anchor_text?: string;
      emotion_label?: string;
      visual_reason?: string;
    }>;
    composite_comic_url?: string | null;
    artifact_id?: string;
    entry_id?: string;
    raw_transcript?: string;
  } | null;
};

export type DiaryRecord = {
  job_id: string;
  entry_id?: string;
  title: string;
  raw_transcript?: string;
  organized_diary?: string;
  companion_note: string;
  emotion: { emotion_label_zh: string; mood_score: number };
  emotion_curve?: Array<{ label: string; intensity: number; evidence: string }>;
  key_quote?: string | null;
  panels: Array<{
    image_url?: string | null;
    narration?: string | null;
    speech_bubble?: { text?: string } | null;
    source_excerpt?: string;
    anchor_text?: string;
    emotion_label?: string;
    visual_reason?: string;
  }>;
  composite_comic_url?: string | null;
  created_at: string;
};

export type ArtifactRecord = {
  id: string;
  job_id: string;
  entry_id: string | null;
  title: string;
  emotion_label: string;
  mood_score: number;
  companion_note: string;
  composite_url: string | null;
  panels: Array<{
    panel_no: number;
    image_url: string | null;
    storyboard: Record<string, unknown>;
  }>;
  created_at: string;
};

export async function listEntries(date?: string, timezone = "Asia/Shanghai") {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  query.set("timezone", timezone);
  return apiJson<{ items: EntryRecord[]; next_cursor: string | null }>(
    `/api/v1/entries?${query.toString()}`,
  );
}

export async function createTextEntry(text: string) {
  const localId = newLocalId("entry");
  return apiJson<EntryRecord>("/api/v1/entries/text", {
    method: "POST",
    headers: { "Idempotency-Key": localId },
    body: JSON.stringify({
      local_id: localId,
      text,
      entry_date: new Date().toISOString(),
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    }),
  });
}

export async function getEntry(entryId: string) {
  return apiJson<EntryRecord>(`/api/v1/entries/${entryId}`);
}

export async function updateTextEntry(entryId: string, text: string) {
  return apiJson<EntryRecord>(`/api/v1/entries/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify({ text }),
  });
}

export async function deleteEntry(entryId: string) {
  return apiJson<void>(`/api/v1/entries/${entryId}`, { method: "DELETE" });
}

export async function createVoiceEntry(file: Blob, signal?: AbortSignal) {
  const localId = newLocalId("voice");
  const form = new FormData();
  const extension = file.type.includes("webm")
    ? "webm"
    : file.type.includes("mp4")
      ? "m4a"
      : "wav";
  form.set("audio_file", file, `voice.${extension}`);
  form.set("local_id", localId);
  form.set("entry_date", new Date().toISOString());
  form.set(
    "timezone",
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
  );
  return apiJson<EntryRecord>("/api/v1/entries/voice", {
    method: "POST",
    headers: { "Idempotency-Key": localId },
    body: form,
    signal,
  });
}

export async function createComicJob(
  entryId: string,
  refImageB64?: string,
  stylePreset?: string,
) {
  return apiJson<{ job_id: string }>(
    "/api/v1/entries/" + entryId + "/comic-jobs",
    {
      method: "POST",
      body: JSON.stringify({
        ref_image_b64: refImageB64 || undefined,
        character: stylePreset ? { style_preset: stylePreset } : undefined,
      }),
    },
  );
}

export async function getJob(jobId: string, signal?: AbortSignal) {
  return apiJson<JobStatus>(`/api/v1/jobs/${jobId}`, { signal });
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export async function waitForJob(
  jobId: string,
  onProgress?: (job: JobStatus) => void,
  signal?: AbortSignal,
) {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    signal?.throwIfAborted();
    const job = await getJob(jobId, signal);
    onProgress?.(job);
    if (["done", "failed", "cancelled"].includes(job.status)) return job;
    await abortableDelay(800, signal);
  }
  throw new ApiError(504, "job_timeout", "生成超时，请稍后重试");
}

export async function listDiaries() {
  return apiJson<DiaryRecord[]>("/api/v1/diaries");
}

export async function regenerateDiaryPanel(
  jobId: string,
  panelNo: number,
  customPrompt?: string,
) {
  return apiJson<DiaryRecord>(
    `/api/v1/diaries/${jobId}/panels/${panelNo}/regenerate`,
    {
      method: "POST",
      body: JSON.stringify({ custom_prompt: customPrompt || undefined }),
    },
  );
}

export async function deleteDiary(jobId: string) {
  return apiJson<void>(`/api/v1/diaries/${jobId}`, { method: "DELETE" });
}

export async function chatWithPet(
  message: string,
  userNickname?: string,
  history?: Array<{ role: "user" | "assistant" | "bot"; content: string }>,
) {
  const normalizedHistory = history?.map((h) => ({
    role: h.role === "bot" ? "assistant" : h.role,
    content: h.content,
  }));

  return apiJson<{ reply: string; pet_action: string; referenced_memories?: string[] }>("/api/v1/pet/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      pet_name: "Voonie",
      pet_type: "dog",
      user_nickname: userNickname || undefined,
      history: normalizedHistory && normalizedHistory.length > 0 ? normalizedHistory : undefined,
    }),
  });
}

export type Preferences = {
  user_id: string;
  nickname: string;
  quote: string;
  quote_note: string;
  memory_opt_in: boolean;
};

export async function getPreferences() {
  return apiJson<Preferences>("/api/v1/me/preferences");
}

export async function updatePreferences(
  payload: Partial<Omit<Preferences, "user_id">>,
) {
  return apiJson<Preferences>("/api/v1/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function exportMyData() {
  return apiJson<{
    exported_at: string;
    user: Preferences;
    entries: unknown[];
    artifacts: unknown[];
  }>("/api/v1/me/export", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function deleteMyData() {
  try {
    await apiJson<void>("/api/v1/me/data", { method: "DELETE" });
  } finally {
    localStorage.removeItem(DEVICE_KEY);
    localStorage.removeItem(DEVICE_SECRET_KEY);
    sessionReady = false;
  }
}

export async function cancelJob(jobId: string) {
  return apiJson<{ job_id: string; status: string }>(
    `/api/v1/jobs/${jobId}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}
