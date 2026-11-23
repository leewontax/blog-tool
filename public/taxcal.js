// 세무달력 — 신고·납부 일정 계산 (화면과 서버가 함께 사용)
//
// ⚠ 이 파일의 날짜 규칙은 매년 바뀔 수 있습니다. 새해가 되면 국세청 세무일정
//   (https://www.nts.go.kr → 국세정보 → 세무일정)과 위택스 지방세 일정을 확인해 주세요.
//
// 기한 연장 원칙: 신고·납부 기한이 토요일·일요일·공휴일·근로자의 날(노동절)이면 그다음 날로 연장
//   - 국세: 국세기본법 제5조
//   - 지방세: 지방세기본법 제24조

// ───────── 공휴일 (관공서 공휴일, 대체공휴일 포함) ─────────
// 출처: 우주항공청 월력요항 보도(2026.6.29, 2027년도), 인사혁신처 '노동절·제헌절 공휴일' 발표(2026.4)
// ⚠ 임시공휴일·선거일은 앱의 '휴일 추가'로 직접 넣어 주세요.
export const HOLIDAYS = {
  2026: {
    "01-01": "신정",
    "02-16": "설날 연휴", "02-17": "설날", "02-18": "설날 연휴",
    "03-01": "삼일절", "03-02": "대체공휴일(삼일절)",
    "05-01": "노동절",
    "05-05": "어린이날",
    "05-24": "부처님오신날", "05-25": "대체공휴일(부처님오신날)",
    "06-03": "전국동시지방선거",
    "06-06": "현충일",
    "07-17": "제헌절",
    "08-15": "광복절", "08-17": "대체공휴일(광복절)",
    "09-24": "추석 연휴", "09-25": "추석", "09-26": "추석 연휴",
    "10-03": "개천절", "10-05": "대체공휴일(개천절)",
    "10-09": "한글날",
    "12-25": "성탄절",
  },
  2027: {
    "01-01": "신정",
    "02-06": "설날 연휴", "02-07": "설날", "02-08": "설날 연휴", "02-09": "대체공휴일(설날)",
    "03-01": "삼일절",
    "05-01": "노동절", "05-03": "대체공휴일(노동절)",
    "05-05": "어린이날",
    "05-13": "부처님오신날",
    "06-06": "현충일",
    "07-17": "제헌절", "07-19": "대체공휴일(제헌절)",
    "08-15": "광복절", "08-16": "대체공휴일(광복절)",
    "09-14": "추석 연휴", "09-15": "추석", "09-16": "추석 연휴",
    "10-03": "개천절", "10-04": "대체공휴일(개천절)",
    "10-09": "한글날", "10-11": "대체공휴일(한글날)",
    "12-25": "성탄절", "12-27": "대체공휴일(성탄절)",
  },
};

