#!/usr/bin/env bash
set -Eeuo pipefail
umask 027
export PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin

# Install root-owned at /usr/local/sbin/reach-rich-deploy; CI may invoke only
# the fixed ReachRich-Deploy SSM document. GitHub main-only trust is enforced
# by the OIDC role and IAM document/instance restrictions, not by a caller flag.
[[ $EUID -eq 0 ]] || { echo 'Deployment requires the installed root runner' >&2; exit 1; }
[[ $# -eq 2 ]] || { echo 'Expected ReleaseId and Sha256' >&2; exit 1; }
release_id=$1
expected_sha=$2
[[ $release_id =~ ^[0-9a-f]{40}-[0-9]+-[0-9]+$ ]] || { echo 'Invalid release ID' >&2; exit 1; }
[[ $expected_sha =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid artifact checksum' >&2; exit 1; }

app_root=/opt/reach-rich
releases=$app_root/releases
release=$releases/$release_id
current=$app_root/current
work=''
staging=''
previous=''
switched=0
healthy=0

exec 9>/run/lock/reach-rich-deploy.lock
flock -n 9 || { echo 'Another REACH RICH deployment is running' >&2; exit 1; }

check_health() {
  local attempt
  for attempt in $(seq 1 15); do
    if curl --silent --show-error --fail --max-time 1 http://127.0.0.1:3106/api/health 2>/dev/null |
      python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("status")=="ok" else 1)' 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

switch_to() {
  local target=$1
  local link=$app_root/.current-$release_id
  ln -s -- "$target" "$link"
  mv -Tf -- "$link" "$current"
}

finish() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  if [[ $status -ne 0 && $switched -eq 1 && $healthy -eq 0 ]]; then
    echo 'Deployment failed; restoring previous application code. Database migrations are not reversed.' >&2
    if [[ -d $previous && $(dirname -- "$previous") == "$releases" ]]; then
      rm -f -- "$app_root/.current-$release_id"
      switch_to "$previous"
      if systemctl restart reach-rich.service && check_health; then
        echo 'Previous application code restored; health=ok' >&2
      else
        echo 'Previous code selected but health is unavailable; operator action required' >&2
      fi
    else
      echo 'Previous release is unavailable; operator action required' >&2
    fi
  fi
  if [[ -n $work && $work == "$app_root"/.deploy-work.* ]]; then
    rm -rf --one-file-system -- "$work"
  fi
  # Failed extracted releases remain for diagnosis; no database data is deleted.
  if [[ $status -ne 0 && -n $staging ]]; then
    echo 'A failed release may remain under the releases directory for inspection' >&2
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ -d $app_root && ! -L $app_root && -d $releases && ! -L $releases ]] || { echo 'Application directories are missing or symlinked' >&2; exit 1; }
[[ -L $current ]] || { echo 'An existing release symlink is required' >&2; exit 1; }
previous=$(readlink -f -- "$current")
[[ -d $previous && $(dirname -- "$previous") == "$releases" ]] || { echo 'Current release is outside the managed directory' >&2; exit 1; }
[[ -f /etc/reach-rich/production.env ]] || { echo 'Production environment file is missing' >&2; exit 1; }

# Runtime may write only its release cache, not replace managed releases/symlinks.
chown root:reach-rich "$app_root" "$releases"
chmod 0750 "$app_root" "$releases"
available_kb=$(df -Pk "$releases" | awk 'END {print $4}')
[[ $available_kb -ge 1572864 ]] || { echo 'Insufficient free disk space (requires 1.5 GiB)' >&2; exit 1; }
available_memory_kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
[[ ${available_memory_kb:-0} -ge 262144 ]] || { echo 'Insufficient available memory (requires 256 MiB)' >&2; exit 1; }

if [[ -e $release || -L $release ]]; then
  if [[ $previous == "$release" && ! -L $release && -f $release/.artifact-sha256 &&
        $(cat "$release/.artifact-sha256") == "$expected_sha" &&
        $(cat "$release/RELEASE_ID") == "$release_id" ]] && check_health; then
    echo "deployedReleaseId=$release_id"
    echo 'health=ok (already active)'
    exit 0
  fi
  echo 'Release ID already exists; use a new workflow run attempt' >&2
  exit 1
fi

work=$(mktemp -d "$app_root/.deploy-work.XXXXXXXX")
chown root:reach-rich "$work"
chmod 0750 "$work"
archive=$work/release.tar.gz
timeout 90 aws s3 cp "s3://reach-rich-148617059023-apne2/releases/ci/$release_id.tar.gz" "$archive" \
  --region ap-northeast-2 --only-show-errors
chown root:reach-rich "$archive"
chmod 0640 "$archive"
actual_sha=$(sha256sum "$archive" | awk '{print $1}')
[[ $actual_sha == "$expected_sha" ]] || { echo 'Artifact checksum mismatch' >&2; exit 1; }

# Validate every archive entry before extracting as the unprivileged app user.
# No hardlinks/devices/FIFOs, traversal, duplicate paths, or writes under symlinks.
python3 - "$archive" "$release_id" "$releases" <<'PY_ARCHIVE'
import os, pathlib, posixpath, shutil, sys, tarfile
archive, release_id, releases = sys.argv[1:]
if os.path.getsize(archive) > 512 * 1024 * 1024:
    raise SystemExit('Compressed artifact exceeds 512 MiB')
seen = {}
links = set()
total = 0
with tarfile.open(archive, 'r:gz') as package:
    for member in package:
        name = member.name
        if name.startswith('/') or '\\' in name or any(ord(c) < 32 for c in name):
            raise SystemExit('Unsafe archive path')
        path = pathlib.PurePosixPath(name)
        if '..' in path.parts or len(name) > 4096:
            raise SystemExit('Unsafe archive traversal')
        normalized = path.as_posix()
        if normalized == '.':
            if not member.isdir():
                raise SystemExit('Archive root must be a directory')
            continue
        if normalized in {'.artifact-sha256', '.deploy-complete'}:
            raise SystemExit('Artifact contains a reserved deployment marker')
        if normalized in seen:
            raise SystemExit('Duplicate archive entry')
        if not (member.isdir() or member.isfile() or member.issym()):
            raise SystemExit('Unsupported archive entry type')
        if member.mode & 0o7000:
            raise SystemExit('Privileged archive file mode')
        seen[normalized] = member
        if len(seen) > 50000:
            raise SystemExit('Too many archive entries')
        if member.isfile():
            total += member.size
            if member.size > 512 * 1024 * 1024 or total > 1024 * 1024 * 1024:
                raise SystemExit('Expanded artifact exceeds size limit')
        if member.issym():
            target = member.linkname
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(normalized), target))
            if target.startswith('/') or '\\' in target or any(ord(c) < 32 for c in target) or resolved == '..' or resolved.startswith('../'):
                raise SystemExit('Unsafe archive symlink')
            links.add(normalized)
    for name in seen:
        if any(parent.as_posix() in links for parent in pathlib.PurePosixPath(name).parents):
            raise SystemExit('Archive entry has a symlink ancestor')
    for required in ['server.js', 'ops/migrate.cjs', 'RELEASE_ID', '.next/BUILD_ID']:
        if required not in seen or not seen[required].isfile():
            raise SystemExit('Missing release component: ' + required)
    release_member = seen['RELEASE_ID']
    if release_member.size > 200 or package.extractfile(release_member).read().decode().strip() != release_id:
        raise SystemExit('Artifact RELEASE_ID does not match request')
