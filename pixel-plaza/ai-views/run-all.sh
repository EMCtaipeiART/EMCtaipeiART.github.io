#!/bin/bash
# 對每個角色呼叫 Codex 生成 8 個中間角度（需已登入 codex CLI）。用法：bash run-all.sh 名稱...
cd "$(dirname "$0")"
for n in "$@"; do
  pre=staff; case "$n" in Amber|Anna|Leona|Machi|Noise) pre=designer;; esac
  mkdir -p "$n"; cp ../../character-studio/references/${pre}_${n}_{front,side,back}.png "$n/"
  cp Amber/prompt.txt "$n/prompt.txt"
  ( cd "$n" && codex exec --skip-git-repo-check -s workspace-write -i ${pre}_${n}_front.png,${pre}_${n}_side.png,${pre}_${n}_back.png - < prompt.txt > run.log 2>&1 ) &
done
wait
