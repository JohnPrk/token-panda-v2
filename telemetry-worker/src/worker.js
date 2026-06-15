// token-panda 익명 텔레메트리 Worker.
//   POST /ping   설치 앱이 시간당 보내는 핑을 D1 에 기록 → 204
//   GET  /stats  집계 대시보드 JSON (STATS_TOKEN 필요)
//   GET  /health 헬스체크
//
// 설계 메모: 클라(electron/telemetry.cjs)는 {id, v, os} 만 보낸다. 국가는 여기서
// CF 헤더로만 파생하고 IP 는 절대 저장하지 않는다. 핑은 fire-and-forget 라
// 응답 본문이 필요 없어 204 로 빠르게 닫는다.

const MAX = { id: 64, v: 32, os: 16 };

function clampStr(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

async function handlePing(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 204 }); // 깨진 body 는 조용히 무시
  }
  const id = clampStr(payload && payload.id, MAX.id);
  if (id.length < 8) return new Response(null, { status: 204 }); // 잘못된 id 무시
  const v = clampStr(payload && payload.v, MAX.v);
  const os = clampStr(payload && payload.os, MAX.os);
  const country =
    (request.cf && request.cf.country) ||
    request.headers.get("CF-IPCountry") ||
    null;
  const day = today();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO installs (id, first_seen, last_seen, version, os, country, ping_count)
         VALUES (?1, ?2, ?2, ?3, ?4, ?5, 1)
         ON CONFLICT(id) DO UPDATE SET
           last_seen  = ?2,
           version    = ?3,
           os         = ?4,
           country    = COALESCE(?5, country),
           ping_count = ping_count + 1`,
      ).bind(id, day, v, os, country),
      env.DB.prepare(
        `INSERT OR IGNORE INTO pings_daily (id, day, version, os)
         VALUES (?1, ?2, ?3, ?4)`,
      ).bind(id, day, v, os),
    ]);
  } catch (e) {
    // 로깅 실패가 클라에 영향 주지 않도록 그래도 204. (서버 로그로만 남김)
    console.error("ping insert failed:", e && e.message ? e.message : e);
  }
  return new Response(null, { status: 204 });
}

async function handleStats(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ||
    (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.STATS_TOKEN || token !== env.STATS_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  const d = today();
  const q = (sql, ...binds) => env.DB.prepare(sql).bind(...binds);

  const [total, dau, wau, mau, newToday, byVersion, byOs, byCountry] =
    await env.DB.batch([
      q(`SELECT COUNT(*) AS n FROM installs`),
      q(`SELECT COUNT(*) AS n FROM pings_daily WHERE day = ?1`, d),
      q(`SELECT COUNT(DISTINCT id) AS n FROM pings_daily WHERE day >= date(?1,'-6 days')`, d),
      q(`SELECT COUNT(DISTINCT id) AS n FROM pings_daily WHERE day >= date(?1,'-29 days')`, d),
      q(`SELECT COUNT(*) AS n FROM installs WHERE first_seen = ?1`, d),
      q(`SELECT version, COUNT(*) AS n FROM installs GROUP BY version ORDER BY n DESC`),
      q(`SELECT os, COUNT(*) AS n FROM installs GROUP BY os ORDER BY n DESC`),
      q(`SELECT country, COUNT(*) AS n FROM installs GROUP BY country ORDER BY n DESC`),
    ]);

  const n = (r) => (r.results && r.results[0] ? r.results[0].n : 0);
  return json({
    generated_at: new Date().toISOString(),
    total_installs: n(total),
    active: { dau: n(dau), wau: n(wau), mau: n(mau) },
    new_installs_today: n(newToday),
    by_version: byVersion.results,
    by_os: byOs.results,
    by_country: byCountry.results,
  });
}

// GET / 또는 /dashboard 에서 보여주는 단일 파일 대시보드. 토큰은 ?token= 으로
// 받거나(브라우저 sessionStorage 에 기억) 입력창에서 받아 /stats 를 호출한다.
// 외부 라이브러리 0개 — fetch + 막대. 내부에 백틱/${} 안 씀(바깥 템플릿과 충돌 방지).
function dashboardHtml() {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>token-panda · telemetry</title>
<style>
  :root{--bg:#0f1115;--card:#171a21;--line:#262a33;--fg:#e8eaed;--mut:#8b919e;--accent:#46b3a8}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .wrap{max-width:880px;margin:0 auto;padding:28px 20px 60px}
  h1{font-size:18px;margin:0 0 2px}
  .sub{color:var(--mut);font-size:12px;margin-bottom:22px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:26px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .card .n{font-size:28px;font-weight:700}
  .card .l{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
  .sec{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:14px}
  .sec h2{font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em;margin:0 0 12px}
  .row{display:flex;align-items:center;gap:10px;margin:6px 0}
  .row .k{width:130px;flex:none}
  .row .barwrap{flex:1;background:var(--bg);border-radius:6px;overflow:hidden;height:18px}
  .row .bar{height:100%;background:var(--accent)}
  .row .v{width:42px;text-align:right;color:var(--mut);flex:none}
  .gate{max-width:340px;margin:60px auto;text-align:center}
  .gate input{width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);margin:10px 0}
  .gate button{padding:10px 18px;border-radius:8px;border:0;background:var(--accent);color:#06231f;font-weight:600;cursor:pointer}
  .err{color:#e26d6d}
</style></head>
<body><div class="wrap" id="app"><p class="sub">불러오는 중…</p></div>
<script>
  var P = new URLSearchParams(location.search);
  var token = P.get('token') || sessionStorage.getItem('tp_token') || '';
  var app = document.getElementById('app');
  function esc(s){var d=document.createElement('div');d.textContent=(s==null?'':String(s));return d.innerHTML;}
  function gate(msg){
    app.innerHTML='<div class="gate"><h1>🐼 token-panda telemetry</h1>'+
      (msg?'<p class="err">'+esc(msg)+'</p>':'<p class="sub">STATS_TOKEN 을 입력하세요</p>')+
      '<input id="tk" type="password" placeholder="STATS_TOKEN"><br>'+
      '<button onclick="save()">보기</button></div>';
  }
  function save(){var v=document.getElementById('tk').value.trim();if(!v)return;
    sessionStorage.setItem('tp_token',v);location.search='?token='+encodeURIComponent(v);}
  function card(n,l){return '<div class="card"><div class="n">'+esc(n)+'</div><div class="l">'+esc(l)+'</div></div>';}
  function bars(title,rows,key){
    rows=rows||[];var max=1;rows.forEach(function(r){if(r.n>max)max=r.n;});
    var h='<div class="sec"><h2>'+esc(title)+'</h2>';
    if(!rows.length)h+='<p class="sub">데이터 없음</p>';
    rows.forEach(function(r){var k=r[key];if(k==null||k==='')k='(미상)';
      var w=Math.round(r.n/max*100);
      h+='<div class="row"><div class="k">'+esc(k)+'</div><div class="barwrap"><div class="bar" style="width:'+w+'%"></div></div><div class="v">'+esc(r.n)+'</div></div>';});
    return h+'</div>';
  }
  function render(d){var a=d.active||{};
    app.innerHTML='<h1>🐼 token-panda telemetry</h1><div class="sub">갱신 '+esc(d.generated_at)+' · 60초마다 자동</div>'+
      '<div class="cards">'+card(d.total_installs,'총 설치')+card(a.dau,'DAU')+card(a.wau,'WAU')+card(a.mau,'MAU')+card(d.new_installs_today,'오늘 신규')+'</div>'+
      bars('버전 분포',d.by_version,'version')+bars('OS',d.by_os,'os')+bars('국가',d.by_country,'country');
  }
  function load(){if(!token){gate();return;}
    fetch('/stats?token='+encodeURIComponent(token))
      .then(function(r){if(r.status===401){sessionStorage.removeItem('tp_token');gate('토큰이 틀렸어요');throw new Error('401');}return r.json();})
      .then(render)
      .catch(function(e){if(e.message!=='401')app.innerHTML='<p class="err">불러오기 실패: '+esc(e.message)+'</p>';});
  }
  load();setInterval(function(){if(token)load();},60000);
</script></body></html>`;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/ping") return handlePing(request, env);
    if (request.method === "GET" && pathname === "/stats") return handleStats(request, env);
    if (request.method === "GET" && (pathname === "/" || pathname === "/dashboard")) {
      return new Response(dashboardHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (pathname === "/health") return json({ ok: true });
    return new Response("not found", { status: 404 });
  },
};
