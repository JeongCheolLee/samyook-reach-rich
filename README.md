# REACH RICH

### 삼육, 올해엔 어디로 갈 것인가? 아니 가긴 가나..?

친구들이 매달 돈을 모아 미국 주식에 투자하고, 1년 뒤 수익률에 따라 여행을 떠나는 프로젝트.

수익률이 높으면 유럽, 낮으면... 발산역.

## 여행지 티어

| 인당 평가금 | 목적지 |
|---|---|
| 200만원+ | 유럽 |
| 180만원 | 일본 |
| 160만원 | 제주도 |
| 140만원 | 강릉 |
| 120만원 | 가평 펜션 |
| 100만원 | 속초 당일치기 |
| 80만원 | 한강 치킨 |
| 60만원 | 편의점 삼각김밥 |
| 40만원 | 발산역 |
| 20만원 | 각자 집 |
| 0원 | 손절 |

## 기능

- 한국투자증권 OpenAPI 실시간 연동
- 보유 종목 현황 + 수익률 (다종목 카드 / 종목 탭 차트)
- 환차손익 카드 — 원화 손익을 주가 손익 / 환차손익 / 수수료로 분해, 매수별 적용환율 표
- 원/달러 30일 차트 + 평균 적용환율 선
- 인당 평가금 기반 여행지 프로그레스 바
- 멤버별 납입금 / 평가금 표시
- 주가 차트 (recharts)
- 어드민 페이지 (멤버 관리)

## 기술 스택

Next.js 16 + TypeScript + Tailwind CSS + PostgreSQL + AWS EC2 / Nginx / systemd

## 멤버

민우 성윤 재홍 철현 상운 우재 준형 세운

삼육 부자야~~~~

## 서버 구조와 데이터

Next.js가 화면과 API를 함께 제공하고, `src/server/services/`에서 PostgreSQL에 접근합니다. 별도 Redis는 사용하지 않습니다. 배포 구성은 기존 EC2의 Nginx → `127.0.0.1:3106`의 Next.js 프로세스 → PostgreSQL입니다. 운영 주소는 https://36-reach-rich.jeongcheol.cloud 이며, 아래 명령은 이후 유지보수를 위한 절차입니다.

- `members`: 고유 ID와 수정 버전. 탈퇴한 멤버는 비활성화해 과거 기록을 유지합니다.
- `deposits`: 납입(`deposit`), 관리자 조정(`adjustment`), 이전 기준 잔액(`opening`) 원장. 누적 납입금은 원장 합계이며, 이전 기준 잔액은 삭제할 수 없습니다.
- `comments`: 당시 작성자 이름·아이콘과 답글 연결. 원본에서 부모가 사라진 답글은 `legacy_parent_id`에 원래 연결을 보존합니다.
- `view_totals` / `daily_views`: 전체 방문 수와 날짜별 집계를 독립적으로 보존합니다. 날짜 기준은 서울입니다.
- `admin_sessions`: 만료 가능한 관리자 세션. 브라우저 쿠키 원문 대신 해시를 저장합니다.
- `kis_tokens`: 증권 API 토큰, 만료 시각, 발급 시도 시각. PostgreSQL 잠금과 재시도 제한으로 중복 발급을 제어합니다.
- `schema_migrations` / `redis_import_runs`: 적용한 스키마와 데이터 이전 이력을 기록합니다.

멤버 수정은 조회한 `version`을 제출합니다. 다른 요청이 먼저 납입이나 멤버 정보를 변경했다면 HTTP 409를 반환하므로 새로 조회하고 수정해야 합니다. 빈 DB에 샘플 멤버를 자동 생성하지 않습니다.

## 로컬 실행과 검증

Node.js 22와 PostgreSQL 16 이상을 사용합니다. `.env.example`을 참고해 `.env.local`을 작성합니다. Next.js는 해당 파일을 읽지만 DB/이전 CLI는 셸의 환경변수를 사용하므로 별도로 주입해야 합니다.

