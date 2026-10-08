#!/usr/bin/env bash
set -euo pipefail
umask 077
file=$(mktemp /var/lib/reach-rich/backup-XXXXXXXX.dump)
trap 'rm -f "$file"' EXIT
runuser -u postgres -- pg_dump --format=custom --no-owner --no-acl reach_rich > "$file"
key="backups/$(date -u +%Y-%m-%dT%H-%M-%SZ).dump"
aws s3 cp "$file" "s3://reach-rich-148617059023-apne2/$key" --region ap-northeast-2 --sse AES256 --only-show-errors
echo "Reach Rich database backup stored: $key"
