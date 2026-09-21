#!/bin/bash
# 「一鍵把 NAS 爬蟲的最新版發布給所有設計師電腦」（管理者在自己的 Mac 上點兩下）。
#
# 會先確認要發布的檔案都已 commit、跑全部測試，通過才發布；發布後各台設計師電腦
# 最多約 10 分鐘內會自己更新，不需要他們重新執行安裝器。沒有變動時什麼都不會做。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

NODE=""
for candidate in /usr/local/bin/node /opt/homebrew/bin/node "$(command -v node 2>/dev/null)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then NODE="$candidate"; break; fi
done
if [ -z "$NODE" ]; then
  echo "❌ 找不到 Node.js。"
  echo ""; echo "按任意鍵關閉這個視窗。"; read -n 1 -s; exit 1
fi

"$NODE" scripts/publish_nas_update.mjs "$@"
STATUS=$?
echo ""
echo "按任意鍵關閉這個視窗。"
read -n 1 -s
exit "$STATUS"