| 환경변수 | 용도 |
|---|---|
| `DATABASE_URL` | 앱 전용 PostgreSQL 연결 문자열 |
| `DATABASE_POOL_MAX` | 프로세스당 최대 연결 수. 기본 5 |
| `APP_URL` | 실제 공개 주소. 운영에서는 HTTPS 주소 사용 |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | 관리자 로그인 자격 증명 |
| `KIS_BASE_URL`, `KIS_APP_KEY`, `KIS_APP_SECRET` | 한국투자증권 API 연결 |
| `KIS_ACCOUNT_NO`, `KIS_ACCOUNT_PRDT` | 증권 계좌 설정 |
| `IPINFO_TOKEN` | 선택적인 IP 위치 조회 보완 |

```sh
npm ci
# 실제 로컬 연결 문자열을 셸에 설정합니다.
export DATABASE_URL='postgresql://localhost:5432/reach_rich_local'
npm run db:migrate
npm run dev
```

`db/migrations/`의 SQL을 파일명 순서대로 적용합니다. 적용한 SQL을 수정하면 체크섬 검사에서 거절되므로 변경은 새 마이그레이션으로 추가합니다. 동시에 실행한 마이그레이션은 DB 잠금으로 직렬화됩니다.

```sh
npm run lint
npm run typecheck
npm test
```

DB 통합 테스트까지 실행하려면 **이름이 `_test`로 끝나는 별도 빈 DB**를 준비합니다. 통합 테스트는 해당 DB의 테스트 테이블과 스키마를 초기화합니다. `TEST_DATABASE_URL`이 없으면 DB 통합 테스트는 건너뜁니다.

```sh
export TEST_DATABASE_URL='postgresql://localhost:5432/reach_rich_test'
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
npm test
```

검증 범위에는 동시 납입·중복 삭제, 오래된 수정 버전 거절, 조정 실패 시 롤백, 비활성 멤버 기록 보존, 댓글 연결, 방문 집계, 세션·권한, 토큰 발급 경쟁, 데이터 이전 재실행 보호가 포함됩니다.

## Redis 데이터 이전

이전 도구만 `KV_REST_API_URL`, `KV_REST_API_TOKEN`을 사용합니다. 운영 앱 환경에는 필요 없습니다. 내보낸 JSON에는 댓글 접속 정보와 증권 토큰이 포함될 수 있으므로 권한 0600으로 보관하며 저장소에 추가하지 않습니다. `.migration/`은 Git과 Docker 빌드 대상에서 제외됩니다.

1. 실제 전환 전에는 `--live-rehearsal`로 원본을 읽고 별도 `_rehearsal` 또는 `_test` DB에서 가져오기와 대조를 검증합니다. 원본이 계속 바뀌는 동안 내보낸 파일은 최종 전환용으로 사용하지 않습니다.
2. 최종 전환 때는 기존 서비스의 사용자 쓰기뿐 아니라 방문 수 증가와 증권 토큰 발급도 중단합니다. 기존 Vercel 주소와 과거 배포 URL로 직접 접근하는 요청까지 차단해야 합니다. 이미 실행 중인 요청이 종료된 뒤 최소 65초를 기다려 기존 증권 토큰 발급 제한을 넘깁니다.
3. `--quiesced`로 최종 스냅샷을 만들고 빈 운영 DB에 가져옵니다. 이 플래그는 원본 서비스를 직접 정지시키지 않습니다.
4. 데이터 대조 후 새 서버의 로그인·조회·납입·댓글·증권 연동을 확인하고 트래픽과 쓰기를 재개합니다. 가져온 토큰이 거절됐을 때 즉시 재발급할 수 있도록 증권 최종 검증은 가져오기 후 65초가 지난 뒤 수행합니다.

