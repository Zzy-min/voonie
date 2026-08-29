from typing import List, Optional, Literal
from pydantic import BaseModel, Field

class EmotionSummary(BaseModel):
    primary_emotion: str = Field(description="主导情绪，如: joy, relaxed, anxious, sad, healing, excited")
    emotion_label_zh: str = Field(description="中文情绪标签，如: 治愈/开心/焦虑/疲惫/平静")
    mood_score: int = Field(ge=1, le=10, description="1-10 情绪得分")
    analysis: str = Field(description="简要心理情绪分析与共情总结")

class CharacterConfig(BaseModel):
    character_name: str = "我"
    appearance_prompt: str = "a young girl with short brown hair, round glasses, wearing an oversized yellow hoodie"
    style_preset: Literal["chibi_manga", "warm_watercolor", "anime_cel", "retro_comic"] = "chibi_manga"

class SpeechBubble(BaseModel):
    text: str = Field(description="对白或心声文字")
    bubble_type: Literal["speech", "thought", "exclamation", "whisper"] = "speech"


class EmotionPoint(BaseModel):
    label: str = Field(description="该阶段的中文情绪，例如烦躁、低落、平静、开心、治愈")
    intensity: int = Field(ge=1, le=10, description="该阶段的情绪强度")
    evidence: str = Field(description="来自用户原话的简短依据，不得虚构")

class ComicPanel(BaseModel):
    panel_id: int = Field(ge=1, le=8, description="插图序号；单篇图文日记使用 1-5")
    shot_type: Literal["close_up", "medium_shot", "wide_angle", "panoramic"] = "medium_shot"
    scene_desc: str = Field(description="画面场景与环境描述")
    character_action: str = Field(description="角色动作与面部表情")
    narration: Optional[str] = Field(default=None, description="旁白文字 (可选)")
    speech_bubble: Optional[SpeechBubble] = Field(default=None, description="气泡对话 (可选)")
    sfx: Optional[str] = Field(default=None, description="拟声词，如: 哗啦啦, 叮咚, 呼呼")
    image_url: Optional[str] = Field(default=None, description="生成的单格图片 URL")
    source_excerpt: str = Field(default="", description="支撑该画面的用户原话片段")
    anchor_text: str = Field(default="", description="整理版日记中用于就近插入图片的原文锚点")
    emotion_label: str = Field(default="平静", description="该记忆瞬间的情绪")
    visual_reason: str = Field(default="", description="为什么这个真实瞬间值得被画下来")
    forbidden: list[str] = Field(default_factory=lambda: ["readable chinese text in the image"])

class Storyboard(BaseModel):
    title: str = Field(description="图文日记标题")
    organized_diary: str = Field(default="", description="保留完整原始语义、仅做轻度整理的第一人称日记正文")
    emotion: EmotionSummary
    emotion_curve: List[EmotionPoint] = Field(
        default_factory=list,
        max_length=8,
        description="按讲述顺序提炼的真实情绪变化",
    )
    key_quote: Optional[str] = Field(default=None, description="用户当天最值得保留的一句原话")
    panels: List[ComicPanel] = Field(
        min_length=1,
        max_length=5,
        description="少而准确、带正文锚点的记忆插图",
    )
    companion_note: str = Field(description="小宠物给用户的专属暖心便签(20-40字)")

class GenerateComicFromTextRequest(BaseModel):
    text: str = Field(min_length=5, description="日记语音转录文本或直接输入的文本")
    character: CharacterConfig = Field(default_factory=CharacterConfig)
    custom_style: Optional[str] = None
    ref_image_b64: Optional[str] = Field(default=None, description="生活照片或参考图(Base64编码)")

class RegeneratePanelRequest(BaseModel):
    custom_prompt: Optional[str] = Field(default=None, description="微调提示词或场景补充")
    character: Optional[CharacterConfig] = None
    custom_style: Optional[str] = None

class ComicGenerationResponse(BaseModel):
    task_id: str
    job_id: Optional[str] = None
    entry_id: Optional[str] = None
    title: str
    raw_transcript: str
    organized_diary: str
    emotion: EmotionSummary
    emotion_curve: List[EmotionPoint]
    key_quote: Optional[str] = None
    panels: List[ComicPanel]
    composite_comic_url: Optional[str] = None
    companion_note: str
    created_at: str

class MemoryContextItem(BaseModel):
    happened_date: str
    title: str
    summary: str
    emotion: str

class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant", "bot"]
    content: str

class PetChatRequest(BaseModel):
    message: str = Field(description="用户与宠物聊天的消息")
    pet_name: str = "Voonie"
    pet_type: Literal["cat", "dog", "dino"] = "dog"
    user_nickname: Optional[str] = None
    history: Optional[List[ChatHistoryItem]] = Field(default=None, description="前几轮对话历史上下文")
    local_memory_context: Optional[List[MemoryContextItem]] = Field(
        default=None, 
        description="Deprecated and ignored; history is retrieved from authenticated server-side data"
    )
    recent_mood_trend: Optional[str] = None
    stream: bool = False

class PetChatResponse(BaseModel):
    reply: str = Field(description="宠物的共情/回忆回复")
    pet_action: Literal["happy", "comfort", "think", "wave", "sleepy", "play", "look", "sleep"] = "happy"
    referenced_memories: Optional[List[str]] = Field(default=None, description="引用的历史日记日期或标题")
