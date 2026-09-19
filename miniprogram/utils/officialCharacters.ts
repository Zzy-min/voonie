export interface OfficialCharacter {
  id: string;
  name: string;
  avatar: string;
  tagline: string;
  recommendedFor: string;
  appearancePrompt: string;
  stylePreset: "chibi_manga" | "warm_watercolor" | "anime_cel" | "retro_comic";
}

// 官方角色是日记中的人类主人公。Vonnie 始终是陪伴者，不能与主人公融合。
export const OFFICIAL_CHARACTERS: OfficialCharacter[] = [
  {
    id: "xia",
    name: "小夏",
    avatar: "/assets/images/characters/xia.jpg",
    tagline: "短发、圆眼镜与黄色连帽衫",
    recommendedFor: "默认形象 · 日常与校园",
    appearancePrompt: "Xia, a clearly human East Asian woman in her early twenties, short chestnut-brown bob hair, warm brown eyes, thin round glasses, oversized mustard-yellow hoodie, natural human face and anatomy",
    stylePreset: "warm_watercolor",
  },
  {
    id: "chen",
    name: "阿澈",
    avatar: "/assets/images/characters/chen.jpg",
    tagline: "黑色短发与鼠尾草绿开衫",
    recommendedFor: "安静记录 · 工作与学习",
    appearancePrompt: "Chen, a clearly human East Asian man in his early twenties, neat soft black short hair, gentle dark eyes, oatmeal shirt and muted sage cardigan, natural human face and anatomy",
    stylePreset: "warm_watercolor",
  },
  {
    id: "nan",
    name: "南乔",
    avatar: "/assets/images/characters/nan.jpg",
    tagline: "深棕长发与豆沙色针织衫",
    recommendedFor: "成熟叙事 · 生活与情绪",
    appearancePrompt: "Nan, a clearly human East Asian woman in her mid twenties, long dark-brown hair loosely tied low, almond-shaped eyes, dusty-rose knit sweater, natural human face and anatomy",
    stylePreset: "warm_watercolor",
  },
  {
    id: "mu",
    name: "木木",
    avatar: "/assets/images/characters/mu.jpg",
    tagline: "利落短发与浅蓝牛仔外套",
    recommendedFor: "轻松日常 · 中性形象",
    appearancePrompt: "Mu, a clearly human androgynous East Asian adult in their early twenties, tidy dark pixie haircut, clear dark eyes, light denim overshirt over an ivory tee, natural human face and anatomy",
    stylePreset: "warm_watercolor",
  },
];

export function getOfficialCharacter(value: string): OfficialCharacter | undefined {
  const id = value.startsWith("official:") ? value.slice(9) : value;
  return OFFICIAL_CHARACTERS.find((item) => item.id === id);
}