// ───────── 세무 일정 규칙 ─────────
// kind: "deadline"(기한) | "period"(기간: start~end) | "info"(안내)
// scope: "국세" | "지방세" | "신청·안내"
// level: 3=핵심(글 추천 2번), 2=보통(글 추천 1번), 1=참고(추천 없음)
// day: 숫자 또는 "last"(말일)
// check: true면 화면에 '확인 필요' 표시
export const TAX_RULES = [
  // 매월
  { id: "withholding", name: "원천세 신고·납부", scope: "국세", kind: "deadline", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], day: 10, level: 1,
    who: "원천징수의무자(직원 급여·사업소득 등을 지급한 사업자), 전월 지급분", basis: "소득세법 제128조",
    topic: "원천세 신고·납부 기한과 지방소득세 특별징수 함께 챙기기" },

  // 1월
  { id: "vat-2-final", name: "부가가치세 2기 확정신고·납부", scope: "국세", kind: "deadline", month: 1, day: 25, level: 3,
    who: "개인·법인 일반과세자(7~12월분), 간이과세자(1~12월분)", basis: "부가가치세법 제49조·제67조",
    topic: "부가가치세 2기 확정신고 기간과 준비서류, 놓치기 쉬운 공제" },
  { id: "car-annual", name: "자동차세 연세액 신고납부(연납)", scope: "지방세", kind: "period", month: 1, startDay: 16, day: 31, level: 2, check: true,
    who: "자동차 소유자(1년치를 미리 내면 일부 공제)", basis: "지방세법 제128조",
    topic: "자동차세 연납 신청 기간과 공제율" },
  { id: "license-tax", name: "등록면허세(면허분) 납부", scope: "지방세", kind: "period", month: 1, startDay: 16, day: 31, level: 1,
    who: "면허 보유 사업자", basis: "지방세법 제35조", topic: "등록면허세(면허분) 고지서 확인과 납부" },
  { id: "yearend-open", name: "연말정산 간소화 자료 제공 시작(예정)", scope: "신청·안내", kind: "info", month: 1, day: 15, level: 3, check: true,
    who: "근로소득자·회사 담당자", basis: "국세청 안내(매년 1월 중순 개통)",
    topic: "연말정산 간소화 서비스 이용 방법과 자주 빠뜨리는 공제" },

  // 2월
  { id: "biz-status", name: "면세사업자 사업장현황신고", scope: "국세", kind: "deadline", month: 2, day: 10, level: 2,
    who: "부가가치세 면세 개인사업자(병의원·학원·농축수산물 판매 등)", basis: "소득세법 제78조",
    topic: "면세사업자 사업장현황신고 기한과 수입금액 신고 방법" },
  { id: "pay-stmt-other", name: "지급명세서 제출(이자·배당·기타소득 등)", scope: "국세", kind: "deadline", month: 2, day: "last", level: 1,
    who: "이자·배당·기타소득 지급자", basis: "소득세법 제164조", topic: "지급명세서 제출 기한과 미제출 가산세" },

  // 3월
  { id: "yearend-file", name: "연말정산 원천세 신고·근로소득 지급명세서 제출", scope: "국세", kind: "deadline", month: 3, day: 10, level: 2,
    who: "근로자를 고용한 사업자", basis: "소득세법 제128조·제164조",
    topic: "연말정산 결과 신고와 지급명세서 제출, 환급·추가납부 처리" },
  { id: "eitc-half-2", name: "근로장려금 반기 신청(하반기 소득분)", scope: "신청·안내", kind: "period", month: 3, startDay: 1, day: 15, level: 2, check: true,
    who: "근로소득만 있는 가구 중 요건 충족자", basis: "조세특례제한법 제100조의6",
    topic: "근로장려금 반기 신청 대상과 신청 방법" },
  { id: "corp-tax", name: "법인세 신고·납부(12월 결산)", scope: "국세", kind: "deadline", month: 3, day: 31, level: 3,
    who: "12월 결산 법인(성실신고확인 대상 법인은 4월 30일)", basis: "법인세법 제60조",
    topic: "12월 결산 법인세 신고 준비서류와 자주 틀리는 세무조정" },

  // 4월
  { id: "vat-1-prelim", name: "부가가치세 1기 예정신고·납부", scope: "국세", kind: "deadline", month: 4, day: 25, level: 2,
    who: "법인사업자(예정신고), 개인사업자(예정고지 납부)", basis: "부가가치세법 제48조",
    topic: "부가가치세 1기 예정신고와 개인사업자 예정고지" },
  { id: "corp-tax-sincere", name: "법인세 신고·납부(성실신고확인 법인)", scope: "국세", kind: "deadline", month: 4, day: 30, level: 1,
    who: "성실신고확인 대상 12월 결산 법인", basis: "법인세법 제60조", topic: "성실신고확인 대상 법인의 법인세 신고" },
  { id: "corp-local", name: "법인지방소득세 신고·납부(12월 결산)", scope: "지방세", kind: "deadline", month: 4, day: 30, level: 2,
    who: "12월 결산 법인", basis: "지방세법 제103조의23",
    topic: "법인지방소득세 별도 신고 잊지 않기" },

  // 5월
  { id: "income-tax", name: "종합소득세·개인지방소득세 확정신고·납부", scope: "국세", kind: "period", month: 5, startDay: 1, day: 31, level: 3,
    who: "사업·임대·프리랜서·기타소득 등 종합소득이 있는 개인(성실신고확인 대상은 6월 30일)", basis: "소득세법 제70조",
    topic: "종합소득세 신고 대상, 준비서류, 경비 처리와 놓치기 쉬운 공제" },
  { id: "eitc-regular", name: "근로·자녀장려금 정기 신청", scope: "신청·안내", kind: "period", month: 5, startDay: 1, day: 31, level: 3,
    who: "소득·재산 요건을 충족하는 근로·사업·종교인소득 가구", basis: "조세특례제한법 제100조의6·제100조의29",
    topic: "근로·자녀장려금 신청 요건과 지급 시기" },

  // 6월
  { id: "income-tax-sincere", name: "종합소득세 신고·납부(성실신고확인 대상)", scope: "국세", kind: "deadline", month: 6, day: 30, level: 2,
    who: "업종별 수입금액 기준 이상 개인사업자", basis: "소득세법 제70조의2",
    topic: "성실신고확인 대상자 기준과 확인비용 세액공제" },
  { id: "foreign-account", name: "해외금융계좌 신고", scope: "국세", kind: "deadline", month: 6, day: 30, level: 1,
    who: "해외금융계좌 잔액 합계가 매월 말일 중 하루라도 5억 원 초과인 거주자·내국법인", basis: "국제조세조정에 관한 법률 제53조",
    topic: "해외금융계좌 신고 대상과 미신고 과태료" },
  { id: "car-1", name: "자동차세 1기분 납부", scope: "지방세", kind: "period", month: 6, startDay: 16, day: 30, level: 1,
    who: "자동차 소유자", basis: "지방세법 제128조", topic: "자동차세 1기분 납부와 연납 비교" },

  // 7월
  { id: "vat-1-final", name: "부가가치세 1기 확정신고·납부", scope: "국세", kind: "deadline", month: 7, day: 25, level: 3,
    who: "개인·법인 일반과세자(1~6월분)", basis: "부가가치세법 제49조",
    topic: "부가가치세 1기 확정신고 기간과 매입세액 공제 체크리스트" },
  { id: "property-1", name: "재산세 납부(주택 1/2·건축물)", scope: "지방세", kind: "period", month: 7, startDay: 16, day: 31, level: 2,
    who: "6월 1일 기준 주택·건축물 소유자", basis: "지방세법 제115조",
    topic: "7월 재산세 고지서 보는 법과 6월 1일 기준일" },

  // 8월
  { id: "corp-interim", name: "법인세 중간예납(12월 결산)", scope: "국세", kind: "deadline", month: 8, day: 31, level: 2,
    who: "12월 결산 법인(중소기업 등 일부 제외 기준 있음)", basis: "법인세법 제63조",
    topic: "법인세 중간예납 대상과 계산 방법" },
  { id: "resident-biz", name: "주민세(사업소분) 신고·납부", scope: "지방세", kind: "period", month: 8, startDay: 1, day: 31, level: 1,
    who: "7월 1일 기준 사업소를 둔 사업주", basis: "지방세법 제83조", topic: "주민세 사업소분 신고 대상과 세액" },
  { id: "resident-ind", name: "주민세(개인분) 납부", scope: "지방세", kind: "period", month: 8, startDay: 16, day: 31, level: 1,
    who: "7월 1일 기준 세대주 등", basis: "지방세법 제79조", topic: "주민세 개인분 고지서 확인" },

  // 9월
  { id: "eitc-half-1", name: "근로장려금 반기 신청(상반기 소득분)", scope: "신청·안내", kind: "period", month: 9, startDay: 1, day: 15, level: 2, check: true,
    who: "근로소득만 있는 가구 중 요건 충족자", basis: "조세특례제한법 제100조의6",
    topic: "근로장려금 상반기분 반기 신청 방법" },
  { id: "property-2", name: "재산세 납부(주택 1/2·토지)", scope: "지방세", kind: "period", month: 9, startDay: 16, day: 30, level: 2,
    who: "6월 1일 기준 주택·토지 소유자", basis: "지방세법 제115조",
    topic: "9월 재산세(토지) 납부와 분납 방법" },

  // 10월
  { id: "vat-2-prelim", name: "부가가치세 2기 예정신고·납부", scope: "국세", kind: "deadline", month: 10, day: 25, level: 2,
    who: "법인사업자(예정신고), 개인사업자(예정고지 납부)", basis: "부가가치세법 제48조",
    topic: "부가가치세 2기 예정신고와 예정고지" },

  // 11월
  { id: "income-interim", name: "종합소득세 중간예납 납부", scope: "국세", kind: "deadline", month: 11, day: 30, level: 2,
    who: "전년도 종합소득세 납부 이력이 있는 개인사업자(고지 납부)", basis: "소득세법 제65조",
    topic: "종합소득세 중간예납 고지서와 추계액 신고" },

  // 12월
  { id: "comprehensive-property", name: "종합부동산세 납부", scope: "국세", kind: "period", month: 12, startDay: 1, day: 15, level: 3,
    who: "6월 1일 기준 주택·토지 공시가격 합계가 공제액 초과인 소유자", basis: "종합부동산세법 제16조",
    topic: "종합부동산세 고지서 확인과 분납·합산배제 신고" },
  { id: "car-2", name: "자동차세 2기분 납부", scope: "지방세", kind: "period", month: 12, startDay: 16, day: 31, level: 1,
    who: "자동차 소유자", basis: "지방세법 제128조", topic: "자동차세 2기분 납부와 다음 해 연납" },
];

