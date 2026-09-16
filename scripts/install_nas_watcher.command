#!/bin/bash
# 「一鍵把這台 Mac 變成會自動備份 NAS 設計圖的電腦」
#
# 設計師只要在 NAS 的安裝資料夾裡點兩下這個檔案即可。這支腳本只做最少的事：
# 找到 Node、把最新版程式下載到自己的電腦、然後交給 Node 版安裝程式處理其餘設定。
# 重跑一次就是更新到最新版。
set -uo pipefail

REPO_RAW="https://raw.githubusercontent.com/EMCtaipeiART/EMCtaipeiART.github.io/main"
INSTALL_DIR="$HOME/Library/Application Support/MachiNasWatcher"
SCRIPTS=(nas_watcher_installer.mjs nas_design_image_lib.mjs nas_design_image_watcher.mjs nas_folder_picker_server.mjs nas_design_image_watcher.config.json)

finish() {
  echo ""
  echo "按任意鍵關閉這個視窗。"
  read -n 1 -s
  exit "${1:-0}"
}

echo "=== EMC 設計需求系統：NAS 自動備份安裝 ==="
echo ""

if [ "$(uname)" != "Darwin" ]; then
  echo "❌ 這支安裝程式只能在 Mac 上執行。"
  finish 1
fi

NODE=""
for candidate in /usr/local/bin/node /opt/homebrew/bin/node "$(command -v node 2>/dev/null)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then NODE="$candidate"; break; fi
done

if [ -z "$NODE" ]; then
  echo "這台電腦還沒有安裝 Node.js，備份程式需要它才能執行。"
  echo "我幫你開啟官方下載頁，請下載 macOS 版安裝檔（.pkg）裝好之後，再點一次這個安裝程式。"
  open "https://nodejs.org/zh-tw/download/prebuilt-installer"
  finish 1
fi

echo "找到 Node：$NODE"
echo "正在下載最新版備份程式..."
mkdir -p "$INSTALL_DIR/scripts" || { echo "❌ 無法建立安裝資料夾：$INSTALL_DIR"; finish 1; }

for name in "${SCRIPTS[@]}"; do
  if ! curl -fsSL "$REPO_RAW/scripts/$name" -o "$INSTALL_DIR/scripts/$name.download"; then
    echo "❌ 下載 $name 失敗，請確認這台電腦連得上網際網路。"
    finish 1
  fi
  # 設定檔只在第一次安裝時放進去，之後重跑不覆蓋這台電腦已經調整好的設定
  # （mountRoot 等欄位由 Node 版安裝程式重新計算後寫回）。
  mv -f "$INSTALL_DIR/scripts/$name.download" "$INSTALL_DIR/scripts/$name"
done
echo "下載完成。"
echo ""

"$NODE" "$INSTALL_DIR/scripts/nas_watcher_installer.mjs" --install-dir "$INSTALL_DIR" --node "$NODE"
STATUS=$?
finish "$STATUS"
