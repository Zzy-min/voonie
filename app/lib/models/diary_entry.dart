import 'dart:convert';

class ComicPanelModel {
  final int panelId;
  final String shotType;
  final String sceneDesc;
  final String characterAction;
  final String? narration;
  final String? speechText;
  final String? sfx;
  final String? imageUrl;
  final String? localImagePath; // 本地加密沙盒路径

  ComicPanelModel({
    required this.panelId,
    required this.shotType,
    required this.sceneDesc,
    required this.characterAction,
    this.narration,
    this.speechText,
    this.sfx,
    this.imageUrl,
    this.localImagePath,
  });

  Map<String, dynamic> toMap() {
    return {
      'panel_id': panelId,
      'shot_type': shotType,
      'scene_desc': sceneDesc,
      'character_action': characterAction,
      'narration': narration,
      'speech_text': speechText,
      'sfx': sfx,
      'image_url': imageUrl,
      'local_image_path': localImagePath,
    };
  }

  factory ComicPanelModel.fromMap(Map<String, dynamic> map) {
    return ComicPanelModel(
      panelId: map['panel_id'] ?? 1,
      shotType: map['shot_type'] ?? 'medium_shot',
      sceneDesc: map['scene_desc'] ?? '',
      characterAction: map['character_action'] ?? '',
      narration: map['narration'],
      speechText: map['speech_text'] ?? (map['speech_bubble'] != null ? map['speech_bubble']['text'] : null),
      sfx: map['sfx'],
      imageUrl: map['image_url'],
      localImagePath: map['local_image_path'],
    );
  }
}

class DiaryEntry {
  final String id;
  final String title;
  final String rawTranscript;
  final String primaryEmotion;
  final String emotionLabelZh;
  final int moodScore; // 1 - 10
  final String emotionAnalysis;
  final String companionNote;
  final String? compositeComicUrl;
  final String? localCompositePath;
  final List<ComicPanelModel> panels;
  final DateTime createdAt;

  DiaryEntry({
    required this.id,
    required this.title,
    required this.rawTranscript,
    required this.primaryEmotion,
    required this.emotionLabelZh,
    required this.moodScore,
    required this.emotionAnalysis,
    required this.companionNote,
    this.compositeComicUrl,
    this.localCompositePath,
    required this.panels,
    required this.createdAt,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'title': title,
      'raw_transcript': rawTranscript,
      'primary_emotion': primaryEmotion,
      'emotion_label_zh': emotionLabelZh,
      'mood_score': moodScore,
      'emotion_analysis': emotionAnalysis,
      'companion_note': companionNote,
      'composite_comic_url': compositeComicUrl,
      'local_composite_path': localCompositePath,
      'panels_json': jsonEncode(panels.map((p) => p.toMap()).toList()),
      'created_at': createdAt.toIso8601String(),
    };
  }

  factory DiaryEntry.fromMap(Map<String, dynamic> map) {
    List<ComicPanelModel> panelList = [];
    if (map['panels_json'] != null) {
      final decoded = jsonDecode(map['panels_json']) as List;
      panelList = decoded.map((e) => ComicPanelModel.fromMap(e)).toList();
    } else if (map['panels'] != null) {
      final list = map['panels'] as List;
      panelList = list.map((e) => ComicPanelModel.fromMap(e)).toList();
    }

    return DiaryEntry(
      id: map['id'] ?? '',
      title: map['title'] ?? '无题日记',
      rawTranscript: map['raw_transcript'] ?? '',
      primaryEmotion: map['primary_emotion'] ?? (map['emotion'] != null ? map['emotion']['primary_emotion'] : 'relaxed'),
      emotionLabelZh: map['emotion_label_zh'] ?? (map['emotion'] != null ? map['emotion']['emotion_label_zh'] : '平静'),
      moodScore: map['mood_score'] ?? (map['emotion'] != null ? map['emotion']['mood_score'] : 7),
      emotionAnalysis: map['emotion_analysis'] ?? (map['emotion'] != null ? map['emotion']['analysis'] : ''),
      companionNote: map['companion_note'] ?? '又是精彩的一天！🐾',
      compositeComicUrl: map['composite_comic_url'],
      localCompositePath: map['local_composite_path'],
      panels: panelList,
      createdAt: map['created_at'] != null ? DateTime.parse(map['created_at']) : DateTime.now(),
    );
  }
}
