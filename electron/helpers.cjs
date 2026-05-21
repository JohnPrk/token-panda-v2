// main.cjs 에서 추출한 순수 함수들. require 만으로 side effect (app.setName,
// app.requestSingleInstanceLock) 가 실행되는 main.cjs 와 분리해서 node 환경에서
// 단위 테스트 가능하게 한다.

// claude.ai 의 usage 호출이 401/403/404 로 떨어지면 쿠키 만료(또는 wrong org)
// 로 보고 설정창을 한 번 띄우는 트리거. 본문 매칭 — fetchUsage 가 만들어주는
// "HTTP {status} — ..." 포맷에 의존. 다른 5xx/네트워크 에러는 일시적이므로
// false (재시도 사이클에 맡김).
function isAuthFailure(msg) {
  if (!msg) return false;
  return msg.indexOf("HTTP 401") >= 0 || msg.indexOf("HTTP 403") >= 0 || msg.indexOf("HTTP 404") >= 0;
}

// 트레이 헤더에 들어가는 업데이트 폴링 상태 라벨. lastUpdateCheck 가 null
// 이면 "대기 중", 성공이면 새 버전 유무에 따라 "🆕 v.. 있음" / "최신",
// 실패면 "확인 실패". 모든 경우 마지막 시도 HH:MM 을 끝에 붙여 사용자가
// 트레이 클릭 → 시각 갱신이 시각적 동작 확인 신호가 되게 한다.
function formatUpdateCheckLabel(lastUpdateCheck, updateInfo) {
  if (!lastUpdateCheck) return "업데이트 확인 대기 중…";
  const d = lastUpdateCheck.at;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (lastUpdateCheck.ok) {
    return updateInfo
      ? `🆕 v${updateInfo.latest_version} 있음 · ${hh}:${mm} 확인`
      : `최신 · ${hh}:${mm} 확인`;
  }
  return `확인 실패 · ${hh}:${mm} 시도`;
}

module.exports = { isAuthFailure, formatUpdateCheckLabel };
