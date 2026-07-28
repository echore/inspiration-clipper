#!/bin/bash
# scripts/setup-key.sh — 在本机生成 API key 并写入插件与扩展两端。
# 输出只有 ok/错误，key 值永不回显、不进日志。
set -euo pipefail

VAULT_DATA="/Users/liyachen/Documents/creation-flywheel/.obsidian/plugins/media-companion/data.json"
EXT_CONFIG="$(cd "$(dirname "$0")/.." && pwd)/extension/config.local.js"

KEY=$(openssl rand -hex 32)

KEY="$KEY" VAULT_DATA="$VAULT_DATA" python3 - <<'PY'
import json, os
path = os.environ["VAULT_DATA"]
with open(path) as f:
    data = json.load(f)
data["apiKey"] = os.environ["KEY"]
data["apiEnabled"] = True
with open(path, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
PY

cat > "$EXT_CONFIG" <<EOF
// 自动生成：scripts/setup-key.sh。不进 git。
export const LOCAL = {
	port: 27124,
	apiKey: "$KEY",
	folder: "灵感库",
};
EOF

echo "ok: key written to plugin data.json and extension config.local.js"