// ───────── 날짜 계산 ─────────

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
export const weekday = (s) => WEEK[parse(s).getDay()];

export function hasHolidayData(year) {
  return Boolean(HOLIDAYS[year]);
}

// extra: { "2026-12-31": "임시공휴일" } 처럼 사용자가 추가한 휴일
export function holidayName(dateStr, extra = {}) {
  if (extra[dateStr]) return extra[dateStr];
  const [y, m, d] = dateStr.split("-");
  if (`${m}-${d}` === "05-01") return HOLIDAYS[y]?.["05-01"] || "근로자의 날";
  return HOLIDAYS[y]?.[`${m}-${d}`] || "";
}

export function isOffDay(dateStr, extra = {}) {
  const dow = parse(dateStr).getDay();
  return dow === 0 || dow === 6 || Boolean(holidayName(dateStr, extra));
}

// 기한이 쉬는 날이면 다음 날로
export function shiftDeadline(dateStr, extra = {}) {
  let d = parse(dateStr);
  while (isOffDay(ymd(d), extra)) d = addDays(d, 1);
  return ymd(d);
}

// 글 추천일이 쉬는 날이면 앞 평일로
function prevWorkday(dateStr, extra = {}) {
  let d = parse(dateStr);
  while (isOffDay(ymd(d), extra)) d = addDays(d, -1);
  return ymd(d);
}

