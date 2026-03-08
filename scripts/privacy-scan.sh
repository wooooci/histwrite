#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

private_handle="$(printf '\167\157\157\157\157\143\151')"
private_mail_local="$(printf '\172\163\152\060\065\060\066\060\070')"
mail_domain_pattern="$(printf '\147\155\141\151\154')\\.com"
private_mail_pattern="${private_mail_local}@${mail_domain_pattern}"
campus_short="$(printf '\125\115\151\143\150')"
campus_lower="$(printf '\165\155\151\143\150')"
lib_campus_pattern="$(printf '\154\151\142')\\.${campus_lower}"
proxy_lib_campus_pattern="$(printf '\160\162\157\170\171')\\.${lib_campus_pattern}"
password_manager_pattern="$(printf '\155\171')\\.$(printf '\061\160\141\163\163\167\157\162\144')"

patterns=(
  '/Users/'
  "$private_handle"
  "$private_mail_pattern"
  "@${mail_domain_pattern}"
  "$campus_short"
  "$campus_lower"
  "$lib_campus_pattern"
  "$proxy_lib_campus_pattern"
  "$password_manager_pattern"
  'BEGIN PRIVATE KEY'
  'sk-[A-Za-z0-9_-]{10,}'
)

status=0

for pattern in "${patterns[@]}"; do
  if rg -n --hidden -S "$pattern" "$ROOT_DIR" \
    -g '!node_modules/**' \
    -g '!.git/**' \
    -g '!dist/**' \
    -g '!coverage/**' \
    -g '!scripts/privacy-scan.sh' >/tmp/histwrite-privacy-scan.out 2>/dev/null; then
    echo "[privacy] 命中模式: $pattern"
    cat /tmp/histwrite-privacy-scan.out
    status=1
  fi
done

rm -f /tmp/histwrite-privacy-scan.out

if [ "$status" -ne 0 ]; then
  echo "隐私扫描失败：请先清理命中项。"
  exit 1
fi

echo "隐私扫描通过。"
