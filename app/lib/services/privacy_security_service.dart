class PrivacySecurityService {
  /// 端侧轻量级 PII（个人敏感信息）脱敏过滤器
  /// 确保发送到云端大模型做分镜拆解前，不会暴露真实手机号、身份证号、邮箱等
  static String sanitizeTranscript(String rawText) {
    String text = rawText;
    
    // 1. 过滤大陆手机号 (11位)
    final phoneRegex = RegExp(r'(?<!\d)1[3-9]\d{9}(?!\d)');
    text = text.replaceAll(phoneRegex, '[某手机号]');
    
    // 2. 过滤身份证号 (18位)
    final idCardRegex = RegExp(r'(?<!\d)\d{17}[\dXx](?!\d)');
    text = text.replaceAll(idCardRegex, '[某身份证件]');
    
    // 3. 过滤电子邮箱
    final emailRegex = RegExp(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+');
    text = text.replaceAll(emailRegex, '[某邮箱]');
    
    return text;
  }
}