```sh
npm run data:export -- --output .migration/rehearsal.json --live-rehearsal
# DATABASE_URL은 별도 reach_rich_rehearsal DB를 가리켜야 합니다.
npm run data:import -- --input .migration/rehearsal.json --allow-live-rehearsal
npm run data:verify -- --input .migration/rehearsal.json --allow-live-rehearsal

# 원본 전체를 정지한 뒤 별도 파일로 최종 내보내기를 수행합니다.
npm run data:export -- --output .migration/final.json --quiesced
# DATABASE_URL을 빈 운영 DB로 지정한 뒤 실행합니다.
npm run data:import -- --input .migration/final.json
npm run data:verify -- --input .migration/final.json
```

기존 Redis에는 납입 최근 1,000건과 댓글 최근 500건만 남을 수 있습니다. 원본에 남은 내역을 모두 옮기고, 현재 누적 납입금과 내역 합계의 차이는 `opening` 기록으로 보존합니다. 이미 사라진 과거 개별 내역은 복원하지 못합니다. 기존 데이터가 멤버 이름만 식별자로 사용했기 때문에 삭제 후 같은 이름으로 재등록한 사람의 과거 기록도 자동으로 구별할 수 없습니다.

같은 스냅샷의 재실행은 데이터를 덮어쓰지 않습니다. 다른 스냅샷이나 기존 데이터가 있는 목적지는 거절합니다. 재실행의 `alreadyImported`는 현재 데이터의 일치 여부를 뜻하지 않으므로 대조가 필요하면 `data:verify`를 별도로 실행합니다. 서비스에서 새 데이터가 생긴 뒤에는 원본 스냅샷과 달라지는 것이 정상입니다.

## EC2 빌드와 서비스 운영

운영 서버에서 빌드하지 않고 Linux x86_64 실행 결과물을 만듭니다. `.dockerignore`가 환경변수 파일과 이전 스냅샷을 제외합니다. 빌드 시 운영 비밀값은 전달하지 않습니다.

```sh
docker buildx build --platform linux/amd64 \
  -f Dockerfile.build \
  --build-arg APP_URL=https://36-reach-rich.jeongcheol.cloud \
  --output type=local,dest=/tmp/reach-rich-artifact .
```

결과물에는 `server.js`, 정적 파일, 필요한 Node 모듈, SQL, 번들된 `ops/migrate.cjs`, `ops/redis-import.cjs`, `ops/redis-verify.cjs`가 포함됩니다. 서버의 `/opt/reach-rich/releases/<release-id>/`에 배치하고 `/opt/reach-rich/current` 심볼릭 링크로 활성 버전을 지정합니다. `.next/cache` 등 런타임 쓰기 경로에만 앱 계정 쓰기 권한을 부여합니다.

- 앱 계정: `reach-rich`
- 운영 환경 파일: `/etc/reach-rich/production.env` (앱 설정과 `DATABASE_URL`을 합친 파일, root 소유·앱 그룹 읽기만 허용)
- DB 자격 증명 원본: `/etc/reach-rich/db.env` (root 소유·앱 그룹 읽기만 허용)
- 서비스 설정: `ops/reach-rich.service`
- 앱 포트: 외부에 공개하지 않는 `127.0.0.1:3106`
- 메모리: Node 힙 512MiB, systemd `MemoryHigh=640M`, `MemoryMax=768M`
- Nginx 설정: `ops/nginx-http.conf`는 인증서 발급용 경로와 점검 응답, `ops/nginx-https.conf`는 HTTPS 서비스
- ACME webroot: `/var/www/reach-rich-acme` (Nginx가 읽고 접근할 수 있는 별도 경로)

`ops/bootstrap-host.sh`는 앱 전용 계정·디렉터리·DB를 준비하고, PostgreSQL의 실제 `hba_file`에 관리 블록을 추가합니다. 비밀번호 인증은 `reach_rich` 역할의 `reach_rich`, `reach_rich_rehearsal`, `reach_rich_restore_test` DB에 대한 `127.0.0.1` 및 `::1` 접속에만 적용됩니다. 기존 앱의 인증 규칙은 보존하며 변경 전 파일을 같은 디렉터리의 `pg_hba.conf.reach-rich-before-<UTC시각>` 형태로 백업합니다. 문법 검증 실패 시 원본을 복구하고, 같은 설정으로 재실행하면 파일을 바꾸지 않습니다. 다른 이름의 복구 DB에 TCP로 앱을 연결하려면 해당 DB에 한정된 규칙을 별도로 검토해야 합니다.