if shutil.disk_usage(releases).free < total + 512 * 1024 * 1024:
    raise SystemExit('Insufficient disk space for extraction and operating reserve')
print('Artifact structure and checksum validated')
PY_ARCHIVE

staging=$(mktemp -d "$releases/.incoming-$release_id-XXXXXXXX")
chown reach-rich:reach-rich "$staging"
chmod 0750 "$staging"
timeout 60 runuser -u reach-rich -- tar --extract --gzip --file "$archive" --directory "$staging" \
  --no-same-owner --no-same-permissions --delay-directory-restore

# Freeze the extraction root before a second filesystem-level symlink check.
chown root:root "$staging"
chmod 0700 "$staging"
python3 - "$staging" <<'PY_FREEZE'
import grp, os, pathlib, stat, sys
root = pathlib.Path(sys.argv[1]).resolve(strict=True)
gid = grp.getgrnam('reach-rich').gr_gid
for directory, directories, files in os.walk(root, followlinks=False):
    for name in directories + files:
        item = pathlib.Path(directory) / name
        mode = item.lstat().st_mode
        if stat.S_ISLNK(mode):
            try:
                resolved = item.resolve(strict=True)
                resolved.relative_to(root)
            except (ValueError, OSError, RuntimeError):
                raise SystemExit('Release contains an escaping, dangling, or cyclic symlink')
            os.chown(item, 0, gid, follow_symlinks=False)
        elif stat.S_ISDIR(mode):
            os.chown(item, 0, gid)
            os.chmod(item, 0o750)
        elif stat.S_ISREG(mode):
            os.chown(item, 0, gid)
            os.chmod(item, 0o750 if mode & 0o111 else 0o640)
        else:
            raise SystemExit('Release contains an unsupported filesystem entry')
