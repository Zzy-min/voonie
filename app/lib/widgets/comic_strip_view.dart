import 'package:flutter/material.dart';
import 'package:voonie_app/models/diary_entry.dart';
import 'package:voonie_app/services/api_service.dart';

class ComicStripView extends StatelessWidget {
  final DiaryEntry diary;

  const ComicStripView({Key? key, required this.diary}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFFCFAF5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF333333), width: 2.5),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1A000000),
            offset: Offset(4, 4),
            blurRadius: 0,
          ),
        ],
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  "《${diary.title}》",
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF222222),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFECE5),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFFF8A65)),
                ),
                child: Text(
                  "✨ ${diary.emotionLabelZh}",
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFFD84315)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (diary.compositeComicUrl != null && diary.compositeComicUrl!.isNotEmpty)
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: FutureBuilder<Map<String, String>>(
                future: ApiService.mediaHeaders(),
                builder: (context, snapshot) => snapshot.hasData
                    ? Image.network(
                        diary.compositeComicUrl!,
                        headers: snapshot.data,
                        fit: BoxFit.contain,
                        errorBuilder: (_, __, ___) => _buildPanelsGrid(),
                      )
                    : const Center(child: CircularProgressIndicator()),
              ),
            )
          else
            _buildPanelsGrid(),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF9E6),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFFFFD54F), width: 1.5),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text("🐾 ", style: TextStyle(fontSize: 16)),
                Expanded(
                  child: Text(
                    diary.companionNote,
                    style: const TextStyle(fontSize: 13, color: Color(0xFF5D4037), height: 1.4),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPanelsGrid() {
    return Column(
      children: diary.panels.map((panel) {
        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border.all(color: const Color(0xFF333333), width: 2),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Stack(
            children: [
              Container(
                height: 220,
                width: double.infinity,
                color: const Color(0xFFF7F7F7),
                child: panel.imageUrl != null
                    ? FutureBuilder<Map<String, String>>(
                        future: ApiService.mediaHeaders(),
                        builder: (context, snapshot) => snapshot.hasData
                            ? Image.network(panel.imageUrl!, headers: snapshot.data, fit: BoxFit.cover)
                            : const Center(child: CircularProgressIndicator()),
                      )
                    : Center(
                        child: Text("分镜 #${panel.panelId}：${panel.sceneDesc}",
                            style: const TextStyle(color: Colors.grey, fontSize: 12)),
                      ),
              ),
              Positioned(
                left: 8,
                top: 8,
                child: Container(
                  width: 24,
                  height: 24,
                  decoration: const BoxDecoration(
                    color: Color(0xFF333333),
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    "${panel.panelId}",
                    style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
              if (panel.narration != null && panel.narration!.isNotEmpty)
                Positioned(
                  left: 40,
                  top: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.9),
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(color: const Color(0xFF444444)),
                    ),
                    child: Text(
                      panel.narration!,
                      style: const TextStyle(fontSize: 11, color: Colors.black87),
                    ),
                  ),
                ),
              if (panel.speechText != null && panel.speechText!.isNotEmpty)
                Positioned(
                  left: 16,
                  bottom: 12,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFF222222), width: 1.8),
                    ),
                    child: Text(
                      panel.speechText!,
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.black87),
                    ),
                  ),
                ),
              if (panel.sfx != null && panel.sfx!.isNotEmpty)
                Positioned(
                  right: 12,
                  top: 12,
                  child: Text(
                    panel.sfx!,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFFE53935),
                      shadows: [Shadow(color: Colors.white, blurRadius: 4)],
                    ),
                  ),
                ),
            ],
          ),
        );
      }).toList(),
    );
  }
}
