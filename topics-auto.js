// 추천 주제 TOP 5 — 무료 자동 갱신 (AI를 쓰지 않음, 추가 비용 없음)
//
// 점수 = ① 세무달력의 다가오는 기한(가까울수록 높음)
//      + ② 이 시기에 많이 찾는 세금 주제(월별)
//      + ③ 지역 뉴스 제목에 연결되는 세금 주제(무료 뉴스 검색)
//      - ④ 최근 30일 안에 이미 쓴 주제
// 같은 분류는 최대 2개, 지역 주제는 가능하면 1개 이상 넣습니다.

import { upcoming, weekday } from "./public/taxcal.js";

// ② 월별로 관심이 높은 주제 (기한과 별개로 찾는 사람이 많은 주제)
const SEASONAL = [
  { months: [10, 11, 12], title: "연말정산 미리보기로 13월의 월급 챙기기", keywords: ["연말정산 미리보기"], category: "생활 세금", angle: "남은 기간 카드 사용·연금저축 납입으로 공제를 늘리는 방법 위주", weight: 45 },
  { months: [11, 12], title: "연말 전에 챙기는 개인사업자 절세 체크리스트", keywords: ["개인사업자 절세"], category: "생활 세금", angle: "올해 안에 해야 효과가 있는 경비·공제 항목 위주", weight: 40 },
  { months: [11, 12], title: "연금저축·IRP 연말 납입 세액공제 한도 정리", keywords: ["연금저축 세액공제"], category: "생활 세금", angle: "한도와 납입 시기, 중도 해지 시 주의점", weight: 35 },
  { months: [12, 1], title: "새해 달라지는 세법 핵심 정리", keywords: ["세법 개정"], category: "세법 개정", angle: "개인·소상공인·농업인에게 영향이 큰 개정만 골라 시행일과 함께", weight: 45 },
  { months: [1, 2], title: "연말정산 자주 빠뜨리는 공제 항목", keywords: ["연말정산 공제"], category: "생활 세금", angle: "의료비·교육비·월세·기부금 중 간소화 자료에 안 나오는 것 위주", weight: 45 },
  { months: [1, 2], title: "부양가족 인적공제 중복·소득요건 실수 정리", keywords: ["부양가족 공제"], category: "생활 세금", angle: "맞벌이·형제 간 중복 공제와 소득 100만원 요건", weight: 35 },
  { months: [2, 3], title: "연말정산 환급금 언제 들어오나, 추가 납부가 나왔다면", keywords: ["연말정산 환급"], category: "생활 세금", angle: "환급 시기와 추가 납부 원인, 5월 경정청구 안내", weight: 30 },
  { months: [3, 4, 5], title: "프리랜서 3.3% 종합소득세 환급 받는 법", keywords: ["프리랜서 종합소득세"], category: "생활 세금", angle: "환급 대상 확인, 경비 인정 범위, 단순경비율과 장부", weight: 45 },
  { months: [4, 5], title: "주택 임대소득 신고 대상과 분리과세 선택", keywords: ["주택임대소득 신고"], category: "부동산·토지", angle: "주택 수·임대 수입 기준, 분리과세와 종합과세 비교", weight: 40 },
  { months: [4, 5], title: "5월 종합소득세 신고 전 경비 처리 체크리스트", keywords: ["종합소득세 경비"], category: "생활 세금", angle: "인정되는 경비와 증빙, 자주 틀리는 항목", weight: 40 },
  { months: [5, 6], title: "6월 1일 보유 기준, 재산세·종부세 기준일 정리", keywords: ["재산세 기준일"], category: "부동산·토지", angle: "매매 시점에 따라 누가 내는지, 잔금일 조정 시 주의점", weight: 40 },
  { months: [6, 7], title: "상반기 부가세 확정신고 전 매입세액 공제 점검", keywords: ["부가세 매입세액공제"], category: "생활 세금", angle: "공제되는 매입·안 되는 매입, 카드 매입 공제", weight: 35 },
  { months: [7, 8, 9], title: "근로장려금 지급일과 반기 신청 정리", keywords: ["근로장려금 지급일"], category: "생활 세금", angle: "정기·반기 지급 시기, 지급액이 줄어드는 경우", weight: 35 },
  { months: [8, 9], title: "추석 전후 가족 간 현금 증여, 세금 문제 없을까", keywords: ["가족 증여세"], category: "생활 세금", angle: "증여재산공제 한도, 용돈·생활비와 증여의 구분", weight: 30 },
  { months: [9, 10], title: "자녀 결혼·출산 증여재산공제 정리", keywords: ["혼인 출산 증여공제"], category: "생활 세금", angle: "공제 한도와 요건, 신고 방법", weight: 30 },
  { months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], title: "1세대 1주택 양도소득세 비과세 요건 정리", keywords: ["1세대1주택 비과세"], category: "부동산·토지", angle: "보유·거주 기간, 일시적 2주택, 고가주택 기준", weight: 25 },
  { months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], title: "사업자등록 전 알아야 할 간이·일반과세자 차이", keywords: ["간이과세자 일반과세자"], category: "생활 세금", angle: "매출 기준, 세금 계산 차이, 전환 시점", weight: 22 },
];

