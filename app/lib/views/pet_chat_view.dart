import 'package:flutter/material.dart';
import 'package:voonie_app/models/pet_state.dart';
import 'package:voonie_app/services/api_service.dart';
import 'package:voonie_app/services/local_db_service.dart';

class PetChatView extends StatefulWidget {
  final PetState petState;

  const PetChatView({Key? key, required this.petState}) : super(key: key);

  @override
  State<PetChatView> createState() => _PetChatViewState();
}

class _ChatMessage {
  final String text;
  final bool isUser;
  final List<String>? references;

  _ChatMessage({required this.text, required this.isUser, this.references});
}

class _PetChatViewState extends State<PetChatView> {
  final List<_ChatMessage> _messages = [];
  final TextEditingController _inputController = TextEditingController();
  bool _isSending = false;

  @override
  void initState() {
    super.initState();
    _messages.add(_ChatMessage(
      text: "喵~ 我是你的日记小伴侣 ${widget.petState.name}！想聊聊今天的心事，或者想找回哪一天的记忆都可以告诉我哦！🐾",
      isUser: false,
    ));
  }

  Future<void> _sendMessage() async {
    final text = _inputController.text.trim();
    if (text.isEmpty || _isSending) return;

    _inputController.clear();
    setState(() {
      _messages.add(_ChatMessage(text: text, isUser: true));
      _isSending = true;
    });

    try {
      final localMemories = await LocalDbService.instance.queryLocalMemories(text);

      final response = await ApiService.chatWithPet(
        message: text,
        petName: widget.petState.name,
        petType: widget.petState.petType,
        localMemoryContext: localMemories,
      );

      final reply = response['reply'] as String? ?? "抱抱你，本喵一直都在呢！";
      final refs = (response['referenced_memories'] as List?)?.map((e) => e.toString()).toList();

      setState(() {
        _messages.add(_ChatMessage(
          text: reply,
          isUser: false,
          references: refs,
        ));
      });
    } catch (e) {
      setState(() {
        _messages.add(_ChatMessage(
          text: "喵呜~ 刚刚走神了，你刚才说的是什么呀？（网络遇到小波动）",
          isUser: false,
        ));
      });
    } finally {
      setState(() => _isSending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9F6F0),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF9F6F0),
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.black87),
          onPressed: () => Navigator.pop(context),
        ),
        title: Row(
          children: [
            const Text("🐱", style: TextStyle(fontSize: 22)),
            const SizedBox(width: 8),
            Text(
              "${widget.petState.name} 陪伴助手",
              style: const TextStyle(color: Colors.black87, fontWeight: FontWeight.bold, fontSize: 16),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                return _buildMessageBubble(msg);
              },
            ),
          ),
          if (_isSending)
            const Padding(
              padding: EdgeInsets.all(8.0),
              child: Text("🐱 Voonie 正在思考并翻看回忆小抽屉...", style: TextStyle(fontSize: 12, color: Colors.grey)),
            ),
          _buildInputBar(),
        ],
      ),
    );
  }

  Widget _buildMessageBubble(_ChatMessage msg) {
    return Align(
      alignment: msg.isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        decoration: BoxDecoration(
          color: msg.isUser ? const Color(0xFFFF7043) : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: msg.isUser ? const Color(0xFFFF7043) : const Color(0xFFE2E8F0),
          ),
          boxShadow: const [BoxShadow(color: Color(0x08000000), blurRadius: 4, offset: Offset(0, 2))],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              msg.text,
              style: TextStyle(
                fontSize: 14,
                color: msg.isUser ? Colors.white : const Color(0xFF2D3748),
                height: 1.4,
              ),
            ),
            if (msg.references != null && msg.references!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF8E1),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.bookmark_outline, size: 14, color: Color(0xFFF57F17)),
                    const SizedBox(width: 4),
                    Text(
                      "回忆溯源: ${msg.references!.join(', ')}",
                      style: const TextStyle(fontSize: 11, color: Color(0xFFF57F17)),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildInputBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      color: Colors.white,
      child: SafeArea(
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _inputController,
                onSubmitted: (_) => _sendMessage(),
                decoration: InputDecoration(
                  hintText: "和 Voonie 说说话或询问历史日记...",
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  filled: true,
                  fillColor: const Color(0xFFF7FAFC),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              icon: const Icon(Icons.send_rounded, color: Color(0xFFFF7043)),
              onPressed: _sendMessage,
            ),
          ],
        ),
      ),
    );
  }
}