function dayOf(year, month, day) {
  if (day === "last") return ymd(new Date(year, month, 0));
  return `${year}-${pad(month)}-${pad(day)}`;
}

// 한 해의 일정 목록
export function eventsForYear(year, extra = {}) {
  const out = [];
  for (const r of TAX_RULES) {
    const months = r.months || [r.month];
    for (const m of months) {
      const legal = dayOf(year, m, r.day);
      const due = r.kind === "info" ? legal : shiftDeadline(legal, extra);
      const start = r.kind === "period" ? dayOf(year, m, r.startDay) : null;
      out.push({
        key: `${r.id}-${year}-${pad(m)}`,
        ruleId: r.id,
        name: months.length > 1 ? `${r.name}(${m - 1 || 12}월 지급분)` : r.name,
        scope: r.scope,
        kind: r.kind,
        level: r.level,
        check: Boolean(r.check) || !hasHolidayData(year),
        who: r.who,
        basis: r.basis,
        topic: r.topic,
        start,
        legal, // 법정 기한(말일 등 원래 날짜)
        due, // 휴일 연장 반영 기한
        shifted: legal !== due,
      });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

// 블로그 글 추천일: 핵심 일정은 2번(안내 글 + 마감 임박 글), 보통 일정은 1번(안내 글)
export function postIdeas(ev, extra = {}) {
  if (ev.level < 2) return [];
  const ideas = [];
  if (ev.kind === "info") {
    ideas.push({ date: prevWorkday(ymd(addDays(parse(ev.due), -10)), extra), type: "안내", title: `${ev.name} 전 미리 준비할 것`, why: "개통 약 10일 전: 미리 준비하려는 사람들의 검색이 늘어나는 시점" });
    ideas.push({ date: ev.due, type: "당일", title: `${ev.name.replace(/\(예정\)/, "")} — 이용 방법`, why: "개통 당일: 이용 방법 검색이 가장 몰리는 시점 (개통일은 매년 확인 필요)" });
    return ideas;
  }
  const base = ev.kind === "period" ? ev.start : ev.due;
  const first = prevWorkday(ymd(addDays(parse(base), ev.kind === "period" ? -10 : -14)), extra);
  ideas.push({ date: first, type: "안내", title: `${ev.name} 미리 안내`, why: ev.kind === "period" ? "기간 시작 약 10일 전: 미리 준비하는 사람들의 검색이 늘어나는 시점" : "기한 약 2주 전: 준비 서류·대상 여부를 찾아보기 시작하는 시점" });
  if (ev.level >= 3) {
    const remind = prevWorkday(ymd(addDays(parse(ev.due), -5)), extra);
    ideas.push({ date: remind, type: "마감 임박", title: `${ev.name} 마감 임박 체크리스트`, why: "기한 약 5일 전: 마감을 앞두고 검색이 가장 몰리는 시점" });
  }
  return ideas;
}

// 오늘부터 n일 안의 일정 (서버의 추천 주제 요청문에도 사용)
export function upcoming(fromStr, days, extra = {}) {
  const from = parse(fromStr);
  const to = ymd(addDays(from, days));
  const years = [from.getFullYear(), parse(to).getFullYear()];
  const list = [...new Set(years)].flatMap((y) => eventsForYear(y, extra));
  return list.filter((e) => e.due >= fromStr && (e.start || e.due) <= to);
}