// ③ 지역 주제 — {지역}은 설정한 지역 이름으로 바뀝니다. news: 뉴스 제목에 이 단어가 있으면 점수 가산
const LOCAL = [
  { title: "{지역} 토지보상금 받을 때 양도소득세 감면 정리", keywords: ["토지보상 양도세"], category: "부동산·토지", angle: "공익사업 수용 감면(현금·채권 보상), 대토보상, 신고 시기", news: ["토지보상", "보상금", "수용", "보상 협의"], weight: 22 },
  { title: "{지역} 농지 팔 때 8년 자경 감면 요건", keywords: ["자경농지 감면"], category: "부동산·토지", angle: "재촌·자경 요건, 감면 한도, 다른 소득이 있는 경우", news: ["농지", "농업", "농민", "농가"], weight: 22 },
  { title: "{지역} 산업단지·공장 취득세 감면 체크", keywords: ["산업단지 취득세 감면"], category: "지역 이슈", angle: "산업단지 입주 기업의 취득세·재산세 감면 요건과 추징 사유", news: ["산업단지", "산단", "공장", "기업 유치", "반도체", "물류"], weight: 20 },
  { title: "{지역} 개발 소식, 부동산 사고팔 때 세금 미리 계산", keywords: ["부동산 양도세 계산"], category: "지역 이슈", angle: "개발 기대감으로 거래가 늘 때 취득세·양도세 기본 계산", news: ["개발", "재개발", "재건축", "역세권", "택지", "분양", "도시개발"], weight: 18 },
  { title: "{지역} 소상공인 지원금, 세금 신고 대상일까", keywords: ["지원금 과세"], category: "지역 이슈", angle: "지자체 지원금·보조금의 과세 여부와 장부 처리", news: ["지원금", "보조금", "소상공인", "지역화폐", "자영업"], weight: 18 },
  { title: "{지역} 창업 중소기업 세액감면 받는 법", keywords: ["창업중소기업 세액감면"], category: "지역 이슈", angle: "수도권 과밀억제권역 여부에 따른 감면율 차이, 업종 요건", news: ["창업", "청년 창업", "스타트업"], weight: 18 },
  { title: "{지역} 상가 임대사업자 세금 한 번에 정리", keywords: ["상가 임대 세금"], category: "부동산·토지", angle: "부가세·종합소득세·재산세, 임대료 인상 시 주의점", news: ["상가", "상권", "임대료", "공실"], weight: 15 },
];

const pad = (n) => String(n).padStart(2, "0");

