#!/usr/bin/env bash
# Store server-only R2 settings locally; Spring does not automatically load .env files.
set -euo pipefail
set +x
umask 077

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$repo_root"
settings_file=.env.r2.local
if [[ -e $settings_file ]]; then
  printf '%s already exists; keeping it unchanged.\n' "$settings_file" >&2
  exit 1
fi
git check-ignore -q -- "$settings_file" || {
  printf 'The local settings file must be ignored by Git before saving credentials.\n' >&2
  exit 1
}

read -rp 'R2 client endpoint (https://ACCOUNT.r2.cloudflarestorage.com, without bucket): ' MEMORY_ARCHIVE_R2_ENDPOINT
read -rp 'Private test bucket name: ' MEMORY_ARCHIVE_R2_BUCKET
read -rsp 'R2 Access Key ID (input hidden): ' MEMORY_ARCHIVE_R2_ACCESS_KEY_ID
printf '\n'
read -rsp 'R2 Secret Access Key (input hidden): ' MEMORY_ARCHIVE_R2_SECRET_ACCESS_KEY
printf '\n'
for setting in MEMORY_ARCHIVE_R2_ENDPOINT MEMORY_ARCHIVE_R2_BUCKET MEMORY_ARCHIVE_R2_ACCESS_KEY_ID MEMORY_ARCHIVE_R2_SECRET_ACCESS_KEY; do
  [[ -n ${!setting} ]] || { printf 'All four settings are required; nothing was saved.\n' >&2; exit 1; }
done
[[ $MEMORY_ARCHIVE_R2_ENDPOINT =~ ^https://[a-zA-Z0-9.-]+\.r2\.cloudflarestorage\.com/?$ ]] || {
  printf 'Use the R2 client endpoint without a bucket path; nothing was saved.\n' >&2
  exit 1
}
# noclobber also protects against a file appearing while the prompts were open.
set -o noclobber
{
  printf '# Private local settings. Do not commit or share this file.\n'
  printf 'export MEMORY_ARCHIVE_STORAGE_ENABLED=true\n'
  for setting in MEMORY_ARCHIVE_R2_ENDPOINT MEMORY_ARCHIVE_R2_BUCKET MEMORY_ARCHIVE_R2_ACCESS_KEY_ID MEMORY_ARCHIVE_R2_SECRET_ACCESS_KEY; do
    printf 'export %s=%q\n' "$setting" "${!setting}"
  done
} > "$settings_file"
printf 'Saved ignored local settings. Load them with: source .env.r2.local\n'
