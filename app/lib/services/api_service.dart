import 'dart:convert';
import 'dart:typed_data';
import 'dart:math';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:voonie_app/models/diary_entry.dart';
import 'package:voonie_app/services/privacy_security_service.dart';

class ApiService {
  // 后端服务地址（本地/局域网或云端）
  static const String baseUrl = "http://localhost:8000/api/v1";
  static String? _absoluteMedia(dynamic value) {
    if (value == null) return null;
    final url = value.toString();
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return Uri.parse(baseUrl).resolve(url).toString();
  }
  static List<dynamic> _panelsWithAbsoluteMedia(dynamic panels) =>
      (panels as List? ?? const []).map((panel) {
        final copy = Map<String, dynamic>.from(panel as Map);
        copy['image_url'] = _absoluteMedia(copy['image_url']);
        return copy;
      }).toList();
  static const _storage = FlutterSecureStorage();
  static const _deviceIdKey = 'voonie_device_id';
  static const _deviceSecretKey = 'voonie_device_secret';
  static const _accessTokenKey = 'voonie_access_token';

  static String _randomId() {
    final random = Random.secure();
    final bytes = List<int>.generate(24, (_) => random.nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }
  static bool _tokenUsable(String token) {
    try {
      final parts = token.split('.');
      if (parts.length != 3) return false;
      final payload = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))));
      final expires = payload['exp'] as int?;
      return expires != null && expires > DateTime.now().millisecondsSinceEpoch ~/ 1000 + 30;
    } catch (_) {
      return false;
    }
  }

  static Future<String> _authenticate({bool force = false}) async {
    if (!force) {
      final cached = await _storage.read(key: _accessTokenKey);
      if (cached != null && _tokenUsable(cached)) return cached;
    }
    var deviceId = await _storage.read(key: _deviceIdKey);
    deviceId ??= 'flutter-${_randomId()}';
    await _storage.write(key: _deviceIdKey, value: deviceId);
    final deviceSecret = await _storage.read(key: _deviceSecretKey);
    final previousToken = await _storage.read(key: _accessTokenKey);
    final response = await http.post(
      Uri.parse('$baseUrl/auth/device'),
      headers: {
        'Content-Type': 'application/json',
        if (previousToken != null) 'Authorization': 'Bearer $previousToken',
      },
      body: jsonEncode({
        'device_id': deviceId,
        'app_version': 'flutter-1.0.0',
        if (deviceSecret != null) 'device_secret': deviceSecret,
      }),
    );
    if (response.statusCode != 201) {
      throw Exception('设备登录失败: ${response.statusCode}');
    }
    final data = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    final token = data['access_token'] as String;
    final issuedSecret = data['device_secret'] as String?;
    await _storage.write(key: _accessTokenKey, value: token);
    if (issuedSecret != null) await _storage.write(key: _deviceSecretKey, value: issuedSecret);
    return token;
  }

  static Future<Map<String, String>> _headers() async => {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ${await _authenticate()}',
  };
  static Future<Map<String, String>> mediaHeaders() async => {
    'Authorization': 'Bearer ${await _authenticate()}',
  };

  /// 纯文本快速生成四格漫画
  static Future<DiaryEntry> generateComicFromText({
    required String text,
    String characterName = "我",
    String appearancePrompt = "a young girl with short brown hair, round glasses, yellow hoodie",
    String stylePreset = "chibi_manga",
  }) async {
    // 1. 端侧 PII 隐私脱敏过滤
    final safeText = PrivacySecurityService.sanitizeTranscript(text);

    final response = await http.post(
      Uri.parse('$baseUrl/diaries/text-generate'),
      headers: await _headers(),
      body: jsonEncode({
        'text': safeText,
        'character': {
          'character_name': characterName,
          'appearance_prompt': appearancePrompt,
          'style_preset': stylePreset,
        }
      }),
    );

    if (response.statusCode == 200) {
      final Map<String, dynamic> data = jsonDecode(utf8.decode(response.bodyBytes));
      return DiaryEntry.fromMap({
        'id': data['task_id'],
        'title': data['title'],
        'raw_transcript': data['raw_transcript'],
        'primary_emotion': data['emotion']['primary_emotion'],
        'emotion_label_zh': data['emotion']['emotion_label_zh'],
        'mood_score': data['emotion']['mood_score'],
        'emotion_analysis': data['emotion']['analysis'],
        'companion_note': data['companion_note'],
        'composite_comic_url': _absoluteMedia(data['composite_comic_url']),
        'panels': _panelsWithAbsoluteMedia(data['panels']),
        'created_at': data['created_at'],
      });
    } else {
      throw Exception('生成漫画失败: ${response.statusCode} - ${response.body}');
    }
  }

  /// 语音上传并生成四格漫画
  static Future<DiaryEntry> generateComicFromVoice({
    required Uint8List audioBytes,
    String filename = "diary_voice.m4a",
    String characterName = "我",
    String appearancePrompt = "a young girl with short brown hair, round glasses, yellow hoodie",
    String stylePreset = "chibi_manga",
  }) async {
    final uri = Uri.parse('$baseUrl/diaries/voice-generate');
    final request = http.MultipartRequest('POST', uri);
    request.headers['Authorization'] = 'Bearer ${await _authenticate()}';
    
    request.files.add(
      http.MultipartFile.fromBytes('audio_file', audioBytes, filename: filename)
    );
    request.fields['character_name'] = characterName;
    request.fields['appearance_prompt'] = appearancePrompt;
    request.fields['style_preset'] = stylePreset;

    final streamedResponse = await request.send();
    final response = await http.Response.fromStream(streamedResponse);

    if (response.statusCode == 200) {
      final Map<String, dynamic> data = jsonDecode(utf8.decode(response.bodyBytes));
      return DiaryEntry.fromMap({
        'id': data['task_id'],
        'title': data['title'],
        'raw_transcript': data['raw_transcript'],
        'primary_emotion': data['emotion']['primary_emotion'],
        'emotion_label_zh': data['emotion']['emotion_label_zh'],
        'mood_score': data['emotion']['mood_score'],
        'emotion_analysis': data['emotion']['analysis'],
        'companion_note': data['companion_note'],
        'composite_comic_url': _absoluteMedia(data['composite_comic_url']),
        'panels': _panelsWithAbsoluteMedia(data['panels']),
        'created_at': data['created_at'],
      });
    } else {
      throw Exception('语音生成漫画失败: ${response.statusCode} - ${response.body}');
    }
  }

  /// 与宠物伴侣聊天（附带端侧召回的本地记忆片段）
  static Future<Map<String, dynamic>> chatWithPet({
    required String message,
    String petName = "Voonie",
    String petType = "cat",
    List<Map<String, String>>? localMemoryContext,
    String recentMoodTrend = "平静",
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/pet/chat'),
      headers: await _headers(),
      body: jsonEncode({
        'message': message,
        'pet_name': petName,
        'pet_type': petType,
        'local_memory_context': localMemoryContext,
        'recent_mood_trend': recentMoodTrend,
      }),
    );

    if (response.statusCode == 200) {
      return jsonDecode(utf8.decode(response.bodyBytes));
    } else {
      throw Exception('宠物交互失败: ${response.statusCode}');
    }
  }
}
