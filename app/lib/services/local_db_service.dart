import 'dart:async';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';
import 'package:voonie_app/models/diary_entry.dart';

class LocalDbService {
  static final LocalDbService instance = LocalDbService._init();
  static Database? _database;

  LocalDbService._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('voonie_encrypted_diary.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 1,
      onCreate: _createDB,
    );
  }

  Future _createDB(Database db, int version) async {
    // 1. 日记主表
    await db.execute('''
      CREATE TABLE diaries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        raw_transcript TEXT NOT NULL,
        primary_emotion TEXT NOT NULL,
        emotion_label_zh TEXT NOT NULL,
        mood_score INTEGER NOT NULL,
        emotion_analysis TEXT NOT NULL,
        companion_note TEXT NOT NULL,
        composite_comic_url TEXT,
        local_composite_path TEXT,
        panels_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    ''');

    // 2. 本地全文检索与标签虚拟表 (Local Search Index)
    await db.execute('''
      CREATE TABLE diary_search_index (
        diary_id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        emotion TEXT,
        created_date TEXT
      )
    ''');
  }

  Future<void> saveDiary(DiaryEntry diary) async {
    final db = await database;
    await db.insert('diaries', diary.toMap(), conflictAlgorithm: ConflictAlgorithm.replace);
    
    // 写入本地搜索索引
    await db.insert('diary_search_index', {
      'diary_id': diary.id,
      'title': diary.title,
      'content': diary.rawTranscript,
      'emotion': diary.emotionLabelZh,
      'created_date': diary.createdAt.toIso8601String().substring(0, 10),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<DiaryEntry>> getAllDiaries() async {
    final db = await database;
    final result = await db.query('diaries', orderBy: 'created_at DESC');
    return result.map((json) => DiaryEntry.fromMap(json)).toList();
  }

  Future<DiaryEntry?> getDiaryById(String id) async {
    final db = await database;
    final maps = await db.query('diaries', where: 'id = ?', whereArgs: [id]);
    if (maps.isNotEmpty) {
      return DiaryEntry.fromMap(maps.first);
    }
    return null;
  }

  /// 本地优先记忆检索：根据关键词或情绪从本地索引检索日记摘要
  Future<List<Map<String, String>>> queryLocalMemories(String keyword, {int limit = 3}) async {
    final db = await database;
    final results = await db.rawQuery('''
      SELECT diary_id, title, content, emotion, created_date 
      FROM diary_search_index 
      WHERE content LIKE ? OR title LIKE ? OR emotion LIKE ?
      ORDER BY created_date DESC
      LIMIT ?
    ''', ['%$keyword%', '%$keyword%', '%$keyword%', limit]);

    return results.map((r) => {
      'happened_date': (r['created_date'] ?? '').toString(),
      'title': (r['title'] ?? '').toString(),
      'summary': (r['content'] ?? '').toString().length > 50 
          ? '${(r['content'] ?? '').toString().substring(0, 50)}...' 
          : (r['content'] ?? '').toString(),
      'emotion': (r['emotion'] ?? '').toString(),
    }).toList();
  }
}