os.chown(root, 0, gid)
os.chmod(root, 0o750)
PY_FREEZE
[[ ! -L $staging/.next && ! -L $staging/.next/cache ]] || { echo 'Runtime cache path must not be symlinked' >&2; exit 1; }
mkdir -p "$staging/.next/cache"
chown -hR reach-rich:reach-rich "$staging/.next/cache"
chmod 0750 "$staging/.next/cache"
printf '%s\n' "$expected_sha" > "$staging/.artifact-sha256"
chmod 0640 "$staging/.artifact-sha256"
chown root:reach-rich "$staging/.artifact-sha256"
mv -T -- "$staging" "$release"
staging=$release

# A successful off-host backup is required before applying forward-only migrations.
timeout 120 /usr/local/sbin/reach-rich-backup
systemd-run --unit="reach-rich-migrate-$release_id" --wait --pipe --collect \
  --uid=reach-rich --gid=reach-rich \
  --property="WorkingDirectory=$release" \
  --property=EnvironmentFile=/etc/reach-rich/production.env \
  --property=RuntimeMaxSec=90 \
  --property=UMask=0027 \
  /usr/local/bin/node ops/migrate.cjs

switched=1
switch_to "$release"
systemctl restart reach-rich.service
check_health || { echo 'New release failed its health check' >&2; exit 1; }
[[ $(readlink -f -- "$current") == "$release" && $(cat "$current/RELEASE_ID") == "$release_id" ]] || { echo 'Active release identity mismatch' >&2; exit 1; }
touch "$release/.deploy-complete"
chmod 0640 "$release/.deploy-complete"
healthy=1

# Retain the current/previous releases plus the newest successful CI releases,
# up to three in total. Ignore historical/manual names and failed/incoming dirs.
if ! python3 - "$releases" "$release" "$previous" <<'PY_RETENTION'
import os, pathlib, re, shutil, sys
root = pathlib.Path(sys.argv[1]).resolve(strict=True)
active = pathlib.Path(sys.argv[2]).resolve(strict=True)
previous = pathlib.Path(sys.argv[3]).resolve(strict=True)
pattern = re.compile(r'[0-9a-f]{40}-[0-9]+-[0-9]+')
candidates = []
for item in root.iterdir():
    if not pattern.fullmatch(item.name) or item.is_symlink() or not item.is_dir():
        continue
    marker = item / '.deploy-complete'
    identity = item / 'RELEASE_ID'
    if not marker.is_file() or marker.is_symlink() or not identity.is_file() or identity.is_symlink():
        continue
    if identity.read_text().strip() != item.name:
        continue
    candidates.append((marker.stat().st_mtime_ns, item))
keep = {active, previous}
for _, item in sorted(candidates, reverse=True):
    if len(keep) < 3:
        keep.add(item)
for _, item in candidates:
    if item in keep:
        continue
    if item.parent != root or item.is_symlink() or item.resolve() in {active, previous}:
        raise SystemExit('Refusing unsafe release cleanup')
    if any(os.path.ismount(pathlib.Path(directory) / name) for directory, dirs, files in os.walk(item, followlinks=False) for name in dirs):
        raise SystemExit('Refusing release cleanup across a mount point')
    shutil.rmtree(item)
print('Release retention checked')
PY_RETENTION
then
  echo 'Release is healthy; old release cleanup requires inspection' >&2
fi

echo "deployedReleaseId=$release_id"
echo 'health=ok'
