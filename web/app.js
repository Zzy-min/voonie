document.addEventListener("DOMContentLoaded", () => {
  // =========================================================================
  // 1. 预置微绘本数据
  // =========================================================================
  const comicDatabase = {
    c1: {
      id: "c1",
      title: "今天喝到了好喝的奶茶！",
      tag: "开心",
      tagClass: "tag-happy",
      date: "2024.05.20",
      img: "/assets/comic_1.png",
      story: "今天下午阳光很灿烂，心情也特别棒~ 和朋友一起去打卡了路边的一家奶酪生活店，点了一杯最爱的芝士奶盖！好喝到冒泡，生活就要美滋滋呀！",
      petComment: "汪汪！今天主人的开心指数拉满啦，奶茶好喝，心情更好！"
    },
    c2: {
      id: "c2",
      title: "虽然挤不上地铁，但遇到了小猫",
      tag: "温馨",
      tagClass: "tag-warm",
      date: "2024.05.18",
      img: "/assets/comic_2.png",
      story: "今天早高峰有点不开心，工作好难，连赶地铁都没赶上。但是在回家的路上遇到了一只流浪橘猫，它冲我喵喵叫，好像在说：会有好运来的！蹲下来摸摸它，瞬间被治愈了。",
      petComment: "小猫是生活派来的毛茸茸天使，只要有爱，任何疲惫都会化解哒！"
    },
    c3: {
      id: "c3",
      title: "有点累，但也在努力生活",
      tag: "疲惫",
      tagClass: "tag-tired",
      date: "2024.05.16",
      img: "/assets/comic_3.png",
      story: "熬夜赶方案的一天，眼睛好酸好累。下班路上喝了一杯热热的可可，整个人慢慢缓过来了。给自己打打气：加油！明天一定会更好！",
      petComment: "抱抱主人~ 累了就好好睡觉，你已经超级棒了，我一直陪着你呢！"
    },
    c4: {
      id: "c4",
      title: "海边的一天",
      tag: "开心",
      tagClass: "tag-happy",
      date: "2024.05.10",
      img: "/assets/comic_4.png",
      story: "和朋友一起去海边吹晚风，海风舒舒服服的。我们一起看了日落，金灿灿的阳光洒在海面上，真的是开心又无忧无虑的一天！",
      petComment: "海浪声里有最纯粹的快乐，以后我们还要去更多好看的地方！"
    },
    c_sad: {
      id: "c_sad",
      title: "有点难过的一天",
      tag: "难过",
      tagClass: "tag-sad",
      date: "2024.05.15",
      img: "/assets/comic_3.png",
      story: "那天项目遇到了一些阻碍，心情低落到了谷底，甚至偷偷抹了眼泪。不过好在后来冷静下来，吃了顿好吃的，重新振作了起来。",
      petComment: "难过不是脆弱，而是情绪的自我呼吸。主人后来超级勇敢地走出来了！"
    }
  };

  // =========================================================================
  // 2. 绘本详情查看器 (Comic Viewer Modal)
  // =========================================================================
  const viewerModal = document.getElementById("comicViewerModal");
  const closeViewerModal = document.getElementById("closeViewerModal");
  const viewerLargeImg = document.getElementById("viewerLargeImg");
  const viewerDetailTitle = document.getElementById("viewerDetailTitle");
  const viewerDetailTag = document.getElementById("viewerDetailTag");
  const viewerDetailDate = document.getElementById("viewerDetailDate");
  const viewerDetailStory = document.getElementById("viewerDetailStory");
  const btnViewerExport = document.getElementById("btnViewerExport");

  function openComicViewer(comicId) {
    const data = comicDatabase[comicId] || comicDatabase.c1;
    viewerLargeImg.src = data.img;
    viewerDetailTitle.textContent = data.title;
    viewerDetailTag.textContent = data.tag;
    viewerDetailTag.className = `mood-tag ${data.tagClass}`;
    viewerDetailDate.textContent = data.date;
    viewerDetailStory.textContent = data.story;

    viewerModal.classList.remove("hidden");
  }

  // 绑定所有绘本卡片点击
  document.querySelectorAll(".comic-card").forEach(card => {
    card.addEventListener("click", () => {
      const id = card.getAttribute("data-comic-id");
      openComicViewer(id);
    });
  });

  // 绑定聊天里的绘本卡片
  const btnOpenSadComic = document.getElementById("btnOpenSadComic");
  if (btnOpenSadComic) {
    btnOpenSadComic.addEventListener("click", (e) => {
      e.stopPropagation();
      openComicViewer("c_sad");
    });
  }

  closeViewerModal.addEventListener("click", () => {
    viewerModal.classList.add("hidden");
  });

  btnViewerExport.addEventListener("click", () => {
    alert("🎉 绘本高清四格长图已成功生成并导出至下载目录！");
  });

  // =========================================================================
  // 3. 语音日记生成绘本全流程 (Record & Storyboard Modal)
  // =========================================================================
  const recordModal = document.getElementById("recordModal");
  const closeRecordModal = document.getElementById("closeRecordModal");
  const btnQuickRecord = document.getElementById("btnQuickRecord");
  const btnAddToday = document.getElementById("btnAddToday");

  const stepRecording = document.getElementById("stepRecording");
  const stepGenerating = document.getElementById("stepGenerating");
  const stepResult = document.getElementById("stepResult");

  const btnToggleRecord = document.getElementById("btnToggleRecord");
  const recordTimer = document.getElementById("recordTimer");
  const aiStatusText = document.getElementById("aiStatusText");
  const aiTranscriptPreview = document.getElementById("aiTranscriptPreview");
  const resultComicTitle = document.getElementById("resultComicTitle");
  const resultMoodTag = document.getElementById("resultMoodTag");
  const resultDate = document.getElementById("resultDate");
  const resultComicGrid = document.getElementById("resultComicGrid");
  const btnSaveToLibrary = document.getElementById("btnSaveToLibrary");
  const btnExportLongImg = document.getElementById("btnExportLongImg");

  let recordInterval = null;
  let seconds = 0;

  function openRecordDialog() {
    recordModal.classList.remove("hidden");
    resetRecordFlow();
  }

  function resetRecordFlow() {
    stepRecording.classList.remove("hidden");
    stepGenerating.classList.add("hidden");
    stepResult.classList.add("hidden");
    seconds = 15;
    recordTimer.textContent = "00:15";
    if (recordInterval) clearInterval(recordInterval);
  }

  btnQuickRecord.addEventListener("click", openRecordDialog);
  btnAddToday.addEventListener("click", openRecordDialog);
  closeRecordModal.addEventListener("click", () => {
    recordModal.classList.add("hidden");
    if (recordInterval) clearInterval(recordInterval);
  });

  // 点击麦克风录音
  btnToggleRecord.addEventListener("click", () => {
    startGeneratingFlow("今天早晨阳光格外温柔，在公园草坪上慢跑了半小时，遇到了一只金毛小狗摇着尾巴跑过来和我打招呼，微风轻拂，感觉整个人都被大自然充满了电！", "晨跑遇到友好小金毛", "开心", "tag-happy");
  });

  // 点击快捷语音样本
  document.querySelectorAll(".sample-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-text");
      if (text.includes("拿铁")) {
        startGeneratingFlow(text, "阳光下的浓郁咖啡香", "开心", "tag-happy");
      } else if (text.includes("小猫")) {
        startGeneratingFlow(text, "早高峰后偶遇的橘猫", "温馨", "tag-warm");
      } else {
        startGeneratingFlow(text, "疲惫但依然前行的一天", "疲惫", "tag-tired");
      }
    });
  });

  async function startGeneratingFlow(transcript, title, mood, moodTagClass) {
    stepRecording.classList.add("hidden");
    stepGenerating.classList.remove("hidden");
    aiTranscriptPreview.textContent = transcript;

    const stages = [
      { el: "stage1", text: "① 正在进行情感分析与意图提取..." },
      { el: "stage2", text: "② 正在拆解四幕分镜：起、承、转、合..." },
      { el: "stage3", text: "③ 正在调用多模态手绘动漫生成引擎..." },
      { el: "stage4", text: "④ 正在合成四格微绘本与对白气泡..." }
    ];

    for (let i = 0; i < stages.length; i++) {
      document.querySelectorAll(".story-stage").forEach(s => s.classList.remove("active"));
      const stageEl = document.getElementById(stages[i].el);
      stageEl.classList.add("active");
      aiStatusText.textContent = stages[i].text;
      await sleep(650);
      stageEl.classList.add("done");
    }

    // 展示最终生成结果
    stepGenerating.classList.add("hidden");
    stepResult.classList.remove("hidden");

    resultComicTitle.textContent = title;
    resultMoodTag.textContent = mood;
    resultMoodTag.className = `mood-tag ${moodTagClass}`;
    resultDate.textContent = "2024.05.20";

    resultComicGrid.innerHTML = `
      <div class="result-panel-box">
        <span class="result-panel-caption">① 晨起出发</span>
        <img src="/assets/comic_1.png" class="result-panel-img" style="object-position: top left;">
      </div>
      <div class="result-panel-box">
        <span class="result-panel-caption">② 跑道偶遇</span>
        <img src="/assets/comic_1.png" class="result-panel-img" style="object-position: top right;">
      </div>
      <div class="result-panel-box">
        <span class="result-panel-caption">③ 摇尾问好</span>
        <img src="/assets/comic_1.png" class="result-panel-img" style="object-position: bottom left;">
      </div>
      <div class="result-panel-box">
        <span class="result-panel-caption">④ 能量满格</span>
        <img src="/assets/comic_1.png" class="result-panel-img" style="object-position: bottom right;">
      </div>
    `;
  }

  btnSaveToLibrary.addEventListener("click", () => {
    alert("✨ 已成功同步至本地绘本库与记忆日历！");
    recordModal.classList.add("hidden");
  });

  btnExportLongImg.addEventListener("click", () => {
    alert("📥 高清四格微绘本长图已保存！");
  });

  // =========================================================================
  // 4. 萌宠伴侣即时对话 (Pet Companion Chat)
  // =========================================================================
  const chatMessagesArea = document.getElementById("chatMessagesArea");
  const chatTextInput = document.getElementById("chatTextInput");
  const btnChatVoice = document.getElementById("btnChatVoice");
  const btnQuickChat = document.getElementById("btnQuickChat");

  btnQuickChat.addEventListener("click", () => {
    chatTextInput.focus();
    chatTextInput.placeholder = "有什么心事都可以和我说哦~";
  });

  // 快捷问题胶囊点击
  document.querySelectorAll(".quick-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const prompt = chip.getAttribute("data-prompt");
      handleUserSendMessage(prompt);
    });
  });

  chatTextInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && chatTextInput.value.trim()) {
      handleUserSendMessage(chatTextInput.value.trim());
      chatTextInput.value = "";
    }
  });

  btnChatVoice.addEventListener("click", () => {
    handleUserSendMessage("今天心情怎么样？帮我看看本周的总结吧~");
  });

  async function handleUserSendMessage(text) {
    // 渲染用户消息
    const userMsg = document.createElement("div");
    userMsg.className = "chat-msg msg-user";
    userMsg.innerHTML = `
      <div class="bubble bubble-user">${text}</div>
      <img src="/assets/user_avatar.png" alt="用户" class="msg-avatar user-msg-avatar">
    `;
    chatMessagesArea.appendChild(userMsg);
    chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;

    // 模拟萌宠思考与智能回忆
    await sleep(400);

    let petReply = "汪汪！我在听呢~ 每天陪伴主人记录生活，是我最开心的任务！不管发生什么，我都会守护你的每一段珍贵记忆！";
    let embedCardHtml = "";

    if (text.includes("开心")) {
      petReply = "汪汪，我查了一下记忆库！5月20日那天你喝到了超级满意的奶茶，笑得特别甜，那是你近期最开心的一天哦！";
      embedCardHtml = `
        <div class="memory-card-embed" onclick="openComicViewer('c1')">
          <div class="memory-card-thumb">
            <img src="/assets/comic_1.png" alt="喝到好喝奶茶" class="thumb-img">
          </div>
          <div class="memory-card-info">
            <div class="memory-title">今天喝到了好喝的奶茶！</div>
            <span class="mood-tag tag-happy">开心</span>
            <div class="memory-date">2024.05.20</div>
            <button class="view-comic-btn">查看绘本</button>
          </div>
        </div>
      `;
    } else if (text.includes("回顾") || text.includes("上周") || text.includes("难过")) {
      petReply = "汪汪，上周你经历了好几个不同的情绪呢：有挤地铁遇到小猫的温馨，也有加班的疲惫。但你每一天都在认真生活，真的很棒！";
      embedCardHtml = `
        <div class="memory-card-embed" onclick="openComicViewer('c2')">
          <div class="memory-card-thumb">
            <img src="/assets/comic_2.png" alt="遇到小猫" class="thumb-img">
          </div>
          <div class="memory-card-info">
            <div class="memory-title">虽然挤不上地铁，但遇到了小猫</div>
            <span class="mood-tag tag-warm">温馨</span>
            <div class="memory-date">2024.05.18</div>
            <button class="view-comic-btn">查看绘本</button>
          </div>
        </div>
      `;
    }

    const petMsg = document.createElement("div");
    petMsg.className = "chat-msg msg-pet with-avatar";
    petMsg.innerHTML = `
      <img src="/assets/dog_avatar.png" alt="萌宠" class="msg-avatar pet-msg-avatar">
      <div class="bubble-stack">
        <div class="bubble bubble-pet">${petReply}</div>
        ${embedCardHtml}
      </div>
    `;
    chatMessagesArea.appendChild(petMsg);
    chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
  }

  // =========================================================================
  // 5. 记忆日历与全局导航
  // =========================================================================
  document.querySelectorAll(".day-card:not(.add-day-card)").forEach(card => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".day-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      const date = card.getAttribute("data-date");
      console.log("选中日期:", date);
    });
  });

  // 导航项切换
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
      item.classList.add("active");
    });
  });

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  window.openComicViewer = openComicViewer;
});