2026-10-08 AWS 운영 전환을 완료했습니다. DNS A 레코드는 `43.203.91.246`이며 가비아·Google·Cloudflare 조회에서 반영을 확인했습니다. HTTPS 인증서 만료일은 2027-01-06입니다. 공개 HTTPS 헬스체크, 관리자 로그인·로그아웃, 비인증 쓰기 요청의 401 거절, 멤버 9명 조회, 한국투자증권 포트폴리오·차트 응답과 브라우저의 금융 현황·멤버·댓글·차트 표시를 검증했습니다.

원본 요청을 차단한 뒤 최종 스냅샷을 PostgreSQL로 가져와 전체 데이터 해시를 대조했습니다. 최종 S3 백업 `backups/2026-10-08T06-31-40Z.dump`를 별도 DB에 앱 역할 소유로 복원하고, 최종 스냅샷과 데이터 해시·증권 토큰이 일치하는 것도 확인했습니다. 검증용 DB와 임시 파일은 정리했습니다.

백업과 인증서 갱신 타이머는 활성화되어 있습니다. 인증서 갱신 dry-run과 갱신 후 Nginx 설정 검증·reload, HTTPS 헬스체크까지 통과했습니다. 기존 Vercel의 확인된 배포 URL 43개는 WAF로 차단한 상태로 보존하며, 이전 서비스로 요청이 돌아가 데이터가 갈라지지 않도록 합니다. 기존 자원 해지는 안정화 후 별도로 진행합니다.

배포는 백업 → 새 release 업로드 → 해당 release로 스키마 적용 → 로컬 기동 확인 → 링크 변경·서비스 재시작 → 헬스체크·기능 검증 순서로 진행합니다. 최종 이전 전에는 점검 응답을 유지합니다. Nginx 설정은 `nginx -t` 통과 후 reload하며, ACME 경로는 Nginx가 읽을 수 있어야 합니다.

서버의 root 셸에서 번들된 마이그레이션을 실행하는 예시입니다. `WorkingDirectory`는 검증할 실제 release 경로로 바꿉니다.

```sh
systemd-run --wait --pipe --collect \
  --uid=reach-rich \
  --property=WorkingDirectory=/opt/reach-rich/releases/RELEASE_ID \
  --property=EnvironmentFile=/etc/reach-rich/production.env \
  /usr/local/bin/node ops/migrate.cjs

systemctl status reach-rich --no-pager
journalctl -u reach-rich -n 100 --no-pager
curl --fail http://127.0.0.1:3106/api/health
nginx -t
```

전체 환경변수나 스냅샷 내용을 진단 로그에 출력하지 않습니다. 메모리 한도 초과나 DB 연결 부족이 발생하면 서비스 로그와 기존 서비스의 자원 사용량을 함께 확인합니다.

## 인증서 자동 갱신

기존 서버의 다른 서비스용 Certbot 타이머는 특정 인증서만 대상으로 하므로 이 앱에는 별도 `reach-rich-certbot-renew.timer`를 사용합니다. `ops/reach-rich-certbot-renew.service`와 타이머를 `/etc/systemd/system/`에, `ops/certbot-deploy.sh`를 root 소유 실행 파일 `/usr/local/sbin/reach-rich-certbot-deploy`로 설치합니다. 기존 서비스의 타이머는 변경하지 않습니다.

새 인증서를 발급하고 HTTPS 경로를 검증한 뒤 타이머를 활성화합니다. UTC 02:00·14:00부터 최대 1시간 내에 갱신 필요 여부를 확인하고, 실제 갱신 성공 시 이 앱의 인증서에 한해서 `nginx -t` 후 Nginx를 reload합니다. 아래 명령은 설치가 끝난 서버의 root 셸에서 실행합니다.

