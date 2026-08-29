from datetime import date, timedelta
from typing import Any, List, Optional
from voonie.backend.app.core.config import Settings, settings
from voonie.backend.app.models.schemas import MemoryContextItem, PetChatResponse
from voonie.backend.app.providers.llm import LLMProvider, get_pet_llm_provider

class PetCompanionAgent:
    """AI 宠物伴侣心理情绪与历史记忆交互 Agent"""

    SYSTEM_PROMPT = """你叫 Voonie，是一只可爱、温暖、充满治愈力的橘白相间小狗，是小主人的专属桌面宠物兼日记守护者。
你的性格特点：
1. 温暖治愈、富有同理心、活泼可爱（会适时摇尾巴、歪头、用毛茸茸的爪爪给小主人打气）。
2. 真实记忆与诚实原则：
   - 当下方【小主人记录的生活日记与过往回忆】提供了相关日记点滴时，自然地结合真实记录予以回应（例如：“我翻了翻你最近留下的日记，发现前几天在《xxx》里你也有提到…”）；并在 referenced_memories 中返回引用的日记标题或日期。
   - 当小主人询问过去的经历、特定事件或习惯（例如“我上次去那家店是什么时候”、“我之前写过什么”），但下方回忆记录中【并没有相关内容】时：请诚实、温柔地告诉小主人你暂时还没找到相关的日记记录，鼓励小主人随时写下来，【严禁凭空捏造、杜撰不存在的日期、地点或事件】！
   - 普通日常问候（如“你好”、“早安”、“在干嘛”）：亲昵回应即可，无需刻意罗列日记，referenced_memories 返回空数组。
3. 心理支持原则（基于积极心理学与认知同理）：
   - 倾听与接纳：先感知小主人的情绪，给予温暖抱抱与情绪舒缓；
   - 亲切称呼小主人：在对话中自然称呼小主人的昵称。
4. 语言精炼自然：普通回复控制在 1-3 句，不要长篇说教、不要像数据库查询机器人一样输出机械列表。
5. 输出严格的 JSON 格式：
{
  "reply": "小狗的温暖回复文本（以小狗第一人称，语气亲切治愈）",
  "pet_action": "happy / comfort / think / wave / sleepy",
  "referenced_memories": ["引用的具体日记标题或日期"]
}
"""

    CRISIS_KEYWORDS = (
        "自杀", "自残", "不想活", "结束生命", "伤害自己", "活不下去",
    )

    RETRIEVAL_CUES = (
        "之前", "以前", "过去", "上次", "最近", "这几天", "那天", "后来", "之后",
        "日记", "回忆", "记录", "还记得", "记不记得", "提到", "我说过", "我是不是",
        "经常", "总在", "总是", "为什么我", "什么时候", "去过", "吃过", "学过",
        "考过", "查查", "翻翻",
    )

    REFLECTIVE_CUES = (
        "有什么", "发生了什么", "哪些", "哪件", "哪次", "值得", "为什么",
        "怎么样", "如何", "是不是", "有没有", "做过", "写过", "说过",
    )

    PERSONAL_CONTEXT_CUES = (
        "今天", "今日", "昨天", "昨晚", "前天", "这周", "本周", "这个月", "本月", "这段时间",
        "开心", "高兴", "难过", "伤心", "焦虑", "疲惫", "累", "心情", "事情", "经历",
        "生活", "习惯", "工作", "学习", "项目",
    )

    @classmethod
    def should_retrieve_memory(cls, message: str) -> bool:
        msg = message.strip().lower()
        if len(msg) <= 2 and msg in ("hi", "嗨", "喂", "早", "好"):
            return False
        if msg in ("你好", "你好呀", "你好啊", "早安", "午安", "晚安", "拜拜", "再见", "谢谢", "摸摸头", "抱抱", "今天挺开心的"):
            return False
        if any(cue in msg for cue in cls.RETRIEVAL_CUES):
            return True
        has_reflective_intent = any(cue in msg for cue in cls.REFLECTIVE_CUES)
        has_personal_context = any(cue in msg for cue in cls.PERSONAL_CONTEXT_CUES)
        return has_reflective_intent and has_personal_context

    def __init__(
        self,
        provider: LLMProvider | None = None,
        app_settings: Settings = settings,
    ) -> None:
        self.provider = provider or get_pet_llm_provider(app_settings)

    @staticmethod
    def _label_memory_date(value: str, today_date: str) -> str:
        if not value or not today_date:
            return value
        try:
            memory_day = date.fromisoformat(value)
            current_day = date.fromisoformat(today_date)
        except ValueError:
            return value
        if memory_day == current_day:
            return f"{value}（今天）"
        if memory_day == current_day - timedelta(days=1):
            return f"{value}（昨天）"
        return value

    async def chat(
        self, 
        message: str, 
        pet_name: str = "Voonie", 
        pet_type: str = "dog",
        user_nickname: str = "小主人",
        user_quote: str = "",
        user_quote_note: str = "",
        time_context: str = "",
        today_date: str = "",
        total_diaries_count: int = 0,
        recent_diaries: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        local_memory_context: Optional[List[MemoryContextItem]] = None,
        recent_mood_trend: str = "平静"
    ) -> PetChatResponse:
        if any(keyword in message for keyword in self.CRISIS_KEYWORDS):
            return PetChatResponse(
                reply=(
                    "我很在意你现在的安全。请先离开可能伤害自己的物品或地方，"
                    "马上联系一位你信任的人陪在身边。如有立即危险，请拨打 110 或 120；"
                    "也可拨打 12356 心理援助热线。我可以继续听你说，但不能代替专业的紧急帮助。"
                ),
                pet_action="comfort",
                referenced_memories=[],
            )

        has_memory_cues = self.should_retrieve_memory(message) or bool(local_memory_context)

        snippets = []
        if has_memory_cues and recent_diaries:
            for d in recent_diaries[:5]:
                date_str = self._label_memory_date(d.get("date", ""), today_date)
                title = d.get("title", "日记")
                text = d.get("text", "")
                emotion = d.get("emotion", "")
                snippets.append(f"- [{date_str}] 《{title}》: {text} (心情: {emotion})")

        if local_memory_context:
            for m in local_memory_context:
                if isinstance(m, dict):
                    memory_date = self._label_memory_date(m.get("happened_date", ""), today_date)
                    snippets.append(f"- [{memory_date}] 《{m.get('title', '')}》: {m.get('summary', '')} (心情: {m.get('emotion', '')})")
                else:
                    memory_date = self._label_memory_date(m.happened_date, today_date)
                    snippets.append(f"- [{memory_date}] 《{m.title}》: {m.summary} (心情: {m.emotion})")

        if snippets:
            context_str = "\n".join(snippets)
        elif has_memory_cues:
            context_str = "（目前小主人还没有写下相关的日记点滴）"
        else:
            context_str = "（本轮没有调用历史记忆，请作为安静倾听的小狗陪伴，普通回复控制在 20-60 个中文字符）"

        quote_str = f"“{user_quote}” — {user_quote_note}" if user_quote else "“生活或许忙碌，但记得停下来，听一听自己的声音。”"

        history_str = ""
        if history:
            turns = []
            for h in history[-8:]:
                speaker = user_nickname if h.get("role") in ("user",) else pet_name
                turns.append(f"{speaker}: {h.get('content', '')}")
            if turns:
                history_str = "\n".join(turns)

        history_block = f"""
【前几轮对话上下文】：
{history_str}
""" if history_str else ""

        user_input_prompt = f"""
【当前现实时间与小主人账户】：
- 时间：{time_context or "今日"}
- 小主人称呼：{user_nickname}
- 小主人的心语座右铭：{quote_str}
- 小主人已记录日记总数：{total_diaries_count} 篇
- 小主人最近心情走势：{recent_mood_trend}

【小主人记录的生活日记与过往记忆】：
{context_str}
{history_block}
【小主人刚刚对你说】：
"{message}"

请以小宠物 {pet_name}（可爱治愈的橘白相间小{pet_type}）的第一人称生成温暖、共情、贴心的回复：
1. 语言自然亲昵，自然称呼小主人（{user_nickname}）；
2. 深度了解小主人的生活：当小主人聊到相关事情、心情、或者询问你是否知道/记得某些过去的事时，主动且贴心地联系上方的日记与生活回忆给予温暖回应与陪伴；
3. 如果本轮回复中提及或引用了小主人的日记或生活回忆，请在 referenced_memories 中返回对应的日记标题或日期；如未提及过去日记，referenced_memories 返回空数组；
4. 严格按照每条记录括号中的相对日期称呼：今天的日记不得称为“昨天”，昨天的日记不得称为“今天”；
5. 输出严格的 JSON 格式。
"""
        parsed = await self.provider.complete_json(self.SYSTEM_PROMPT, user_input_prompt)
        response = PetChatResponse.model_validate(parsed)
        if not has_memory_cues:
            response.referenced_memories = []
        return response
