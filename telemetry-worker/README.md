# tp-telemetry

token-panda 앱의 익명 사용 텔레메트리 수집 Worker (Cloudflare Workers + D1).

앱은 이미 시간당 GitHub 업데이트 체크를 한다. 그 **옆에서** fire-and-forget 핑을
이 Worker 로 한 발 더 보내서 활성 설치 수 / 리텐션 / 버전 분포를 측정한다.
업데이트 체크와는 별개 요청이라, 이 Worker 가 죽어도 앱 업데이트엔 영향이 없다.

## 무엇을 수집하나 (프라이버시)

보내는 것: **익명 UUID + 앱 버전 + OS** 세 개뿐.

- UUID 는 설치 시 1회 랜덤 생성(`crypto.randomUUID`), 어떤 개인정보와도 연결 안 됨
- **IP 는 저장하지 않음.** 국가코드만 Cloudflare 헤더에서 coarse 하게 파생
- 토큰/사용량/계정 등 앱 데이터는 **일절 안 보냄**
- 사용자는 `config.json` 의 `telemetryOptOut: true` 또는 `TP_TELEMETRY=0` 으로 끌 수 있음
- 클라가 엔드포인트 URL 을 모르면(미설정) 아무것도 안 나감 — fork/개발 기본 안전

## 배포 (한 번)

```bash
cd telemetry-worker
npm i -g wrangler            # 이미 있으면 생략
wrangler login

# 1) D1 DB 생성 → 출력된 database_id 를 wrangler.toml 에 붙여넣기
wrangler d1 create tp-telemetry

# 2) 스키마 적용 (원격)
wrangler d1 execute tp-telemetry --remote --file=./schema.sql

# 3) /stats 보호 토큰 설정 (임의의 긴 문자열)
wrangler secret put STATS_TOKEN

# 4) 배포
wrangler deploy
```

배포되면 URL 이 나온다: `https://tp-telemetry.<your-subdomain>.workers.dev`

## 앱에 연결

**프로덕션은 상수에 URL 을 박아야 한다.** 패키징된 앱은 `process.env` 를
사용자 PC 에서 *런타임* 에 읽으므로, 빌드 때 넣은 환경변수는 실행 시점에 없다.

`electron/telemetry.cjs`:

```js
const TELEMETRY_ENDPOINT =
  process.env.TP_TELEMETRY_ENDPOINT ||
  "https://tp-telemetry.<your-subdomain>.workers.dev/ping";  // ← 여기에 박기
```

`TP_TELEMETRY_ENDPOINT` 환경변수는 **개발 중 오버라이드** 용도(런타임에 읽힘):

```bash
TP_TELEMETRY_ENDPOINT="http://127.0.0.1:8787/ping" npm run electron:dev   # 로컬 wrangler dev 로 테스트
```

## 지표 보기

```bash
# 헤드라인 (총 설치 / DAU / WAU / MAU / 오늘 신규 / 버전·OS·국가 분포)
curl "https://tp-telemetry.<sub>.workers.dev/stats?token=$STATS_TOKEN"
```

### 리텐션 (데이터가 좀 쌓인 뒤 로컬에서)

cohort = 같은 날 처음 본 설치들. "그 다음날도 켰나"(D1), "1주 차에 한 번이라도
켰나"(W1) 를 본다. 초기엔 코호트가 작아서 노이즈가 크니 며칠 쌓고 보면 된다.

```bash
wrangler d1 execute tp-telemetry --remote --command "
SELECT
  i.first_seen AS cohort,
  COUNT(DISTINCT i.id) AS size,
  COUNT(DISTINCT CASE WHEN p.day = date(i.first_seen,'+1 day') THEN i.id END) AS d1,
  COUNT(DISTINCT CASE WHEN p.day BETWEEN date(i.first_seen,'+1 day')
                                     AND date(i.first_seen,'+7 days') THEN i.id END) AS w1,
  COUNT(DISTINCT CASE WHEN p.day BETWEEN date(i.first_seen,'+8 days')
                                     AND date(i.first_seen,'+30 days') THEN i.id END) AS w2_4
FROM installs i
LEFT JOIN pings_daily p ON p.id = i.id
GROUP BY i.first_seen
ORDER BY i.first_seen DESC;"
```

`w1 / size` 가 1주 리텐션. 데스크톱 펫 앱에서 이게 다운로드 수보다 훨씬 강한
품질 지표다(다운받고 일주일 뒤에도 켜놓고 쓰는 비율).

## 비용

Workers 무료 플랜 10만 req/일, D1 무료 5GB + 500만 행 읽기/일. 설치 수십~수백
규모에서 시간당 핑은 한참 안에 들어온다(예: 설치 100개 × 24핑 = 2,400 req/일).
