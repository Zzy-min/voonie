import 'package:flutter_test/flutter_test.dart';
import 'package:voonie_app/models/diary_entry.dart';
import 'package:voonie_app/models/pet_state.dart';
import 'package:voonie_app/services/privacy_security_service.dart';

void main() {
  group('Voonie Privacy Security Service Tests', () {
    test('should mask phone numbers in transcript', () {
      const raw = "今天小李给我打电话 13812345678 说周末一起去露营。";
      final sanitized = PrivacySecurityService.sanitizeTranscript(raw);
      expect(sanitized, contains('[某手机号]'));
      expect(sanitized.contains('13812345678'), isFalse);
    });

    test('should mask email and id card numbers', () {
      const raw = "我的邮箱是 test@example.com，请把发票发过来。";
      final sanitized = PrivacySecurityService.sanitizeTranscript(raw);
      expect(sanitized, contains('[某邮箱]'));
      expect(sanitized.contains('test@example.com'), isFalse);
    });
  });

  group('Voonie Data Models Tests', () {
    test('DiaryEntry serialization and deserialization', () {
      final entry = DiaryEntry(
        id: 'test_123',
        title: '测试漫画日记',
        rawTranscript: '今天心情很不错！',
        primaryEmotion: 'joy',
        emotionLabelZh: '开心',
        moodScore: 9,
        emotionAnalysis: '阳光明媚',
        companionNote: '保持好心情！',
        compositeComicUrl: 'http://localhost:8000/media/sample.png',
        panels: [
          ComicPanelModel(
            panelId: 1,
            shotType: 'medium_shot',
            sceneDesc: 'Park scene',
            characterAction: 'Walking happily',
            narration: '阳光正好',
            speechText: '今天真好！',
          ),
        ],
        createdAt: DateTime.now(),
      );

      final map = entry.toMap();
      final reconstructed = DiaryEntry.fromMap(map);
      expect(reconstructed.id, equals('test_123'));
      expect(reconstructed.title, equals('测试漫画日记'));
      expect(reconstructed.panels.length, equals(1));
      expect(reconstructed.panels.first.speechText, equals('今天真好！'));
    });

    test('PetState copyWith test', () {
      final pet = PetState(name: 'Voonie', intimacy: 10);
      final updated = pet.copyWith(intimacy: 20, currentMood: PetMood.happy);
      expect(updated.name, equals('Voonie'));
      expect(updated.intimacy, equals(20));
      expect(updated.currentMood, equals(PetMood.happy));
    });
  });
}
