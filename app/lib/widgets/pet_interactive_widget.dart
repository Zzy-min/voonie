import 'package:flutter/material.dart';
import 'package:voonie_app/models/pet_state.dart';

class PetInteractiveWidget extends StatefulWidget {
  final PetState petState;
  final VoidCallback onTap;

  const PetInteractiveWidget({
    Key? key,
    required this.petState,
    required this.onTap,
  }) : super(key: key);

  @override
  State<PetInteractiveWidget> createState() => _PetInteractiveWidgetState();
}

class _PetInteractiveWidgetState extends State<PetInteractiveWidget> with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _bounceAnimation;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    
    _bounceAnimation = Tween<double>(begin: -4.0, end: 4.0).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: widget.onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF7ED),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFFFEDD5), width: 2),
          boxShadow: [
            BoxShadow(
              color: Colors.orange.withOpacity(0.08),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          children: [
            AnimatedBuilder(
              animation: _bounceAnimation,
              builder: (context, child) {
                return Transform.translate(
                  offset: Offset(0, _bounceAnimation.value),
                  child: Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFD8A8),
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    alignment: Alignment.center,
                    child: const Text("🐱", style: TextStyle(fontSize: 34)),
                  ),
                );
              },
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        widget.petState.name,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFFC05621),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFBD38D),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Text("伴侣AI", style: TextStyle(fontSize: 10, color: Color(0xFF7B341E))),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    widget.petState.currentQuote,
                    style: const TextStyle(fontSize: 13, color: Color(0xFF7B341E), height: 1.3),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: Color(0xFFDD6B20)),
          ],
        ),
      ),
    );
  }
}
