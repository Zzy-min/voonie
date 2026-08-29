"use client";

import React, { useState } from "react";
import { Eye, EyeOff, Lock, Mail, PawPrint, Sparkles, User, X, Loader2 } from "lucide-react";
import { loginWithEmail, registerWithEmail, type UserProfile } from "@/lib/api";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (user: UserProfile) => void;
  initialMode?: "login" | "register";
}

export function AuthModal({
  open,
  onClose,
  onSuccess,
  initialMode = "login",
}: AuthModalProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError("请输入邮箱地址");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("请输入有效的邮箱格式（例如 user@example.com）");
      return;
    }
    if (password.length < 6) {
      setError("密码长度至少需要 6 个字符");
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      setError("两次输入的密码不一致，请核对");
      return;
    }

    setLoading(true);
    try {
      let user: UserProfile;
      if (mode === "register") {
        user = await registerWithEmail({
          email: cleanEmail,
          password,
          confirm_password: confirmPassword,
          nickname: nickname.trim() || undefined,
        });
      } else {
        user = await loginWithEmail({
          email: cleanEmail,
          password,
        });
      }
      onSuccess(user);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "操作失败，请检查网络或稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div
        className="auth-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <button
          type="button"
          className="auth-modal-close"
          onClick={onClose}
          aria-label="关闭窗口"
        >
          <X size={18} />
        </button>

        <div className="auth-modal-header">
          <div className="auth-avatar-wrap">
            <span className="auth-mascot" role="img" aria-label="小狗头像" />
          </div>
          <h2 id="auth-modal-title">
            {mode === "login" ? "欢迎回家，小主人" : "创建你的温暖手帐"}
          </h2>
          <p>
            {mode === "login"
              ? "登录你的独立专属账号，随时随地查阅手帐与小狗记忆"
              : "注册后，你的日记、微绘本与 AI 记忆将永久安全隔离保存"}
          </p>
        </div>

        {error && (
          <div className="auth-error-banner" role="alert">
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="auth-email">邮箱账号</label>
            <div className="auth-input-wrapper">
              <Mail size={16} className="auth-field-icon" />
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                placeholder="your-name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoFocus
                required
              />
            </div>
          </div>

          {mode === "register" && (
            <div className="auth-field">
              <label htmlFor="auth-nickname">Voonie 怎么称呼你</label>
              <div className="auth-input-wrapper">
                <User size={16} className="auth-field-icon" />
                <input
                  id="auth-nickname"
                  type="text"
                  autoComplete="name"
                  placeholder="小主人（选填）"
                  value={nickname}
                  maxLength={12}
                  onChange={(e) => setNickname(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="auth-password">密码</label>
            <div className="auth-input-wrapper">
              <Lock size={16} className="auth-field-icon" />
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="至少 6 位密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
              <button
                type="button"
                className="auth-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {mode === "register" && (
            <div className="auth-field">
              <label htmlFor="auth-confirm-password">确认密码</label>
              <div className="auth-input-wrapper">
                <Lock size={16} className="auth-field-icon" />
                <input
                  id="auth-confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="请再次输入相同密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="auth-spinner" />
                <span>正在处理中…</span>
              </>
            ) : mode === "login" ? (
              <>
                <PawPrint size={16} />
                <span>立即登录</span>
              </>
            ) : (
              <>
                <Sparkles size={16} />
                <span>完成注册并进入</span>
              </>
            )}
          </button>
        </form>

        <div className="auth-footer-toggle">
          {mode === "login" ? (
            <p>
              还没有账号？{" "}
              <button
                type="button"
                className="auth-toggle-link"
                onClick={() => {
                  setMode("register");
                  setError(null);
                }}
              >
                立即注册新账号
              </button>
            </p>
          ) : (
            <p>
              已有专属账号？{" "}
              <button
                type="button"
                className="auth-toggle-link"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                返回登录
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
