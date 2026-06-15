-- token-panda 익명 텔레메트리 스키마 (Cloudflare D1 / SQLite).
-- 시간당 핑이 와도 테이블이 안 붓도록 두 단으로 나눈다:
--   installs    : 설치별 현재 상태 1행 (마지막 ping 으로 upsert)
--   pings_daily : (설치, 날짜) 당 1행 — DAU/리텐션 시계열용. 하루 핑이 24번
--                 와도 INSERT OR IGNORE 라 1행만 남는다.

CREATE TABLE IF NOT EXISTS installs (
  id          TEXT PRIMARY KEY,   -- 익명 UUID (앱이 생성, PII 아님)
  first_seen  TEXT NOT NULL,      -- 최초 핑 날짜 YYYY-MM-DD
  last_seen   TEXT NOT NULL,      -- 최근 핑 날짜
  version     TEXT,               -- 현재 앱 버전
  os          TEXT,               -- darwin / win32
  country     TEXT,               -- CF 헤더 기반 국가코드(coarse). IP 는 저장 안 함
  ping_count  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pings_daily (
  id       TEXT NOT NULL,
  day      TEXT NOT NULL,         -- YYYY-MM-DD
  version  TEXT,
  os       TEXT,
  PRIMARY KEY (id, day)
);

CREATE INDEX IF NOT EXISTS idx_pings_day ON pings_daily(day);
CREATE INDEX IF NOT EXISTS idx_installs_first ON installs(first_seen);