const mdOf = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${weekday(d)})`;

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// 무료 뉴스 검색: 네이버 검색 API(키가 있으면) → 없으면 구글 뉴스 RSS
async function fetchNews(region, naver) {
  const short = region.replace(/(특별시|광역시|특별자치시|특별자치도|시|군|구)$/, "");
  const queries = [`${short} 세금`, `${short} 토지보상`, `${short} 개발`, `${short} 지원금`, `${short} 산업단지`];
  const items = [];
  const errors = [];
  for (const q of queries) {
    try {
      if (naver?.id && naver?.secret) {
        const res = await fetch(`${naver.newsUrl}?query=${encodeURIComponent(q)}&display=10&sort=date`, {
          headers: { "X-Naver-Client-Id": naver.id, "X-Naver-Client-Secret": naver.secret },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`네이버 뉴스 ${res.status}`);
        const data = await res.json();
        for (const it of data.items || []) {
          items.push({ title: stripTags(it.title), url: it.originallink || it.link, date: new Date(it.pubDate) });
        }
      } else {
        const url = `${naver?.rssUrl || "https://news.google.com/rss/search"}?q=${encodeURIComponent(`${q} when:60d`)}&hl=ko&gl=KR&ceid=KR:ko`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (blog-tool)" } });
        if (!res.ok) throw new Error(`뉴스 RSS ${res.status}`);
        const xml = await res.text();
        for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
          const get = (tag) => (m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
          items.push({ title: stripTags(decodeXml(get("title"))), url: decodeXml(get("link")).trim(), date: new Date(get("pubDate")) });
        }
      }
    } catch (err) {
      errors.push(err.message);
    }
  }
  const cutoff = Date.now() - 60 * 86400000;
  const seen = new Set();
  const news = items
    .filter((n) => n.title && n.title.includes(short) && !isNaN(n.date) && n.date.getTime() >= cutoff)
    .filter((n) => (seen.has(n.title) ? false : seen.add(n.title)))
    .sort((a, b) => b.date - a.date);
  return { news, error: news.length ? null : errors[0] || null };
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").trim();
}
function decodeXml(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export async function buildAutoTopics({ region, today, extraHolidays, posts, naver }) {
  const month = Number(today.slice(5, 7));
  const candidates = [];

  // ① 다가오는 기한
  for (const ev of upcoming(today, 60, extraHolidays)) {
    if (ev.level < 2) continue;
    const dueIn = daysBetween(today, ev.due);
    const startIn = ev.start ? daysBetween(today, ev.start) : null;
    let score = ev.level === 3 ? 55 : 38;
    let when;
    if (ev.start && startIn <= 0) {
      score += 30; // 지금 진행 중인 기간
      when = `지금 ${ev.name} 기간입니다(${mdOf(ev.due)}까지, D-${dueIn}).`;
    } else if (ev.start) {
      score += Math.max(0, 25 - startIn);
      when = `${mdOf(ev.start)}부터 ${ev.name} 기간이 시작됩니다(D-${startIn}, ${mdOf(ev.due)}까지).`;
    } else {
      score += Math.max(0, 32 - dueIn * 1.2);
      when = `${mdOf(ev.due)} ${ev.kind === "info" ? "예정" : "마감"}${ev.shifted ? "(휴일로 연장)" : ""}, D-${dueIn}.`;
    }
    candidates.push({
      title: ev.topic,
      keywords: [ev.name.replace(/\(.*?\)/g, "").replace(/·/g, " ").split(" ").slice(0, 2).join(" ")],
      category: "신고·납부 기한",
      reason: `${when} 기한이 다가오면 대상 여부·준비서류 검색이 늘어납니다.`,
      angle: `대상(${ev.who}), 기한, 준비서류, 놓치면 생기는 가산세 순서로`,
      score,
      basis: "세무달력",
    });
  }

  // ② 시기별 주제
  for (const s of SEASONAL) {
    if (!s.months.includes(month)) continue;
    candidates.push({ title: s.title, keywords: s.keywords, category: s.category, reason: `${month}월 전후로 많이 찾는 주제입니다.`, angle: s.angle, score: s.weight, basis: "시기별 주제" });
  }

  // ③ 지역 주제 + 뉴스
  const { news, error: newsError } = await fetchNews(region, naver);
  const sources = [];
  for (const l of LOCAL) {
    const hit = news.find((n) => l.news.some((w) => n.title.includes(w)));
    const c = {
      title: l.title.replace("{지역}", region),
      keywords: l.keywords,
      category: l.category,
      reason: hit
        ? `최근 지역 뉴스: "${hit.title}" (${hit.date.getMonth() + 1}/${hit.date.getDate()}). 관련 세금 질문이 늘 수 있습니다.`
        : `${region} 지역 특성상 꾸준히 찾는 주제입니다.`,
      angle: l.angle,
      score: l.weight + (hit ? 45 : 0),
      basis: hit ? "지역 뉴스" : "지역 주제",
      local: true,
    };
    if (hit) sources.push({ title: hit.title, url: hit.url });
    candidates.push(c);
  }

  // ④ 최근 30일 안에 쓴 주제는 내리기
  const recent = posts.filter((p) => daysBetween(p.updatedAt.slice(0, 10), today) <= 30);
  for (const c of candidates) {
    const key = c.keywords[0].replace(/\s/g, "");
    if (recent.some((p) => `${p.title}${p.topic}`.replace(/\s/g, "").includes(key))) {
      c.score -= 35;
      c.reason += " (최근 30일 안에 비슷한 글을 쓰셨습니다)";
    }
    c.score += Math.random() * 6; // 같은 점수대 주제는 누를 때마다 조금씩 바뀌도록
  }

  // 고르기: 점수순, 분류당 최대 2개, 지역 주제 최소 1개, 같은 제목 중복 제거
  candidates.sort((a, b) => b.score - a.score);
  const picked = [];
  const perCat = {};
  const titles = new Set();
  for (const c of candidates) {
    if (picked.length >= 5) break;
    if (titles.has(c.title) || (perCat[c.category] || 0) >= 2) continue;
    picked.push(c);
    titles.add(c.title);
    perCat[c.category] = (perCat[c.category] || 0) + 1;
  }
  if (!picked.some((c) => c.local)) {
    const bestLocal = candidates.find((c) => c.local && !titles.has(c.title));
    if (bestLocal) picked[picked.length - 1] = bestLocal;
  }
  picked.sort((a, b) => b.score - a.score);

  const max = Math.max(...picked.map((c) => c.score), 1);
  const topics = picked.map((c, i) => ({
    rank: i + 1,
    title: c.title,
    keywords: c.keywords,
    category: c.category,
    reason: c.reason,
    angle: c.angle,
    interest: Math.max(5, Math.min(100, Math.round((c.score / max) * 95))),
    basis: c.basis,
  }));
  // newsCount: 세금 주제와 연결된 지역 뉴스 수 (관련 없는 기사는 세지 않음)
  return { topics, sources: sources.slice(0, 10), newsCount: sources.length, newsScanned: news.length, newsError };
}