```sh
systemctl daemon-reload
/usr/local/bin/certbot renew --cert-name 36-reach-rich.jeongcheol.cloud \
  --dry-run --run-deploy-hooks \
  --deploy-hook /usr/local/sbin/reach-rich-certbot-deploy
systemctl enable --now reach-rich-certbot-renew.timer
systemctl list-timers reach-rich-certbot-renew.timer --all
journalctl -u reach-rich-certbot-renew.service -n 30 --no-pager
```

## 백업과 복구

`ops/backup.sh`는 PostgreSQL custom-format 덤프를 만든 뒤 암호화된 private S3 `backups/` 경로에 업로드하고 임시 파일을 지웁니다. `reach-rich-backup.timer`의 기본 시각은 UTC 18:00, 서울 다음 날 03:00이며 최대 5분의 지연이 있습니다. 기본 보관 정책은 30일입니다. S3 버전 관리를 사용하면 이전 버전의 만료 정책도 함께 설정해야 합니다.

최종 데이터 가져오기와 대조가 끝나면 첫 운영 백업을 실행하고, 성공을 확인한 뒤 타이머를 켭니다. `Persistent=true`이므로 이전 실행 시각을 놓쳤다면 활성화 직후 백업이 실행될 수 있습니다.

```sh
systemctl start reach-rich-backup.service
systemctl status reach-rich-backup.service --no-pager
systemctl enable --now reach-rich-backup.timer
systemctl list-timers reach-rich-backup.timer --all
journalctl -u reach-rich-backup.service -n 30 --no-pager
```

업로드 성공과 실제 복원 가능 여부는 별개입니다. 초기 전환과 중요한 DB 변경 후에는 별도 DB로 복원해 확인합니다. 아래는 서버의 root 셸에서 **새 복구 검증 DB**로 복원하는 예시입니다. `backup_key`는 백업 로그의 실제 키로 바꿉니다.

```sh
backup_key='backups/실제-백업-키.dump'
backup_file=$(mktemp /var/lib/reach-rich/restore-XXXXXXXX.dump)
chmod 600 "$backup_file"
aws s3 cp "s3://reach-rich-148617059023-apne2/$backup_key" "$backup_file" \
  --region ap-northeast-2 --only-show-errors
runuser -u postgres -- createdb --owner=reach_rich reach_rich_restore_test
runuser -u postgres -- pg_restore --exit-on-error --no-owner --no-acl \
  --role=reach_rich --dbname=reach_rich_restore_test < "$backup_file"
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d reach_rich_restore_test \
  -c 'SELECT name FROM schema_migrations ORDER BY name;' \
  -c 'SELECT count(*) AS members FROM members;' \
  -c 'SELECT count(*) AS ledger_entries FROM deposits;'
rm -f "$backup_file"
```

건수·멤버별 원장 합계·댓글 연결까지 백업 시점의 기준과 대조합니다. 복구 검증 DB는 확인 후 정리합니다. 실제 장애 복구는 사용자 쓰기를 멈추고 현재 상태를 추가 백업한 뒤, 검증한 복구 DB로 연결을 바꾸는 절차로 진행합니다. 최신 정기 백업 이후 변경은 별도 기록이 없으면 손실될 수 있습니다.

## 롤백

앱 코드만 되돌릴 때는 현재 DB 스키마와 호환되는 이전 release로 `current` 링크를 돌리고 서비스를 재시작합니다. 스키마 마이그레이션은 자동 역적용하지 않으며, 새 스키마와 이전 앱의 호환 여부를 먼저 확인합니다.

PostgreSQL에서 쓰기를 시작한 뒤 예전 Vercel/Redis 앱으로 주소만 되돌리면 데이터가 갈라집니다. 기존 Redis 앱 복귀가 필요하다면 양쪽 쓰기와 증권 토큰 발급을 멈추고 변경분을 먼저 정리해야 합니다. 기본 복구 경로는 PostgreSQL을 유지한 앱 release 롤백 또는 검증한 PostgreSQL 백업 복구입니다. 안정화가 끝나기 전에는 원본 스냅샷과 기존 서비스 설정을 보존합니다.
