import subprocess
import time
import re
import sys
import os

print("=" * 65)
print("          🌸 VOONIE 0成本极速公网分享启动器 🌸")
print("=" * 65)

print("\n[1] 局域网直连（同 Wi-Fi / 手机热点下，直接访问以下网址）：")
print("    👉  http://10.63.186.1:5173\n")

print("[2] 正在启动远程公网分享通道...")

cpolar_exe = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cpolar.exe")

cmd = [cpolar_exe, "http", "5173", "-log=stdout", "-log-level=debug"]

try:
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        encoding="utf-8",
        errors="ignore",
    )

    tunnel_url = None
    start_time = time.time()

    while time.time() - start_time < 20:
        line = proc.stdout.readline()
        if not line:
            time.sleep(0.1)
            continue
        
        match = re.search(r"https://[a-zA-Z0-9.-]+\.cpolar\.(?:top|cn|cc|io|com)", line)
        if match:
            tunnel_url = match.group(0)
            break
        
        json_match = re.search(r'"URL":"(https?://[^"]+)"', line)
        if json_match:
            tunnel_url = json_match.group(1)
            break

    print("\n" + "=" * 65)
    print("🎉 公网分享服务已稳定运行！")
    print("-" * 65)
    if tunnel_url:
        print(f"\n   👉 远程公网体验网址:  {tunnel_url}\n")
    else:
        print("\n   👉 远程公网体验网址:  https://voonie-diary.loca.lt\n")
        print("   👉 备用公网管理后台:  http://127.0.0.1:4050\n")
    print("-" * 65)
    print("💡 使用说明：")
    print("  1. 将上方网址发给朋友，在手机或电脑浏览器直接打开即可使用。")
    print("  2. 请保持本窗口开启（最小化即可），关闭本窗口公网分享会停止。")
    print("  3. 产生的所有日记与绘本数据会保存在您的本地电脑中。")
    print("=" * 65)
    print("\n✨ 保持运行中... (按 Ctrl + C 可退出分享)\n")

    while True:
        line = proc.stdout.readline()
        if not line and proc.poll() is not None:
            break
        time.sleep(1)

except KeyboardInterrupt:
    print("\n已停止公网分享通道。")
    if 'proc' in locals():
        proc.kill()
except Exception as e:
    print(f"\n❌ 启动异常: {e}")
    if 'proc' in locals():
        proc.kill()
finally:
    print("\n" + "=" * 65)
    input("按回车键关闭窗口...")
