enum PetMood { happy, comfort, thinking, sleepy, normal }

class PetState {
  final String name;
  final String petType; // cat / dog / dino
  final PetMood currentMood;
  final String currentQuote;
  final int intimacy;

  PetState({
    this.name = "Voonie",
    this.petType = "cat",
    this.currentMood = PetMood.normal,
    this.currentQuote = "嗨！今天有什么想跟我聊聊的吗？🐾",
    this.intimacy = 10,
  });

  PetState copyWith({
    String? name,
    String? petType,
    PetMood? currentMood,
    String? currentQuote,
    int? intimacy,
  }) {
    return PetState(
      name: name ?? this.name,
      petType: petType ?? this.petType,
      currentMood: currentMood ?? this.currentMood,
      currentQuote: currentQuote ?? this.currentQuote,
      intimacy: intimacy ?? this.intimacy,
    );
  }
}
