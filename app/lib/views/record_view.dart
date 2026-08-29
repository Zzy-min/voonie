import 'package:flutter/material.dart';
import 'package:voonie_app/services/api_service.dart';
import 'package:voonie_app/services/local_db_service.dart';

class RecordView extends StatefulWidget {
  const RecordView({Key? key}) : super(key: key);

  @override
  State<RecordView> createState() => _RecordViewState();
}

class _RecordViewState extends State<RecordView> {
  bool _isGenerating = false;
  String _statusMessage = "长按或点击开始语音倾诉";
  final TextEditingController _textController = TextEditingController();
  String _selectedStyle = "chibi_manga";

  Future<void> _submitTextDiary() async {
    final text = _textController.text.trim();
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("请输入今天发生的故事呀~")),
      );
      return;
    }

    setState(() {
      _isGenerating = true;
      _statusMessage = "Voonie 正在阅读日记并构思四格分镜...";
    });

    try {
      final diary = await ApiService.generateComicFromText(
        text: text,
        characterName: "小主人",
        stylePreset: _selectedStyle,
      );

      await LocalDbService.instance.saveDiary(diary);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("✨ 连环漫画日记生成成功！")),
        );
        Navigator.pop(context, true);
      }
    } catch (e) {
      setState(() {
        _isGenerating = false;
        _statusMessage = "生成出现了一点小问题，请稍后再试: $e";
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFCFAF5),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFCFAF5),
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.close, color: Colors.black87),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text("记录今日生活", style: TextStyle(color: Colors.black87, fontWeight: FontWeight.bold)),
      ),
      body: _isGenerating ? _buildLoadingView() : _buildInputView(),
    );
  }

  Widget _buildLoadingView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 90,
              height: 90,
              decoration: const BoxDecoration(
                color: Color(0xFFFFF3E0),
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: const Text("🎨", style: TextStyle(fontSize: 48)),
            ),
            const SizedBox(height: 24),
            const CircularProgressIndicator(color: Color(0xFFFF7043)),
            const SizedBox(height: 20),
            Text(
              _statusMessage,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF4A5568)),
            ),
            const SizedBox(height: 10),
            const Text(
              "正在为你绘制角色、对白气泡与温暖光影",
              style: TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInputView() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text("漫画画风选择：", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
          const SizedBox(height: 8),
          Row(
            children: [
              _buildStyleChip("Q版日漫", "chibi_manga"),
              const SizedBox(width: 8),
              _buildStyleChip("温暖水彩", "warm_watercolor"),
              const SizedBox(width: 8),
              _buildStyleChip("复古美漫", "retro_comic"),
            ],
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _textController,
            maxLines: 6,
            decoration: InputDecoration(
              hintText: "今天遇到了什么开心或烦恼的事？尽情倾诉吧...\n例如：今天去公园散步，突然下大雨，幸好遇到一只小狗一起躲雨...",
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
              ),
            ),
          ),
          const SizedBox(height: 20),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            icon: const Icon(Icons.mic, color: Color(0xFFFF7043)),
            label: const Text("点击模拟录音 / 填入今日语音范例", style: TextStyle(color: Color(0xFFFF7043))),
            onPressed: () {
              _textController.text = "今天下午突然下了一场好大的暴雨，我在路边的咖啡馆避雨，居然遇到了一只超级可爱的小橘猫，它乖乖靠在我的鞋子旁边避雨，瞬间觉得一整天的烦恼都没了！";
            },
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFF7043),
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            onPressed: _submitTextDiary,
            child: const Text(
              "✨ 绘制今日四格连环画",
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStyleChip(String label, String value) {
    final isSelected = _selectedStyle == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      selectedColor: const Color(0xFFFFCCBC),
      onSelected: (selected) {
        if (selected) setState(() => _selectedStyle = value);
      },
    );
  }
}
