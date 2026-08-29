import 'package:flutter/material.dart';
import 'package:voonie_app/models/diary_entry.dart';
import 'package:voonie_app/models/pet_state.dart';
import 'package:voonie_app/services/local_db_service.dart';
import 'package:voonie_app/widgets/pet_interactive_widget.dart';
import 'package:voonie_app/widgets/comic_strip_view.dart';
import 'package:voonie_app/views/record_view.dart';
import 'package:voonie_app/views/pet_chat_view.dart';

class HomeView extends StatefulWidget {
  const HomeView({Key? key}) : super(key: key);

  @override
  State<HomeView> createState() => _HomeViewState();
}

class _HomeViewState extends State<HomeView> {
  List<DiaryEntry> _diaries = [];
  bool _isLoading = true;
  PetState _petState = PetState();

  @override
  void initState() {
    super.initState();
    _loadDiaries();
  }

  Future<void> _loadDiaries() async {
    setState(() => _isLoading = true);
    final diaries = await LocalDbService.instance.getAllDiaries();
    setState(() {
      _diaries = diaries;
      _isLoading = false;
      if (diaries.isNotEmpty) {
        _petState = _petState.copyWith(
          currentQuote: "你已经记录了 ${diaries.length} 篇生活漫画啦！继续保持哦~🐾",
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAF8F5),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFAF8F5),
        elevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: const Color(0xFFFF7043),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.auto_stories_rounded, color: Colors.white, size: 20),
            ),
            const SizedBox(width: 8),
            const Text(
              "Voonie",
              style: TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 22,
                color: Color(0xFF2D3748),
                letterSpacing: 0.5,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.shield_outlined, color: Color(0xFF4A5568)),
            tooltip: "隐私与无痕存储保障",
            onPressed: () => _showPrivacyDialog(context),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDiaries,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 100),
          children: [
            PetInteractiveWidget(
              petState: _petState,
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => PetChatView(petState: _petState)),
                );
              },
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    "连环画时间轴",
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF2D3748)),
                  ),
                  Text(
                    "共 ${_diaries.length} 篇",
                    style: const TextStyle(fontSize: 12, color: Color(0xFFA0AEC0)),
                  ),
                ],
              ),
            ),
            if (_isLoading)
              const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator()))
            else if (_diaries.isEmpty)
              _buildEmptyState()
            else
              ..._diaries.map((diary) => Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    child: ComicStripView(diary: diary),
                  )),
          ],
        ),
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: const Color(0xFFFF7043),
        elevation: 4,
        onPressed: () async {
          final result = await Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const RecordView()),
          );
          if (result == true) {
            _loadDiaries();
          }
        },
        icon: const Icon(Icons.mic_rounded, color: Colors.white, size: 26),
        label: const Text(
          "语音记一篇",
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 60, horizontal: 30),
      alignment: Alignment.center,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: const BoxDecoration(
              color: Color(0xFFFFF3E0),
              shape: BoxShape.circle,
            ),
            child: const Text("🎙️", style: TextStyle(fontSize: 48)),
          ),
          const SizedBox(height: 16),
          const Text(
            "还没有任何漫画日记呢",
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF4A5568)),
          ),
          const SizedBox(height: 8),
          const Text(
            "点击下方「语音记一篇」，说出今天的故事，\nVoonie 会为你画成专属连环画哦！",
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: Color(0xFF718096), height: 1.4),
          ),
        ],
      ),
    );
  }

  void _showPrivacyDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.lock_outline_rounded, color: Color(0xFF38A169)),
            SizedBox(width: 8),
            Text("Local-First 隐私机制", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          ],
        ),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("🔒 本地加密存储：所有日记与语音全部加密保存在您的设备沙盒中。"),
            SizedBox(height: 8),
            Text("☁️ 云端无痕生成：云端仅用于临时转录与分镜绘图，生成完成后临时文件在1小时内彻底销毁。"),
            SizedBox(height: 8),
            Text("🐾 记忆检索本地化：宠物助手查阅历史记忆时，完全在手机端本地搜索匹配，不上传历史数据库。"),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text("了解并放心", style: TextStyle(color: Color(0xFFFF7043))),
          ),
        ],
      ),
    );
  }
}
