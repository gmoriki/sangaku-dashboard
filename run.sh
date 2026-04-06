#!/bin/bash
# 産学連携ダッシュボード 起動スクリプト
# Usage: bash run.sh
# → http://localhost:8000 でダッシュボードが開きます

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# node_modules がなければ npm install
if [ ! -d "node_modules" ]; then
    echo "📦 依存パッケージをインストール中..."
    npm install
fi

echo ""
npm start
