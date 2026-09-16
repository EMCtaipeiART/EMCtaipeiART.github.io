#!/bin/bash
# 停用這台 Mac 的 NAS 自動備份（不會刪掉 NAS 或雲端上任何圖片）。
set -uo pipefail
INSTALL_DIR="$HOME/Library/Application Support/MachiNasWatcher"

echo "=== 移除 NAS 自動備份 ==="
for label in com.emctaipei.nas-watcher com.emctaipei.nas-folder-picker; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null
  launchctl unload -w "$HOME/Library/LaunchAgents/$label.plist" 2>/dev/null
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
  echo "已停用：$label"
done

echo ""
echo "程式與設定仍保留在：$INSTALL_DIR"
echo "（要完全清掉就把這個資料夾丟到垃圾桶；NAS 與雲端上的圖片不受影響）"
echo ""
echo "按任意鍵關閉這個視窗。"
read -n 1 -s
