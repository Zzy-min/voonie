"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle,
  Moon,
  Sun,
  Compass,
  Sparkles,
  Heart,
  X,
} from "lucide-react";

export type DogPose =
  | "portrait"
  | "sit"
  | "stand"
  | "rest"
  | "play"
  | "wave"
  | "run"
  | "happy"
  | "look"
  | "sleep";

export type PetState =
  | "idle"
  | "listening"
  | "thinking"
  | "talking"
  | "happy"
  | "curious"
  | "sleepy"
  | "walking"
  | "resting";

interface DesktopPetProps {
  nickname?: string;
  onOpenChat: () => void;
  chatOpen?: boolean;
  appState?: "idle" | "listening" | "thinking" | "talking" | "happy";
}

export function DesktopPet({
  nickname = "小主人",
  onOpenChat,
  chatOpen = false,
  appState = "idle",
}: DesktopPetProps) {
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [initialized, setInitialized] = useState(false);
  const [facingLeft, setFacingLeft] = useState(false);
  const [petState, setPetState] = useState<PetState>("idle");
  const [pose, setPose] = useState<DogPose>("sit");
  const [statusText, setStatusText] = useState<string>("和我说话吧🐾");
  const [isWandering, setIsWandering] = useState(false);
  const [autoWalkEnabled, setAutoWalkEnabled] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([]);
  const [toyAnim, setToyAnim] = useState<{ type: "bone" | "ball"; x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const petRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ startX: number; startY: number; petX: number; petY: number } | null>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInteractingRef = useRef(false);

  // Position initialization
  /* eslint-disable react-hooks/set-state-in-effect -- browser geometry and external app state are synchronized after hydration */
  useEffect(() => {
    if (typeof window !== "undefined") {
      const initialX = Math.max(300, window.innerWidth - 190);
      const initialY = Math.max(200, window.innerHeight - 170);
      setPos({ x: initialX, y: initialY });
      setInitialized(true);
    }
  }, []);

  // Sync external app states (listening to voice, thinking AI, talking, happy)
  useEffect(() => {
    if (appState === "listening") {
      setPetState("listening");
      setPose("look");
      setStatusText("Voonie 正在认真听你说… 🎧");
    } else if (appState === "thinking") {
      setPetState("thinking");
      setPose("look");
      setStatusText("Voonie 正在思考中… ✨");
    } else if (appState === "talking") {
      setPetState("talking");
      setPose("wave");
      setStatusText("汪！想和你说… 💬");
    } else if (appState === "happy") {
      setPetState("happy");
      setPose("happy");
      setStatusText("太棒啦！记录保存成功！🎉");
      // Trigger heart burst
      const newHearts = Array.from({ length: 4 }).map((_, i) => ({
        id: Date.now() + i,
        x: (Math.random() - 0.5) * 40,
        y: -10 - i * 15,
      }));
      setHearts((prev) => [...prev, ...newHearts]);
    } else if (!isDragging && petState !== "sleepy") {
      if (isHovered) {
        setPetState("curious");
        setPose("look");
      } else {
        setPetState("idle");
        setPose("sit");
      }
    }
  }, [appState, isDragging, isHovered, petState]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const showSpeech = useCallback((text: string, durationMs = 4000) => {
    setStatusText(text);
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => {
      setStatusText(petState === "sleepy" ? "Zzz..." : "和我说话吧🐾");
    }, durationMs);
  }, [petState]);

  const resetIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (petState === "sleepy") {
      setPetState("idle");
      setPose("sit");
      showSpeech("呜~ 我醒啦！汪汪！", 2500);
    }
    idleTimerRef.current = setTimeout(() => {
      if (!isDragging && !chatOpen && appState === "idle") {
        setPetState("sleepy");
        setPose("sleep");
        setStatusText("Zzz...");
      }
    }, 45000);
  }, [petState, isDragging, chatOpen, appState, showSpeech]);

  // Handle gentle random wandering
  const wanderToRandomPoint = useCallback(() => {
    if (isDragging || petState === "sleepy" || !autoWalkEnabled || chatOpen || appState !== "idle") return;

    const safeMinX = 260;
    const safeMaxX = Math.max(safeMinX + 100, (typeof window !== "undefined" ? window.innerWidth : 1000) - 190);
    const safeMinY = 120;
    const safeMaxY = Math.max(safeMinY + 100, (typeof window !== "undefined" ? window.innerHeight : 800) - 170);

    const targetX = Math.floor(Math.random() * (safeMaxX - safeMinX)) + safeMinX;
    const targetY = Math.floor(Math.random() * (safeMaxY - safeMinY * 1.5)) + safeMinY * 1.2;

    const dx = targetX - pos.x;
    setFacingLeft(dx < 0);
    setPetState("walking");
    setPose("run");
    setIsWandering(true);

    const speeches = [
      "散个步，伸伸小懒腰！🐾",
      "今天的小太阳好舒服~ ✨",
      "去那边巡视一圈！🌸",
      "摇摇尾巴～ 陪在小主人身边！",
    ];
    showSpeech(speeches[Math.floor(Math.random() * speeches.length)], 3500);

    setPos({ x: targetX, y: targetY });

    setTimeout(() => {
      setIsWandering(false);
      setPetState((curr) => {
        if (curr === "sleepy") return "sleepy";
        const nextPoses: DogPose[] = ["sit", "rest", "play", "wave"];
        setPose(nextPoses[Math.floor(Math.random() * nextPoses.length)]);
        return "idle";
      });
    }, 2800);
  }, [pos, isDragging, petState, autoWalkEnabled, chatOpen, appState, showSpeech]);

  // Wandering timer
  useEffect(() => {
    if (!autoWalkEnabled || petState === "sleepy" || chatOpen || appState !== "idle") return;
    const interval = setInterval(() => {
      if (Math.random() > 0.45 && !isDragging) {
        wanderToRandomPoint();
      }
    }, 24000);
    return () => clearInterval(interval);
  }, [autoWalkEnabled, petState, chatOpen, appState, isDragging, wanderToRandomPoint]);

  // User activity resets idle timer
  useEffect(() => {
    const handleActivity = () => resetIdle();
    window.addEventListener("mousemove", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, [resetIdle]);

  // Dragging logic with strict button/dock event isolation
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest(".pet-quick-dock, .pet-interaction-menu, button")) {
      return;
    }
    e.stopPropagation();
    resetIdle();
    isInteractingRef.current = false;
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      petX: pos.x,
      petY: pos.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.startX;
      const dy = e.clientY - dragStartRef.current.startY;

      if (!isDragging && Math.hypot(dx, dy) > 5) {
        setIsDragging(true);
        isInteractingRef.current = true;
        setPose("look");
        showSpeech("抓到我啦~ 准备去哪儿？🐾", 2000);
      }

      if (isDragging) {
        const maxX = Math.max(100, window.innerWidth - 180);
        const maxY = Math.max(100, window.innerHeight - 160);
        const newX = Math.min(Math.max(20, dragStartRef.current.petX + dx), maxX);
        const newY = Math.min(Math.max(60, dragStartRef.current.petY + dy), maxY);
        setPos({ x: newX, y: newY });
        setFacingLeft(dx < 0);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (dragStartRef.current) {
        const dx = e.clientX - dragStartRef.current.startX;
        const dy = e.clientY - dragStartRef.current.startY;
        const target = e.target as HTMLElement | null;
        const isClickOnControls = target?.closest(".pet-quick-dock, .pet-interaction-menu, button");

        if (Math.hypot(dx, dy) <= 5 && !isClickOnControls && !isInteractingRef.current) {
          onOpenChat();
        }
        dragStartRef.current = null;
      }
      if (isDragging) {
        setIsDragging(false);
        setPose("sit");
        setPetState("idle");
        showSpeech("好啦！就待在这个舒服的位置～", 2500);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, onOpenChat, showSpeech]);

  // Touch Support
  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest(".pet-quick-dock, .pet-interaction-menu, button")) {
      return;
    }
    const touch = e.touches[0];
    if (!touch) return;
    resetIdle();
    isInteractingRef.current = false;
    dragStartRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      petX: pos.x,
      petY: pos.y,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragStartRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - dragStartRef.current.startX;
    const dy = touch.clientY - dragStartRef.current.startY;

    if (!isDragging && Math.hypot(dx, dy) > 6) {
      setIsDragging(true);
      isInteractingRef.current = true;
      setPose("look");
    }

    if (isDragging) {
      const maxX = Math.max(100, window.innerWidth - 180);
      const maxY = Math.max(100, window.innerHeight - 160);
      const newX = Math.min(Math.max(20, dragStartRef.current.petX + dx), maxX);
      const newY = Math.min(Math.max(60, dragStartRef.current.petY + dy), maxY);
      setPos({ x: newX, y: newY });
      setFacingLeft(dx < 0);
    }
  };

  const handleTouchEnd = () => {
    if (dragStartRef.current && !isDragging && !isInteractingRef.current) {
      onOpenChat();
    }
    dragStartRef.current = null;
    if (isDragging) {
      setIsDragging(false);
      setPose("sit");
      setPetState("idle");
    }
  };

  // Dedicated Actions
  const petHead = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    resetIdle();
    setPetState("happy");
    setPose("happy");
    const phrases = [
      `呜~ 摸摸头最舒服啦，${nickname}！❤️`,
      "蹭蹭你的手心~ 尾巴摇成螺旋桨！🐾",
      "今天也超级喜欢和主人待在一起！✨",
    ];
    showSpeech(phrases[Math.floor(Math.random() * phrases.length)], 3200);

    const newHearts = Array.from({ length: 5 }).map((_, i) => ({
      id: Date.now() + i,
      x: (Math.random() - 0.5) * 50,
      y: -10 - i * 16,
    }));
    setHearts((prev) => [...prev, ...newHearts]);

    setTimeout(() => {
      setHearts((prev) => prev.filter((h) => !newHearts.some((nh) => nh.id === h.id)));
      setPose("sit");
      setPetState("idle");
    }, 2400);
  };

  const feedBone = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    resetIdle();
    setToyAnim({ type: "bone", x: 0, y: 0 });
    setPose("play");
    setPetState("happy");
    showSpeech("嗷呜！大肉骨头太香啦！🍖✨", 3200);

    setTimeout(() => {
      setToyAnim(null);
    }, 1500);

    setTimeout(() => {
      setPose("sit");
      setPetState("idle");
    }, 2500);
    setMenuOpen(false);
  };

  const playBall = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    resetIdle();
    setToyAnim({ type: "ball", x: 20, y: 0 });
    setPose("run");
    setPetState("happy");
    showSpeech("汪汪！接住小皮球啦！再扔一次嘛~ ⚽", 3200);

    setTimeout(() => {
      setToyAnim(null);
    }, 1500);

    setTimeout(() => {
      setPose("sit");
      setPetState("idle");
    }, 2500);
    setMenuOpen(false);
  };

  const toggleSleep = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (petState === "sleepy") {
      setPetState("idle");
      setPose("sit");
      showSpeech("呜~ 我睡饱啦！开始陪伴小主人！☀️", 3000);
    } else {
      setPetState("sleepy");
      setPose("sleep");
      setStatusText("Zzz...");
    }
    setMenuOpen(false);
  };

  if (!initialized) return null;

  // Standalone crisp sprite mapping: zero edge bleeding!
  const dogImgUrl = `/pet/${pose}.png`;

  return (
    <div
      ref={petRef}
      className={`desktop-pet-container ${isDragging ? "dragging" : ""} ${
        isWandering ? "wandering" : ""
      } ${facingLeft ? "facing-left" : ""} pet-state-${petState}`}
      style={{
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseEnter={() => {
        setIsHovered(true);
        if (petState === "idle") setPetState("curious");
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        if (petState === "curious") setPetState("idle");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen((prev) => !prev);
      }}
    >
      {/* Speech bubble */}
      <div className={`pet-speech-bubble ${petState === "sleepy" ? "sleepy" : ""}`}>
        <span>{statusText}</span>
        <div className="pet-speech-arrow" />
      </div>

      {/* Floating Hearts */}
      {hearts.map((h) => (
        <span
          key={h.id}
          className="floating-heart"
          style={{ transform: `translate(${h.x}px, ${h.y}px)` }}
        >
          ❤️
        </span>
      ))}

      {/* Toy item */}
      {toyAnim && (
        <div
          className="floating-toy"
          style={{ transform: `translate(${toyAnim.x}px, ${toyAnim.y}px)` }}
        >
          {toyAnim.type === "bone" ? "🍖" : "⚽"}
        </div>
      )}

      {/* Dog Mascot Sprite: Clean standalone PNG with zero frame overlap */}
      <div
        className={`desktop-pet-dog breathing-anim`}
        style={{
          backgroundImage: `url(${dogImgUrl})`,
          backgroundSize: "contain",
          backgroundPosition: "center center",
          backgroundRepeat: "no-repeat",
        }}
        role="img"
        aria-label={`小狗桌宠：${pose}`}
      />

      {/* Quick Action Dock */}
      <div
        className="pet-quick-dock"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="pet-dock-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpenChat();
          }}
          title="和 Voonie 聊天"
          aria-label="打开聊天"
        >
          <MessageCircle size={14} />
        </button>
        <button
          type="button"
          className="pet-dock-btn"
          onClick={(e) => {
            e.stopPropagation();
            petHead(e);
          }}
          title="摸摸头"
          aria-label="摸摸头"
        >
          <Heart size={14} />
        </button>
        <button
          type="button"
          className="pet-dock-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((prev) => !prev);
          }}
          title="更多互动"
          aria-label="更多互动"
        >
          <Sparkles size={14} />
        </button>
      </div>

      {/* Interaction Popup Menu */}
      {menuOpen && (
        <div
          className="pet-interaction-menu"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="menu-header">
            <span>🐾 陪伴互动</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
              }}
              aria-label="关闭菜单"
            >
              <X size={12} />
            </button>
          </div>
          <button type="button" className="menu-item" onClick={feedBone}>
            <span>🍖 喂小肉骨头</span>
          </button>
          <button type="button" className="menu-item" onClick={playBall}>
            <span>⚽ 扔皮球玩耍</span>
          </button>
          <button type="button" className="menu-item" onClick={petHead}>
            <span>💖 温柔摸摸头</span>
          </button>
          <button type="button" className="menu-item" onClick={toggleSleep}>
            {petState === "sleepy" ? (
              <>
                <Sun size={13} /> <span>叫醒小狗</span>
              </>
            ) : (
              <>
                <Moon size={13} /> <span>让小狗睡会儿</span>
              </>
            )}
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={(e) => {
              e.stopPropagation();
              const nextVal = !autoWalkEnabled;
              setAutoWalkEnabled(nextVal);
              showSpeech(nextVal ? "好耶！开启自由漫步！✨" : "我静静待着不乱跑啦🐾", 2500);
              setMenuOpen(false);
            }}
          >
            <Compass size={13} />
            <span>{autoWalkEnabled ? "关闭自动散步" : "开启自由散步"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
