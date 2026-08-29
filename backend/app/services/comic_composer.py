from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
from typing import List
from voonie.backend.app.models.schemas import ComicPanel, Storyboard
from voonie.backend.app.services.storage_service import StorageService, storage_service

class ComicComposer:
    """将 4 格分镜组合排版成完整连环画条漫"""

    def __init__(self, storage: StorageService = storage_service) -> None:
        self.storage = storage

    def compose_4panel_strip(
        self,
        storyboard: Storyboard,
        panel_image_paths: List[Path],
        output_id: str | None = None,
    ) -> Path:
        panel_w, panel_h = 700, 700
        margin = 40
        header_h = 140
        footer_h = 100
        spacing = 30
        
        total_w = panel_w + margin * 2
        total_h = header_h + 4 * panel_h + 3 * spacing + footer_h + margin
        
        # 创建复古温暖漫画画纸背景色 (Cream White)
        canvas = Image.new("RGBA", (total_w, total_h), (252, 250, 245, 255))
        draw = ImageDraw.Draw(canvas)
        
        # 绘制顶部标题区域
        draw.rectangle([margin, 20, total_w - margin, header_h - 10], fill=(255, 255, 255), outline=(60, 60, 60), width=3)
        draw.text((margin + 30, 40), f"✦ Voonie Comic Diary ✦", fill=(240, 100, 80))
        draw.text((margin + 30, 75), f"《{storyboard.title}》", fill=(30, 30, 30))
        draw.text((total_w - margin - 180, 78), f"Mood: {storyboard.emotion.emotion_label_zh}", fill=(100, 120, 160))
        
        current_y = header_h
        
        for i, (panel, img_path) in enumerate(zip(storyboard.panels, panel_image_paths)):
            # 打开单格图片并调整尺寸
            if img_path.exists():
                with Image.open(img_path) as p_img:
                    p_resized = p_img.convert("RGBA").resize((panel_w, panel_h))
                    canvas.paste(p_resized, (margin, current_y), p_resized)
            
            # 绘制坚固的漫画格边框
            draw.rectangle([margin, current_y, margin + panel_w, current_y + panel_h], outline=(40, 40, 40), width=4)
            
            # 绘制分镜标号
            draw.ellipse([margin + 15, current_y + 15, margin + 55, current_y + 55], fill=(40, 40, 40))
            draw.text((margin + 30, current_y + 25), str(panel.panel_id), fill=(255, 255, 255))
            
            # 绘制旁白条 (Narration Banner)
            if panel.narration:
                banner_y = current_y + 15
                banner_x = margin + 70
                draw.rectangle([banner_x, banner_y, banner_x + 360, banner_y + 35], fill=(255, 255, 255, 230), outline=(50, 50, 50), width=2)
                draw.text((banner_x + 10, banner_y + 8), panel.narration, fill=(30, 30, 30))
            
            # 绘制对白气泡 (Speech Bubble)
            if panel.speech_bubble and panel.speech_bubble.text:
                bubble_text = panel.speech_bubble.text
                bubble_x = margin + 40
                bubble_y = current_y + panel_h - 90
                bubble_w = min(panel_w - 80, len(bubble_text) * 22 + 40)
                
                # 气泡背景
                bubble_bg = (255, 255, 255)
                outline_c = (40, 40, 40)
                draw.rounded_rectangle([bubble_x, bubble_y, bubble_x + bubble_w, bubble_y + 60], radius=15, fill=bubble_bg, outline=outline_c, width=3)
                # 气泡小角 (Tail)
                draw.polygon([(bubble_x + 30, bubble_y + 60), (bubble_x + 45, bubble_y + 75), (bubble_x + 55, bubble_y + 60)], fill=bubble_bg, outline=outline_c)
                draw.line([(bubble_x + 31, bubble_y + 59), (bubble_x + 54, bubble_y + 59)], fill=bubble_bg, width=4) # 擦除连接线
                draw.text((bubble_x + 15, bubble_y + 18), bubble_text, fill=(20, 20, 20))
            
            # 绘制拟声词 (SFX)
            if panel.sfx:
                draw.text((margin + panel_w - 180, current_y + 40), f"⚡ {panel.sfx}", fill=(240, 60, 60))
            
            current_y += panel_h + spacing
        
        # 底部小宠物便签
        footer_y = current_y
        draw.rectangle([margin, footer_y, total_w - margin, footer_y + footer_h - 20], fill=(255, 248, 230), outline=(220, 180, 100), width=2)
        draw.text((margin + 20, footer_y + 15), "🐾 Voonie 暖心便签：", fill=(210, 120, 30))
        draw.text((margin + 20, footer_y + 45), storyboard.companion_note, fill=(70, 70, 70))
        
        out_file = self.storage.base_dir / f"comic_strip_{output_id or 'preview'}.png"
        canvas.save(out_file, format="PNG")
        return out_file

comic_composer = ComicComposer()
