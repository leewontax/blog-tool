// 블로그 글 작성 도우미 — 화면 동작
import { eventsForYear, postIdeas, holidayName, hasHolidayData, weekday, ymd } from "./taxcal.js";
const $ = (id) => document.getElementById(id);
const NAVER_WRITE_URL = "https://blog.naver.com/GoBlogWrite.naver";
const STATUS_LABEL = { draft: "초안", scheduled: "발행 예정", published: "발행 완료" };

let mode = "copy"; // "copy": 요청문 복사 방식(추가 비용 없음) · "api": API 키로 바로 작성
const CLAUDE_URL = "https://claude.ai/new";
const CHATGPT_URL = "https://chatgpt.com/";
let currentReview = null; // 2차 검증 결과
let currentId = null; // 지금 편집 중인 글의 id (새 글이면 null)
let dirty = false;
let templates = [];
let posts = [];

// ───────────── 공통 ─────────────

function toast(msg, ms = 2200) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), ms);
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ───────────── 간단한 마크다운 → 네이버용 HTML ─────────────
// 네이버 에디터는 외부 CSS를 무시하므로 스타일을 태그에 직접 넣습니다.

const S = {
  h2: "font-size:20px;font-weight:bold;margin:28px 0 10px;",
  h3: "font-size:17px;font-weight:bold;margin:20px 0 8px;",
  p: "font-size:16px;line-height:1.8;margin:0 0 14px;",
  li: "font-size:16px;line-height:1.8;",
  table: "border-collapse:collapse;margin:10px 0 16px;",
  th: "border:1px solid #bbb;padding:6px 10px;background:#f3f5f4;font-weight:bold;",
  td: "border:1px solid #bbb;padding:6px 10px;",
  mark: "background:#fff1b8;",
};

function inline(text, forCopy) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  s = forCopy ? s.replace(/\s*\[확인 필요\]/g, "") : s.replace(/\[확인 필요\]/g, "<mark>[확인 필요]</mark>");
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return s;
}

function markdownToHtml(md, forCopy = false) {
  const st = (k) => (forCopy ? ` style="${S[k]}"` : "");
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^###\s+(.*)/))) { out.push(`<h3${st("h3")}>${inline(m[1], forCopy)}</h3>`); i++; continue; }
    if ((m = line.match(/^#{1,2}\s+(.*)/))) { out.push(`<h2${st("h2")}>${inline(m[1], forCopy)}</h2>`); i++; continue; }
    if ((m = line.match(/^\s*\[이미지\s*(\d+)(?:\s*[:：]\s*(.*?))?\]\s*$/))) {
      const n = Number(m[1]);
      const alt = m[2] || "";
      if (forCopy) {
        out.push(`<p style="background:#fff1b8;padding:6px 10px;font-size:15px;"><b>📷 [이미지 ${n} 자리]</b> 여기에 '이미지 ${n}'을 붙여넣고 이 줄은 지우세요${alt ? ` (${escapeHtml(alt)})` : ""}</p>`);
      } else {
        const im = currentImages.find((x) => x.n === n);
        out.push(`<div class="img-slot">${im ? `<img src="${svgUrl(im.svg)}" alt="${escapeHtml(alt)}">` : ""}📷 이미지 ${n} 자리${alt ? ` — ${escapeHtml(alt)}` : ""}${im ? "" : " (이미지 없음)"}</div>`);
      }
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|?[\s:-]+(\|[\s:-]+)+\|?\s*$/.test(r));
      const [head, ...rest] = body;
      let html = `<table${st("table")}><thead><tr>${cells(head).map((c) => `<th${st("th")}>${inline(c, forCopy)}</th>`).join("")}</tr></thead><tbody>`;
      for (const r of rest) html += `<tr>${cells(r).map((c) => `<td${st("td")}>${inline(c, forCopy)}</td>`).join("")}</tr>`;
      out.push(html + "</tbody></table>");
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      out.push(`<ul>${items.map((t) => `<li${st("li")}>${inline(t, forCopy)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      out.push(`<ol>${items.map((t) => `<li${st("li")}>${inline(t, forCopy)}</li>`).join("")}</ol>`);
      continue;
    }
    // 일반 문단: 빈 줄이 나올 때까지 묶기
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\s*[-*]\s|\s*\d+[.)]\s|\s*\||\s*\[이미지\s*\d+)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p${st("p")}>${para.map((p) => inline(p, forCopy)).join("<br>")}</p>`);
  }
  return out.join("\n");
}

function markdownToPlain(md) {
  return md
    .replace(/\s*\[확인 필요\]/g, "")
    .replace(/^\s*\[이미지\s*(\d+)(?:\s*[:：]\s*(.*?))?\]\s*$/gm, "📷 [이미지 $1 자리] 여기에 이미지 $1을 붙여넣고 이 줄은 지우세요")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

// ───────────── 복사 ─────────────

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} 복사 완료 — 네이버에 붙여넣기(Ctrl+V) 하세요`);
  } catch {
    fallbackCopy(text);
    toast(`${label} 복사 완료`);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

async function copyBody() {
  const md = $("content").value;
  if (!md.trim()) return toast("본문이 비어 있습니다.");
  const left = (md.match(/\[확인 필요\]/g) || []).length;
  if (left && !confirm(`본문에 [확인 필요] 표시가 ${left}곳 있습니다.\n복사할 때 이 표시는 자동으로 빠지지만, 그 문장의 내용이 비어 있거나 어색할 수 있습니다.\n먼저 해당 문장을 고치시는 것을 권합니다.\n\n그래도 복사할까요?`)) return;
  const open = currentChecks.filter((c) => !c.done);
  if (open.length && !confirm(`발행 전 확인할 내용 중 ${open.length}개를 아직 체크하지 않았습니다.\n- ${open.slice(0, 5).map((c) => c.text).join("\n- ")}${open.length > 5 ? "\n…" : ""}\n\n그래도 본문을 복사할까요?`)) return;
  if (currentThumb?.bgFile && !currentThumb.textOk && !confirm("대표 이미지 속 글자를 제목과 비교해 확인하지 않았습니다.\n(한글 오탈자가 있을 수 있습니다)\n\n그래도 본문을 복사할까요?")) return;
  const slots = md.split("\n").filter((l) => MARKER_RE.test(l)).length;
  const reviewNote = reviewStatusNote();
  if (reviewNote && !confirm(`${reviewNote}\n\n그래도 본문을 복사할까요?`)) return;
  const html = markdownToHtml(md, true);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([markdownToPlain(md)], { type: "text/plain" }),
      }),
    ]);
    toast(slots ? `본문 복사 완료 — 붙여넣은 뒤 노란 [이미지 자리] ${slots}곳에 이미지를 넣어 주세요` : "본문(서식 포함) 복사 완료 — 네이버 본문에 붙여넣기 하세요", 4500);
  } catch {
    // 서식 복사가 막힌 브라우저: 미리보기 영역을 선택해서 복사
    const box = document.createElement("div");
    box.innerHTML = html;
    box.style.position = "fixed";
    box.style.left = "-9999px";
    document.body.appendChild(box);
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("copy");
    sel.removeAllRanges();
    box.remove();
    toast("본문 복사 완료");
  }
}

function tagList() {
  return $("tags").value.split(/[,\n]/).map((t) => t.trim().replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean);
}

// ───────────── 편집기 ─────────────

function updateCounter() {
  const text = markdownToPlain($("content").value);
  const noSpace = text.replace(/\s/g, "").length;
  $("counter").textContent = `공백 포함 ${text.length.toLocaleString()}자 · 공백 제외 ${noSpace.toLocaleString()}자`;
}

function setMode(mode) {
  document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("content").classList.toggle("hidden", mode !== "edit");
  $("preview").classList.toggle("hidden", mode !== "preview");
  if (mode === "preview") $("preview").innerHTML = markdownToHtml($("content").value) || '<p class="muted">본문이 없습니다.</p>';
}

// ───────────── 자동 저장 ─────────────
// 고친 뒤 20초 동안 더 고치지 않으면 자동 저장, 창을 닫거나 다른 창으로 갈 때도 저장
const AUTOSAVE_MS = 20_000;
let changeSeq = 0;
let autosaveTimer = null;
let saving = null;

function markDirty() {
  renderTagChips();
  dirty = true;
  changeSeq++;
  $("saveState").textContent = "저장 안 됨 · 잠시 후 자동 저장";
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => save({ auto: true }), AUTOSAVE_MS);
}

function timeStr(iso) {
  const d = new Date(iso);
  return `${fmtDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function readForm() {
  return {
    title: $("title").value.trim(),
    topic: $("topic").value.trim(),
    content: $("content").value,
    tags: tagList(),
    status: $("status").value,
    scheduledAt: $("scheduledAt").value,
    naverUrl: $("naverUrl").value.trim(),
    review: currentReview,
    images: currentImages,
    checks: currentChecks,
    thumb: thumbState(),
  };
}

function fillForm(p) {
  currentId = p?.id || null;
  $("title").value = p?.title || "";
  $("topic").value = p?.topic || "";
  $("content").value = p?.content || "";
  $("tags").value = (p?.tags || []).join(", ");
  renderTagChips();
  $("status").value = p?.status || "draft";
  $("scheduledAt").value = p?.scheduledAt || "";
  $("naverUrl").value = p?.naverUrl || "";
  currentImages = Array.isArray(p?.images) ? p.images : [];
  currentChecks = Array.isArray(p?.checks) ? p.checks : [];
  renderChecks();
  currentThumb = p?.thumb || null;
  loadThumbFields();
  renderBodyImages();
  loadThumbBg();
  currentReview = p?.review || null;
  fixUndo = null;
  $("btnFixUndo").classList.add("hidden");
  $("fixChanges").classList.add("hidden");
  $("fixPaste").value = "";
  $("reviewPaste").value = "";
  renderReview();
  $("btnReviewToggle").textContent = "검증 결과 보기";
  $("titleSuggest").innerHTML = "";
  $("sources").classList.add("hidden");
  $("draftStatus").textContent = "";
  dirty = false;
  clearTimeout(autosaveTimer);
  $("saveState").textContent = currentId ? `저장됨 · ${timeStr(p.updatedAt)}` : "";
  $("btnHistory").classList.toggle("hidden", !currentId);
  setMode("edit");
  updateCounter();
}

async function save(opts = {}) {
  const { auto = false, snapshotReason = "" } = opts;
  clearTimeout(autosaveTimer);
  if (saving) {
    // 저장 중이면 끝난 뒤 한 번 더
    await saving;
    if (!dirty && !snapshotReason) return;
  }
  const data = readForm();
  if (!data.title && !data.content.trim()) {
    if (!auto) toast("제목이나 본문을 입력해 주세요.");
    return;
  }
  if (!auto) {
    if (data.status === "scheduled" && !data.scheduledAt) return toast("발행 예정이면 예정일을 넣어 주세요.");
    if (data.status === "published" && !data.naverUrl) toast("발행 완료 글은 네이버 글 주소도 넣어 두면 나중에 찾기 쉽습니다.", 3000);
  }
  if (snapshotReason) Object.assign(data, { forceSnapshot: true, snapshotReason });
  const seqAtStart = changeSeq;
  saving = (async () => {
    try {
      const saved = currentId
        ? await api(`/api/posts/${currentId}`, { method: "PUT", body: data })
        : await api("/api/posts", { method: "POST", body: data });
      currentId = saved.id;
      $("btnHistory").classList.remove("hidden");
      dirty = changeSeq !== seqAtStart; // 저장하는 동안 또 고쳤으면 계속 '저장 안 됨'
      $("saveState").textContent = dirty ? "저장 안 됨 · 잠시 후 자동 저장" : `${auto ? "자동 저장됨" : "저장됨"} · ${timeStr(saved.updatedAt)}`;
      if (dirty) autosaveTimer = setTimeout(() => save({ auto: true }), AUTOSAVE_MS);
      if (!auto) toast("저장했습니다.");
    } catch (e) {
      $("saveState").textContent = "⚠ 저장 실패 — 프로그램이 켜져 있는지 확인";
      if (!auto) toast(e.message, 3500);
    }
  })();
  try {
    await saving;
  } finally {
    saving = null;
  }
}

// 창을 닫을 때: 저장 요청을 보내 둠(keepalive)
function flushOnLeave() {
  if (!dirty) return;
  const data = readForm();
  if (!data.title && !data.content.trim()) return;
  try {
    fetch(currentId ? `/api/posts/${currentId}` : "/api/posts", {
      method: currentId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      keepalive: true,
    });
  } catch {}
}

function confirmDiscard() {
  return !dirty || confirm("저장하지 않은 내용이 있습니다. 버리고 진행할까요?");
}

// ───────────── 요청문 복사 방식 ─────────────

async function copyRequest(kind, body = {}, url = CLAUDE_URL, site = "claude.ai") {
  try {
    const { text } = await api(`/api/prompt/${kind}`, { method: "POST", body });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      fallbackCopy(text);
    }
    window.open(url, "_blank", "noopener");
    toast(`요청문을 복사했습니다. ${site} 대화창에 붙여넣기(Ctrl+V) 후 보내세요.`, 4500);
    return true;
  } catch (e) {
    toast(e.message, 3500);
    return false;
  }
}

function cleanLine(t) {
  return t.replace(/\*\*/g, "").replace(/^\s*\d+[.)]\s*/, "").replace(/^\s*[-*•]\s+/, "").replace(/^["'“”‘’]|["'“”‘’]$/g, "").trim();
}

function parseResult(text) {
  const re = /===\s*(제목\s*후보|본문|해시태그|수정\s*내역|확인할\s*내용)\s*===/g;
  const marks = [...text.matchAll(re)];
  if (!marks.length) return { body: text.trim(), titles: [], tags: [], changes: [], checks: null };
  const out = { titles: [], tags: [], body: "", changes: [], checks: null };
  marks.forEach((m, i) => {
    const chunk = text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).trim();
    const name = m[1].replace(/\s/g, "");
    if (name === "제목후보") out.titles = chunk.split("\n").map(cleanLine).filter((t) => t && !/^\(.*\)$/.test(t)).slice(0, 5);
    else if (name === "본문") out.body = chunk;
    else if (name === "확인할내용") out.checks = chunk.split("\n").map(cleanLine).filter((t) => t && !/^\(?없음\)?\.?$/.test(t) && !/^\(.*\)$/.test(t));
    else if (name === "수정내역") out.changes = chunk.split("\n").map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
    else out.tags = chunk.split(/[,#\n]/).map((t) => t.trim().replace(/\s+/g, "")).filter(Boolean).slice(0, 15);
  });
  return out;
}

function showTitleChips(titles) {
  const box = $("titleSuggest");
  box.innerHTML = "";
  for (const t of titles) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = t;
    chip.title = "클릭하면 제목에 넣습니다";
    chip.onclick = () => { $("title").value = t; markDirty(); };
    box.appendChild(chip);
  }
}

function applyResult(opts = {}) {
  const text = $("pasteResult").value.trim();
  if (!text) return toast("claude.ai 답변을 먼저 붙여넣어 주세요.");
  const r = parseResult(text);
  if (opts.auto && !r.body) throw new Error("초안 답변에서 본문을 찾지 못했습니다.");
  if (r.body) {
    if (!opts.auto && $("content").value.trim() && $("content").value.trim() !== r.body && !confirm("지금 본문을 붙여넣은 답변으로 바꿉니다. 계속할까요?")) return;
    $("content").value = r.body;
  }
  if (r.titles.length) {
    showTitleChips(r.titles);
    if (!$("title").value.trim() || r.body) $("title").value = r.titles[0];
  }
  if (r.tags.length) $("tags").value = r.tags.join(", ");
  if (r.checks) setChecks(r.checks);
  setMode("edit");
  updateCounter();
  markDirty();
  $("pasteResult").value = "";
  if (opts.auto) return;
  const left = currentChecks.filter((c) => !c.done).length;
  toast(
    r.body
      ? `적용했습니다.${left ? ` 본문 아래 '발행 전 확인할 내용' ${left}개를 꼭 확인해 주세요.` : " 내용을 검토해 주세요."} 제목 후보를 클릭하면 바꿀 수 있습니다.`
      : "제목 후보와 해시태그를 적용했습니다.",
    4000
  );
  $("title").scrollIntoView({ behavior: "smooth", block: "center" });
}

function draftRequestBody() {
  const tpl = templates.find((t) => t.id === $("templateSelect").value);
  return {
    topic: $("topic").value.trim(),
    audience: $("audience").value.trim(),
    memo: $("memo").value.trim(),
    templateGuide: tpl?.guide || "",
    length: Number($("length").value),
    webSearch: $("webSearch").checked,
    useStyle: $("useStyle").checked,
  };
}

function applyMode(aiReady) {
  mode = aiReady ? "api" : "copy";
  document.body.classList.toggle("mode-copy", mode === "copy");
  const badge = $("aiBadge");
  badge.textContent = mode === "api" ? "AI 바로 작성(API)" : autoLabel();
  badge.className = `badge ${mode === "api" ? "ok" : ""}`;
  badge.title = mode === "api" ? "API 키가 설정되어 있어 사용한 만큼 요금이 나옵니다." : "claude.ai에 붙여넣어 쓰는 방식입니다. 구독 요금 외 추가 비용이 없습니다.";
  $("btnDraft").textContent = mode === "api" ? "AI 초안 작성" : "요청문 복사 → claude.ai 열기";
  $("btnMeta").textContent = mode === "api" ? "제목·태그 추천받기" : "제목·태그 요청문 복사";
  $("btnAnalyze").textContent = mode === "api" ? "말투 분석하기" : "말투 분석 요청문 복사";
  $("webSearchInfo").textContent = mode === "api"
    ? "국가법령정보센터·국세청·기재부 등 공식 사이트만 검색"
    : "공식 자료 확인 요청을 넣습니다 (claude.ai에서 웹 검색이 켜져 있어야 합니다)";
  applyAutoLabels();
}

// ───────────── 자동 실행 (내 PC의 Claude Code·Codex, 추가 비용 없음) ─────────────

let localAi = { claude: { ready: false }, codex: { ready: false } };
const ENGINE_OF = { draft: "claude", meta: "claude", style: "claude", fix: "claude", bodyimages: "claude", topics: "claude", review: "codex" };
const ENGINE_NAME = { claude: "Claude", codex: "ChatGPT" };
const AUTO_LABELS = {
  btnDraft: ["claude", "AI 초안 작성 (자동)"],
  btnMeta: ["claude", "제목·태그 추천받기 (자동)"],
  btnAnalyze: ["claude", "말투 분석하기 (자동)"],
  btnFixCopy: ["claude", "수정본 만들기 (자동)"],
  btnBodyImgCopy: ["claude", "본문 이미지 만들기 (자동)"],
  btnTopicsCopy: ["claude", "AI 정밀 조사 (자동)"],
  btnReviewCopy: ["codex", "ChatGPT로 2차 검증 (자동)"],
};
const manualLabels = {};

function autoOn() {
  try { return localStorage.getItem("autoRun") !== "0"; } catch { return true; }
}
function engineReady(engine) {
  return mode === "copy" && autoOn() && Boolean(localAi[engine]?.ready);
}
function autoLabel() {
  const on = engineReady("claude") || engineReady("codex");
  return on ? "자동 실행 · 추가 비용 없음" : "요청문 복사 방식 · 추가 비용 없음";
}

function applyAutoLabels() {
  for (const [id, [engine, label]] of Object.entries(AUTO_LABELS)) {
    const b = $(id);
    if (!b || b.dataset.busy) continue;
    if (!b.textContent.includes("(자동)")) manualLabels[id] = b.textContent; // 원래(복사 방식) 문구 기억
    b.textContent = engineReady(engine) ? label : manualLabels[id] ?? b.textContent;
  }
  if (mode === "copy") $("aiBadge").textContent = autoLabel();
  if (typeof updatePipeBox === "function") updatePipeBox();
}

// 자동 실행 → 결과를 붙여넣기 칸에 넣고 기존 '적용' 처리 그대로 실행. 안 되면 요청문 복사로.
async function viaAuto(kind, body, btn, onText, copyFallback) {
  const engine = ENGINE_OF[kind];
  if (!engineReady(engine)) return copyFallback();
  const label = btn.textContent;
  btn.disabled = true;
  btn.dataset.busy = "1";
  btn.textContent = `${ENGINE_NAME[engine]} 자동 작성 중… (1~3분)`;
  toast(`${ENGINE_NAME[engine]}가 작성 중입니다. 1~3분 정도 걸립니다. 다른 화면을 봐도 됩니다.`, 4000);
  try {
    const { text, seconds } = await api("/api/localai/run", { method: "POST", body: { kind, body } });
    await onText(text);
    setTimeout(() => toast(`${ENGINE_NAME[engine]} 자동 작성 완료 (${seconds}초) — 내용을 꼭 검토해 주세요.`, 4000), 300);
  } catch (e) {
    if (confirm(`${e.message}\n\n이번에는 요청문 복사 방식으로 진행할까요?`)) await copyFallback();
  } finally {
    btn.disabled = false;
    delete btn.dataset.busy;
    btn.textContent = label;
  }
}

function pillFor(st, name) {
  if (!st.installed) return ["설치 안 됨", "draft"];
  if (!st.ready) return ["로그인 필요", "fix"];
  return [`사용 가능 ✓`, "ok"];
}

async function loadLocalAi(refresh = false) {
  try {
    localAi = await api(`/api/localai/status${refresh ? "?refresh=1" : ""}`);
  } catch {
    localAi = { claude: { ready: false }, codex: { ready: false } };
  }
  for (const [id, key] of [["stClaude", "claude"], ["stCodex", "codex"]]) {
    const [text, cls] = pillFor(localAi[key] || {}, key);
    $(id).textContent = text;
    $(id).className = `pill ${cls}`;
    $(id).title = localAi[key]?.version || "";
  }
  $("autoOn").checked = autoOn();
  applyAutoLabels();
}

$("aiBadge").onclick = () => { loadLocalAi(true); $("autoDlg").showModal(); };
$("btnAutoClose").onclick = () => $("autoDlg").close();
$("btnAutoRecheck").onclick = async () => {
  $("btnAutoRecheck").disabled = true;
  $("btnAutoRecheck").textContent = "확인 중…";
  await loadLocalAi(true);
  $("btnAutoRecheck").disabled = false;
  $("btnAutoRecheck").textContent = "다시 확인";
  toast(engineReady("claude") || engineReady("codex") ? "자동 실행을 쓸 수 있습니다." : "아직 자동 실행을 쓸 수 없습니다. 설치·로그인 후 앱을 껐다 켜 주세요.", 3500);
};
$("autoOn").onchange = () => {
  try { localStorage.setItem("autoRun", $("autoOn").checked ? "1" : "0"); } catch {}
  applyAutoLabels();
};
$("autoDlg").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cmd]");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.cmd); } catch { fallbackCopy(b.dataset.cmd); }
  toast("명령을 복사했습니다. PowerShell에 붙여넣고(마우스 오른쪽 클릭 또는 Ctrl+V) Enter를 누르세요.", 4000);
});

// ───────────── 발행 전 확인할 내용 ─────────────

let currentChecks = []; // [{text, done}]

function setChecks(texts) {
  // 같은 문구는 체크 상태를 유지
  const prev = new Map(currentChecks.map((c) => [c.text, c.done]));
  currentChecks = [...new Set(texts.map((t) => t.trim()).filter(Boolean))].map((text) => ({ text, done: prev.get(text) || false }));
  renderChecks();
}

function renderChecks() {
  const list = $("checkList");
  const open = currentChecks.filter((c) => !c.done).length;
  $("checkCount").textContent = currentChecks.length ? (open ? `남은 항목 ${open}개 / ${currentChecks.length}개` : "모두 확인함") : "없음";
  $("checkBox").classList.toggle("all-done", currentChecks.length > 0 && !open);
  list.innerHTML = currentChecks
    .map((c, i) => `<li class="${c.done ? "done" : ""}"><input type="checkbox" data-chk="${i}" ${c.done ? "checked" : ""}/><span>${escapeHtml(c.text)}</span><button data-chk-del="${i}" title="삭제">✕</button></li>`)
    .join("");
}

$("checkList").onchange = (e) => {
  const b = e.target.closest("[data-chk]");
  if (!b) return;
  currentChecks[Number(b.dataset.chk)].done = b.checked;
  renderChecks();
  markDirty();
};
$("checkList").onclick = (e) => {
  const d = e.target.closest("[data-chk-del]");
  if (!d) return;
  currentChecks.splice(Number(d.dataset.chkDel), 1);
  renderChecks();
  markDirty();
};
$("btnCheckAdd").onclick = () => {
  const t = $("checkNew").value.trim();
  if (!t) return;
  currentChecks.push({ text: t, done: false });
  $("checkNew").value = "";
  renderChecks();
  markDirty();
};
$("checkNew").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("btnCheckAdd").click(); } });

// ───────────── 이미지 만들기 ─────────────

let currentImages = []; // 본문 이미지 [{n, place, alt, svg}]
let currentThumb = null; // 대표 이미지 설정 {title, sub, office, preset, bgFile}
const FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

function svgUrl(svg) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function safeName(t) {
  return (t || "블로그").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) || "블로그";
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function copyImageBlob(blobPromise, label) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
    toast(`${label} 복사 완료 — 네이버 본문의 자리에 붙여넣기(Ctrl+V) 하세요`, 3500);
  } catch {
    toast("이 브라우저에서는 이미지 복사가 안 됩니다. PNG 저장 후 네이버에서 사진으로 올려 주세요.", 4500);
  }
}

// ── 본문 이미지 (claude.ai SVG) ──

function cleanSvg(svg) {
  let t = String(svg || "").trim();
  if (!/^<svg[\s>]/i.test(t) || !/<\/svg>\s*$/i.test(t)) return null;
  if (/<script|<foreignObject|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/)/i.test(t)) return null;
  if (!/xmlns=/.test(t)) t = t.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return t;
}

function svgSize(svg) {
  const vb = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (vb) return { w: Number(vb[1]), h: Number(vb[2]) };
  const w = svg.match(/\swidth\s*=\s*["']?([\d.]+)/i), h = svg.match(/\sheight\s*=\s*["']?([\d.]+)/i);
  return { w: Number(w?.[1]) || 1200, h: Number(h?.[1]) || 800 };
}

function svgToPng(svg, scale = 2) {
  return new Promise((resolve, reject) => {
    const { w, h } = svgSize(svg);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지 변환 실패"))), "image/png");
    };
    img.onerror = () => reject(new Error("SVG를 그리지 못했습니다. 코드가 잘렸는지 확인해 주세요."));
    img.src = svgUrl(svg);
  });
}

function parseBodyImages(text) {
  const marks = [...text.matchAll(/===\s*이미지\s*(\d+)\s*===/g)];
  const chunks = marks.length
    ? marks.map((m, i) => ({ n: Number(m[1]), body: text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined) }))
    : [...text.matchAll(/<svg[\s\S]*?<\/svg>/gi)].map((m, i) => ({ n: i + 1, body: m[0] }));
  const ok = [];
  const bad = [];
  for (const c of chunks) {
    const raw = (c.body.match(/<svg[\s\S]*?<\/svg>/i) || [])[0];
    const svg = cleanSvg(raw);
    if (!svg) {
      bad.push(c.n);
      continue;
    }
    ok.push({
      n: c.n,
      place: ((c.body.match(/위치\s*[:：]\s*(.+)/) || [])[1] || "").replace(/^#+\s*/, "").replace(/[*"“”]/g, "").trim(),
      alt: ((c.body.match(/설명\s*[:：]\s*(.+)/) || [])[1] || "").replace(/[*]/g, "").trim(),
      svg,
    });
  }
  return { ok, bad };
}

const MARKER_RE = /^\s*\[이미지\s*\d+(?:\s*[:：].*?)?\]\s*$/;
const norm = (t) => t.replace(/^#+\s*/, "").replace(/[\s*·.,:：()]/g, "");

function placeMarkers(content, images) {
  const lines = content.split("\n").filter((l) => !MARKER_RE.test(l));
  // 뒤에서부터 넣어야 줄 번호가 밀리지 않음
  const inserts = images.map((im) => {
    const key = norm(im.place || "");
    let idx = key ? lines.findIndex((l) => /^#{1,3}\s/.test(l) && (norm(l).includes(key) || key.includes(norm(l)))) : -1;
    return { im, idx };
  });
  const end = (() => {
    const disclaimer = lines.findIndex((l) => l.trim().startsWith("※"));
    return disclaimer >= 0 ? disclaimer : lines.length;
  })();
  inserts
    .sort((a, b) => (b.idx < 0 ? end : b.idx) - (a.idx < 0 ? end : a.idx) || b.im.n - a.im.n)
    .forEach(({ im, idx }) => {
      const at = idx >= 0 ? idx + 1 : end;
      lines.splice(at, 0, "", `[이미지 ${im.n}: ${im.alt || im.place || "이미지"}]`, "");
    });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function renderBodyImages() {
  const box = $("bodyImgList");
  $("bodyImgCount").textContent = currentImages.length ? `${currentImages.length}개` : "";
  box.innerHTML = currentImages
    .map(
      (im) => `<div class="img-card">
        <img src="${svgUrl(im.svg)}" alt="${escapeHtml(im.alt)}">
        <div class="cap"><b>이미지 ${im.n}</b> ${escapeHtml(im.alt)}<br><span class="muted">위치: ${escapeHtml(im.place || "본문 끝")}</span></div>
        <div class="actions">
          <button data-img-copy="${im.n}">이미지 복사</button>
          <button class="ghost" data-img-save="${im.n}">PNG 저장</button>
          <button class="ghost danger" data-img-del="${im.n}">삭제</button>
        </div>
      </div>`
    )
    .join("");
}

$("btnBodyImgCopy").onclick = () => {
  const content = $("content").value;
  if (!content.trim()) return toast("본문을 먼저 완성해 주세요.");
  const body = { title: $("title").value.trim(), content: content.split("\n").filter((l) => !MARKER_RE.test(l)).join("\n"), count: Number($("bodyImgN").value), checks: currentChecks, useImgStyle: $("bodyImgStyle").checked };
  viaAuto("bodyimages", body, $("btnBodyImgCopy"), (text) => { $("bodyImgPaste").value = text; $("btnBodyImgApply").onclick(); }, () => copyRequest("bodyimages", body));
};

$("btnBodyImgApply").onclick = () => applyBodyImages($("bodyImgPaste").value.trim());

function applyBodyImages(text, opts = {}) {
  if (!text) return toast("claude.ai 답변을 붙여넣어 주세요.");
  const { ok, bad } = parseBodyImages(text);
  if (!ok.length) { if (opts.auto) throw new Error("이미지 코드를 받지 못했습니다."); return toast("답변에서 SVG 이미지 코드를 찾지 못했습니다. 코드가 답변 안에 있는지 확인해 주세요.", 4500); }
  if (!opts.auto && currentImages.length && !confirm(`지금 본문 이미지 ${currentImages.length}개를 새 이미지 ${ok.length}개로 바꿀까요?`)) return;
  currentImages = ok;
  $("content").value = placeMarkers($("content").value, ok);
  $("bodyImgPaste").value = "";
  renderBodyImages();
  updateCounter();
  markDirty();
  const missing = ok.filter((im) => !im.place).length;
  if (opts.auto) return { count: ok.length, bad };
  toast(`이미지 ${ok.length}개를 만들고 본문에 자리를 표시했습니다.${bad.length ? ` (이미지 ${bad.join(", ")}은 코드가 올바르지 않아 제외)` : ""}${missing ? " 위치를 못 찾은 이미지는 본문 끝에 두었습니다." : ""} 미리보기로 확인해 주세요.`, 5500);
}

$("bodyImgList").onclick = async (e) => {
  const get = (attr) => currentImages.find((x) => x.n === Number(e.target.closest(`[${attr}]`)?.getAttribute(attr)));
  if (e.target.closest("[data-img-copy]")) {
    const im = get("data-img-copy");
    return copyImageBlob(svgToPng(im.svg), `이미지 ${im.n}`);
  }
  if (e.target.closest("[data-img-save]")) {
    const im = get("data-img-save");
    try {
      downloadBlob(await svgToPng(im.svg), `${safeName($("title").value)}-이미지${im.n}.png`);
    } catch (err) {
      toast(err.message, 3500);
    }
    return;
  }
  if (e.target.closest("[data-img-del]")) {
    const im = get("data-img-del");
    if (!confirm(`이미지 ${im.n}을 삭제할까요? 본문의 자리 표시도 지웁니다.`)) return;
    currentImages = currentImages.filter((x) => x !== im);
    $("content").value = $("content").value.split("\n").filter((l) => !new RegExp(`^\\s*\\[이미지\\s*${im.n}(?:\\s*[:：].*?)?\\]\\s*$`).test(l)).join("\n");
    renderBodyImages();
    updateCounter();
    markDirty();
  }
};

// ── 대표 이미지 (ChatGPT가 제목 글자까지 넣은 그림) ──

function thumbState() {
  return {
    bgFile: currentThumb?.bgFile || "",
    textOk: Boolean(currentThumb?.textOk),
  };
}

function thumbTitleText() {
  return $("title").value.trim();
}

function renderThumbExpect() {
  const t = thumbTitleText();
  $("thumbExpect").innerHTML = t ? escapeHtml(t) : "<small>글 제목을 먼저 입력해 주세요</small>";
}

function loadThumbFields() {
  $("thumbTextOk").checked = Boolean(currentThumb?.textOk);
  renderThumbExpect();
}

function loadThumbBg() {
  const file = currentThumb?.bgFile;
  const img = $("thumbImg");
  if (file) {
    img.src = `/api/images/${file}?t=${Date.now()}`;
    img.hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute("src");
  }
  $("thumbEmpty").hidden = Boolean(file);
  $("thumbCheckRow").classList.toggle("hidden", !file);
}

async function thumbFileBlob() {
  const file = currentThumb?.bgFile;
  if (!file) throw new Error("대표 이미지 그림이 없습니다. ChatGPT 그림을 먼저 넣어 주세요.");
  const res = await fetch(`/api/images/${file}`);
  if (!res.ok) throw new Error("그림을 불러오지 못했습니다.");
  return res.blob();
}

// 클립보드에는 PNG만 넣을 수 있어 변환
async function thumbPngBlob() {
  const blob = await thumbFileBlob();
  if (blob.type === "image/png") return blob;
  const url = URL.createObjectURL(blob);
  const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("그림을 열지 못했습니다.")); i.src = url; });
  URL.revokeObjectURL(url);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d").drawImage(img, 0, 0);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("변환 실패"))), "image/png"));
}

async function setThumbBgFromFile(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return toast("PNG·JPG·WEBP 그림만 넣을 수 있습니다.");
  if (!currentId) {
    await save({ auto: true });
    if (!currentId) return toast("제목이나 본문을 먼저 입력해 주세요(글을 저장해야 그림을 넣을 수 있습니다).", 4000);
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("그림을 읽지 못했습니다."));
    fr.readAsDataURL(file);
  });
  // 원본 그대로 보관 (12MB가 넘으면 3000px로 줄임 — 글자가 흐려지지 않도록 넉넉하게)
  let upload = dataUrl;
  if (file.size > 12_000_000) {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("그림을 열지 못했습니다.")); i.src = dataUrl; });
    const r = Math.min(1, 3000 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * r);
    c.height = Math.round(img.height * r);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    upload = c.toDataURL("image/jpeg", 0.95);
  }
  try {
    const { bgFile } = await api(`/api/posts/${currentId}/thumbbg`, { method: "PUT", body: { dataUrl: upload } });
    currentThumb = { ...thumbState(), bgFile, textOk: false };
    $("thumbTextOk").checked = false;
    loadThumbBg();
    markDirty();
    toast("그림을 넣었습니다. 그림 속 글자가 노란 칸의 제목과 똑같은지 비교한 뒤 체크해 주세요.", 5000);
  } catch (e) {
    toast(e.message, 4000);
  }
}

$("btnThumbCopy").onclick = () => {
  const thumbTitle = thumbTitleText();
  if (!thumbTitle) return toast("글 제목을 먼저 입력해 주세요.");
  copyRequest(
    "thumb",
    { thumbTitle, title: thumbTitle, topic: $("topic").value.trim(), useImgStyle: $("thumbImgStyle").checked },
    CHATGPT_URL,
    "ChatGPT"
  );
};
// 글 제목을 바꾸면 대표 이미지 글자 확인은 다시 해야 함
$("title").addEventListener("input", () => {
  renderThumbExpect();
  if (currentThumb?.textOk) {
    currentThumb = { ...thumbState(), textOk: false };
    $("thumbTextOk").checked = false;
  }
});
$("thumbTextOk").addEventListener("change", () => { currentThumb = { ...thumbState(), textOk: $("thumbTextOk").checked }; markDirty(); });
$("thumbFile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) setThumbBgFromFile(f); };
$("btnThumbClear").onclick = () => {
  if (!currentThumb?.bgFile) return;
  if (!confirm("대표 이미지 그림을 지울까요?")) return;
  currentThumb = { ...thumbState(), bgFile: "", textOk: false };
  $("thumbTextOk").checked = false;
  loadThumbBg();
  markDirty();
};
const drop = $("thumbDrop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) setThumbBgFromFile(f); });
drop.addEventListener("click", () => drop.focus());
drop.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith("image/"));
  if (item) { e.preventDefault(); setThumbBgFromFile(item.getAsFile()); } else toast("복사된 그림이 없습니다. ChatGPT 그림을 내려받아 끌어다 놓아 주세요.", 3500);
});
$("btnThumbSave").onclick = async () => {
  try {
    const blob = await thumbFileBlob();
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[blob.type] || "png";
    downloadBlob(blob, `${safeName($("title").value)}-대표이미지.${ext}`);
  } catch (e) { toast(e.message, 3500); }
};
$("btnThumbCopyImg").onclick = () => {
  if (!currentThumb?.bgFile) return toast("대표 이미지 그림이 없습니다.");
  copyImageBlob(thumbPngBlob(), "대표 이미지");
};

// ───────────── 이미지 학습 ─────────────

let imgStyle = { body: { samples: [], palette: [], guide: "" }, thumb: { samples: [], palette: [], guide: "" } };
const IMG_KIND = { body: { url: CLAUDE_URL, site: "claude.ai" }, thumb: { url: CHATGPT_URL, site: "ChatGPT" } };
const styleTouched = { body: false, thumb: false };

const toHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function hasImgStyle(kind) {
  const k = imgStyle[kind];
  return Boolean(k && (k.guide?.trim() || k.palette?.length));
}

function swatchHtml(hex, btnAttr = "") {
  return btnAttr
    ? `<button class="swatch" ${btnAttr}><i style="background:${hex}"></i>${hex}</button>`
    : `<span class="swatch"><i style="background:${hex}"></i>${hex}</span>`;
}

function renderImgStyle() {
  for (const kind of ["body", "thumb"]) {
    const k = imgStyle[kind];
    $(`isCount-${kind}`).textContent = k.samples.length ? `샘플 ${k.samples.length}장` : "";
    $(`isGrid-${kind}`).innerHTML = k.samples
      .map((sm) => `<div class="is-item"><img src="/api/styleimg/${sm.file}" alt="" loading="lazy"><button data-is-del="${kind}:${sm.id}" title="삭제">✕</button></div>`)
      .join("");
    $(`isPal-${kind}`).innerHTML = k.palette.length ? k.palette.map((h) => swatchHtml(h)).join("") : '<span class="muted small">샘플을 넣으면 자동으로 표시됩니다.</span>';
    if (document.activeElement !== $(`isGuide-${kind}`)) $(`isGuide-${kind}`).value = k.guide || "";
    $(`isMeta-${kind}`).textContent = k.guideAt ? `저장: ${timeStr(k.guideAt)}` : "";
  }
  updateImgStyleToggles();
}

function updateImgStyleToggles() {
  for (const [kind, id] of [["body", "bodyImgStyle"], ["thumb", "thumbImgStyle"]]) {
    const ok = hasImgStyle(kind);
    const box = $(id);
    box.disabled = !ok;
    if (!ok) box.checked = false;
    else if (!styleTouched[kind]) box.checked = true;
    const k = imgStyle[kind];
    $(`${id}Info`).textContent = ok
      ? `(주요 색 ${k.palette.length}개${k.guide?.trim() ? " + 스타일 지침" : ""})`
      : "('이미지 학습'에서 샘플을 넣으면 사용할 수 있습니다)";
  }
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("이미지를 열지 못했습니다."));
    i.src = src;
  });
}

// 주요 색 뽑기: 거의 흰색(배경)은 빼고, 많이 쓰인 색부터 서로 충분히 다른 색으로 최대 6개
async function computePalette(kind) {
  const buckets = new Map();
  for (const sm of imgStyle[kind].samples) {
    let img;
    try { img = await loadImg(`/api/styleimg/${sm.file}`); } catch { continue; }
    const c = document.createElement("canvas");
    const r = 80 / Math.max(img.width, img.height);
    c.width = Math.max(1, Math.round(img.width * r));
    c.height = Math.max(1, Math.round(img.height * r));
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) {
      const [R, G, B] = [d[i], d[i + 1], d[i + 2]];
      if (R > 232 && G > 232 && B > 232) continue;
      const key = (R >> 4) * 256 + (G >> 4) * 16 + (B >> 4);
      const bk = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      bk.n++; bk.r += R; bk.g += G; bk.b += B;
      buckets.set(key, bk);
    }
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).map((b) => [b.r / b.n, b.g / b.n, b.b / b.n]);
  const picked = [];
  for (const c of sorted) {
    if (picked.length >= 6) break;
    if (picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 60)) picked.push(c);
  }
  return picked.map((c) => toHex(...c));
}

async function addStyleImages(kind, files) {
  const list = [...files].filter((f) => f && f.type.startsWith("image/"));
  if (!list.length) return toast("이미지 파일이 아닙니다.");
  let added = 0;
  for (const f of list) {
    if (imgStyle[kind].samples.length >= 12) { toast("샘플은 12장까지 넣을 수 있습니다."); break; }
    try {
      const url = URL.createObjectURL(f);
      const img = await loadImg(url);
      URL.revokeObjectURL(url);
      const r = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      imgStyle = await api(`/api/imgstyle/${kind}/samples`, { method: "POST", body: { dataUrl: c.toDataURL("image/jpeg", 0.9), w: c.width, h: c.height, name: f.name } });
      added++;
    } catch (e) {
      toast(e.message, 3500);
    }
  }
  if (added) {
    imgStyle = await api(`/api/imgstyle/${kind}`, { method: "PUT", body: { palette: await computePalette(kind) } });
    toast(`샘플 ${added}장을 넣고 주요 색을 다시 계산했습니다.`);
  }
  renderImgStyle();
}

// 샘플 여러 장을 한 장으로 모으기 (claude.ai·ChatGPT에 한 번에 붙여넣기 위함)
async function makeCollage(kind) {
  const sams = imgStyle[kind].samples;
  const imgs = [];
  for (const sm of sams) { try { imgs.push(await loadImg(`/api/styleimg/${sm.file}`)); } catch {} }
  if (!imgs.length) throw new Error("샘플 이미지가 없습니다.");
  const cols = imgs.length <= 2 ? imgs.length : imgs.length <= 4 ? 2 : imgs.length <= 9 ? 3 : 4;
  const rows = Math.ceil(imgs.length / cols);
  const cell = 520, gap = 16;
  const c = document.createElement("canvas");
  c.width = cols * cell + (cols + 1) * gap;
  c.height = rows * cell + (rows + 1) * gap;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e9ecea";
  ctx.fillRect(0, 0, c.width, c.height);
  imgs.forEach((img, i) => {
    const x = gap + (i % cols) * (cell + gap), y = gap + Math.floor(i / cols) * (cell + gap);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, cell, cell);
    const r = Math.min(cell / img.width, cell / img.height);
    const w = img.width * r, h = img.height * r;
    ctx.drawImage(img, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
    ctx.fillStyle = "rgba(29,35,32,.75)";
    ctx.fillRect(x, y, 44, 34);
    ctx.fillStyle = "#fff";
    ctx.font = `bold 22px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), x + 14, y + 17);
  });
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("모음 이미지 만들기 실패"))), "image/png"));
}

async function loadImgStyle() {
  try { imgStyle = await api("/api/imgstyle"); } catch { return; }
  renderImgStyle();
}

$("view-imgstyle").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-is-del]");
  if (del) {
    const [kind, id] = del.dataset.isDel.split(":");
    if (!confirm("이 샘플을 삭제할까요?")) return;
    imgStyle = await api(`/api/imgstyle/${kind}/samples/${id}`, { method: "DELETE" });
    imgStyle = await api(`/api/imgstyle/${kind}`, { method: "PUT", body: { palette: await computePalette(kind) } });
    return renderImgStyle();
  }
  const col = e.target.closest("[data-is-collage]");
  if (col) {
    const kind = col.dataset.isCollage;
    if (!imgStyle[kind].samples.length) return toast("샘플 이미지를 먼저 넣어 주세요.");
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": makeCollage(kind) })]);
      window.open(IMG_KIND[kind].url, "_blank", "noopener");
      toast(`샘플 모음 이미지를 복사했습니다. ${IMG_KIND[kind].site} 새 대화창에 Ctrl+V로 붙여넣은 뒤, ②번 요청문을 복사해 오세요.`, 5500);
    } catch (err) {
      toast(`이미지 복사가 안 됩니다(${err.message}). 샘플 원본 파일을 ${IMG_KIND[kind].site}에 직접 끌어다 놓아 주세요.`, 5500);
    }
    return;
  }
  const rq = e.target.closest("[data-is-req]");
  if (rq) {
    const kind = rq.dataset.isReq;
    try {
      const { text } = await api(`/api/prompt/imgstyle-${kind}`, { method: "POST", body: {} });
      try { await navigator.clipboard.writeText(text); } catch { fallbackCopy(text); }
      toast(`요청문을 복사했습니다. 그림을 붙여넣은 ${IMG_KIND[kind].site} 대화창에 Ctrl+V 후 보내세요.`, 4500);
    } catch (err) {
      toast(err.message, 3500);
    }
    return;
  }
  const sv = e.target.closest("[data-is-save]");
  if (sv) {
    const kind = sv.dataset.isSave;
    imgStyle = await api(`/api/imgstyle/${kind}`, { method: "PUT", body: { guide: $(`isGuide-${kind}`).value } });
    renderImgStyle();
    toast("스타일 지침을 저장했습니다. 이미지 요청문에 자동으로 반영됩니다.");
  }
});
for (const kind of ["body", "thumb"]) {
  const drop = $(`isDrop-${kind}`);
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addStyleImages(kind, e.dataTransfer.files); });
  drop.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.type.startsWith("image/")).map((it) => it.getAsFile());
    if (files.length) { e.preventDefault(); addStyleImages(kind, files); } else toast("복사된 이미지가 없습니다.");
  });
}
document.querySelectorAll("[data-is-file]").forEach((inp) => {
  inp.onchange = (e) => { const files = [...e.target.files]; e.target.value = ""; addStyleImages(inp.dataset.isFile, files); };
});
$("bodyImgStyle").addEventListener("change", () => (styleTouched.body = true));
$("thumbImgStyle").addEventListener("change", () => (styleTouched.thumb = true));
// ───────────── 2차 검증 (ChatGPT) ─────────────

function contentHash(text) {
  let h = 5381;
  const t = text.trim();
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return `${t.length}-${(h >>> 0).toString(36)}`;
}

function parseReview(text) {
  const v = text.match(/판정\s*[:：]\s*[*\s]*(발행\s*가능|수정\s*후\s*발행|발행\s*보류)/);
  const verdict = v ? v[1].replace(/\s+/g, " ") : "판정 없음";
  const n = text.match(/수정\s*필요\s*항목\s*수\s*[:：]\s*[*\s]*(\d+)/);
  const rows = text.split("\n").filter((l) => /^\s*\|/.test(l) && /수정\s*필요/.test(l) && !/판정\(/.test(l)).length;
  return { verdict, issues: n ? Number(n[1]) : rows };
}

function renderReview() {
  const badge = $("reviewBadge");
  const r = currentReview;
  $("btnReviewToggle").classList.toggle("hidden", !r);
  $("fixBox").classList.toggle("hidden", !r);
  if (!r) {
    badge.textContent = "검증 안 함";
    badge.className = "pill draft";
    $("reviewStale").classList.add("hidden");
    $("reviewResult").classList.add("hidden");
    return;
  }
  const cls = { "발행 가능": "ok", "수정 후 발행": "fix", "발행 보류": "stop" }[r.verdict] || "draft";
  badge.textContent = `${r.verdict}${r.issues ? ` · 수정 ${r.issues}건` : ""} · ${fmtDate(r.reviewedAt)}`;
  badge.className = `pill ${cls}`;
  $("reviewStale").classList.toggle("hidden", r.contentHash === contentHash($("content").value));
  const md = r.text.replace(/^\s*===\s*(.+?)\s*===\s*$/gm, "## $1");
  $("reviewResult").innerHTML = markdownToHtml(md).replace(/(수정 필요|확인 불가|발행 보류)/g, '<span class="bad">$1</span>');
}

function reviewStatusNote() {
  const r = currentReview;
  if (!r) return "2차 검증(ChatGPT)을 하지 않았습니다.";
  const notes = [];
  if (r.verdict === "발행 보류") notes.push("2차 검증 판정이 '발행 보류'입니다.");
  else if (r.verdict === "수정 후 발행") notes.push(`2차 검증에서 수정이 필요하다고 나왔습니다${r.issues ? `(${r.issues}건)` : ""}. 반영하셨나요?`);
  if (r.contentHash !== contentHash($("content").value)) notes.push("검증 이후 본문이 수정되었습니다.");
  return notes.join("\n");
}

async function saveReview(opts = {}) {
  const text = $("reviewPaste").value.trim();
  if (!text) return toast("ChatGPT 답변을 붙여넣어 주세요.");
  if (!$("content").value.trim()) return toast("본문이 비어 있습니다.");
  const { verdict, issues } = parseReview(text);
  currentReview = { text, verdict, issues, contentHash: contentHash($("content").value), reviewedAt: new Date().toISOString() };
  $("reviewPaste").value = "";
  renderReview();
  $("reviewResult").classList.remove("hidden");
  $("btnReviewToggle").textContent = "검증 결과 접기";
  markDirty();
  await save({ auto: Boolean(opts.silent) });
  if (verdict === "판정 없음") toast("판정 문구를 찾지 못했습니다. 결과 내용을 직접 읽어 확인해 주세요.", 4000);
}

// 검증 결과 반영 수정본
let fixUndo = null; // 수정본 적용 전 본문

function renderFixChanges(changes) {
  const box = $("fixChanges");
  if (!changes.length) return box.classList.add("hidden");
  const applied = changes.filter((c) => !/^\(?미반영/.test(c)).length;
  box.innerHTML = `<b>수정 내역</b> (반영 ${applied}건 · 미반영 ${changes.length - applied}건)<ul>${changes
    .map((c) => `<li class="${/^\(?미반영/.test(c) ? "skip" : ""}">${inline(c, false)}</li>`)
    .join("")}</ul>`;
  box.classList.remove("hidden");
}

$("btnFixCopy").onclick = () => {
  if (!currentReview) return toast("먼저 2차 검증 결과를 저장해 주세요.");
  if (currentReview.verdict === "발행 가능" && !currentReview.issues && !confirm("검증 판정이 '발행 가능'입니다. 그래도 수정본을 만들까요?")) return;
  const body = {
    title: $("title").value.trim(),
    content: $("content").value,
    reviewText: currentReview.text,
    useStyle: $("useStyle").checked,
  };
  viaAuto("fix", body, $("btnFixCopy"), async (text) => { $("fixPaste").value = text; await $("btnFixApply").onclick(); }, () => copyRequest("fix", body));
};

$("btnFixApply").onclick = () => applyFix($("fixPaste").value.trim());

// 수정본 적용 (auto: 원클릭 진행 중 — 확인창 대신 이상하면 멈춤)
async function applyFix(text, opts = {}) {
  const auto = Boolean(opts.auto);
  if (!text) return toast("claude.ai 답변을 붙여넣어 주세요.");
  const r = parseResult(text);
  const hasBody = /===\s*본문\s*===/.test(text);
  if (!hasBody && auto) throw new Error("수정본 답변 형식이 올바르지 않아 적용하지 않았습니다.");
  if (!r.changes.length && !hasBody && !confirm("답변에서 '===본문===' 구분선을 찾지 못했습니다. 붙여넣은 내용 전체를 본문으로 바꿀까요?")) return;
  const body = r.body.trim();
  if (!body) { if (auto) throw new Error("수정본 본문이 비어 있습니다."); return toast("수정본 본문이 비어 있습니다."); }
  const before = $("content").value;
  const tooShort = body.length < before.trim().length * 0.6;
  if (tooShort && auto) throw new Error(`수정본이 원래 글보다 많이 짧아(원래 ${before.trim().length.toLocaleString()}자 → ${body.length.toLocaleString()}자) 일부가 빠졌을 수 있어 적용하지 않았습니다.`);
  if (tooShort && !confirm(`수정본이 원래 글보다 많이 짧습니다(원래 ${before.trim().length.toLocaleString()}자 → 수정본 ${body.length.toLocaleString()}자).\n일부가 빠졌을 수 있습니다. 그래도 적용할까요?`)) return;
  if (!auto && !confirm("지금 본문을 수정본으로 바꿉니다. ('수정 전으로 되돌리기'로 되돌릴 수 있습니다)\n계속할까요?")) return;
  fixUndo = before;
  $("content").value = body;
  if (r.checks) setChecks(r.checks);
  $("fixPaste").value = "";
  setMode("edit");
  updateCounter();
  renderReview(); // 검증 이후 본문 수정 경고 표시
  renderFixChanges(r.changes);
  $("btnFixUndo").classList.remove("hidden");
  markDirty();
  await save({ auto, snapshotReason: "수정본 적용 전" });
  if (auto) return;
  const left = currentChecks.filter((c) => !c.done).length;
  toast(`수정본을 적용하고 저장했습니다.${left ? ` 확인할 내용 ${left}개가 남아 있습니다.` : ""} 수정 내역을 확인한 뒤, 가능하면 2차 검증을 한 번 더 해 주세요.`, 5500);
}

$("btnFixUndo").onclick = async () => {
  if (fixUndo == null) return;
  if (!confirm("수정본 적용 전 본문으로 되돌릴까요?")) return;
  $("content").value = fixUndo;
  fixUndo = null;
  updateCounter();
  renderReview();
  $("btnFixUndo").classList.add("hidden");
  $("fixChanges").classList.add("hidden");
  markDirty();
  await save({ snapshotReason: "되돌리기 전" });
  toast("수정 전 본문으로 되돌렸습니다.");
};

$("btnReviewCopy").onclick = () => {
  const content = $("content").value;
  if (!content.trim()) return toast("검증할 본문이 없습니다.");
  const body = { title: $("title").value.trim(), topic: $("topic").value.trim(), content, checks: currentChecks };
  viaAuto("review", body, $("btnReviewCopy"), async (text) => { $("reviewPaste").value = text; await saveReview(); }, () => copyRequest("review", body, CHATGPT_URL, "ChatGPT"));
};
$("btnReviewSave").onclick = saveReview;
$("btnReviewToggle").onclick = () => {
  const box = $("reviewResult");
  box.classList.toggle("hidden");
  $("btnReviewToggle").textContent = box.classList.contains("hidden") ? "검증 결과 보기" : "검증 결과 접기";
};
$("content").addEventListener("input", () => currentReview && $("reviewStale").classList.toggle("hidden", currentReview.contentHash === contentHash($("content").value)));

// ───────────── AI ─────────────

async function draft() {
  const topic = $("topic").value.trim();
  if (!topic) return toast("주제를 입력해 주세요.");
  if (mode === "copy") {
    const body = draftRequestBody();
    return viaAuto("draft", body, $("btnDraft"), (text) => { $("pasteResult").value = text; applyResult(); }, () => copyRequest("draft", body));
  }
  if ($("content").value.trim() && !confirm("지금 본문을 AI 초안으로 바꿉니다. 계속할까요?")) return;

  const btn = $("btnDraft");
  const status = $("draftStatus");
  btn.disabled = true;
  status.className = "status";
  status.textContent = "작성 중… (1~3분 걸릴 수 있습니다)";
  $("sources").classList.add("hidden");
  setMode("edit");
  $("content").value = "";
  let gotText = false;

  try {
    const res = await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftRequestBody()),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "요청 실패");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let failed = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === "text") {
          if (!gotText) { status.textContent = "작성 중…"; gotText = true; }
          $("content").value += ev.text;
          $("content").scrollTop = $("content").scrollHeight;
          updateCounter();
        } else if (ev.type === "status") {
          status.textContent = ev.text;
        } else if (ev.type === "sources") {
          $("sources").innerHTML = "<b>참고한 공식 자료</b><br>" + ev.sources.map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>`).join("<br>");
          $("sources").classList.remove("hidden");
        } else if (ev.type === "error") {
          failed = true;
          status.className = "status error";
          status.textContent = ev.text;
        }
      }
    }
    if (!failed) {
      const full = $("content").value;
      const cut = full.search(/===\s*확인할\s*내용\s*===/);
      if (cut >= 0) {
        setChecks(parseResult(full.slice(cut)).checks || []);
        $("content").value = full.slice(0, cut).trim();
        updateCounter();
      }
      const left = currentChecks.filter((c) => !c.done).length;
      status.textContent = left ? `완료 — 본문 아래 '발행 전 확인할 내용' ${left}개를 꼭 확인해 주세요.` : "완료 — 내용을 검토해 주세요.";
      markDirty();
      if (!$("title").value.trim()) suggestMeta(true);
    }
  } catch (e) {
    status.className = "status error";
    status.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

async function suggestMeta(auto = false) {
  const content = $("content").value;
  const topic = $("topic").value.trim();
  if (!content.trim() && !topic) return toast("주제나 본문을 먼저 입력해 주세요.");
  if (mode === "copy") {
    const body = { topic, content, useStyle: $("useStyle").checked };
    return viaAuto("meta", body, $("btnMeta"), (text) => { $("pasteResult").value = text; applyResult(); }, async () => {
      if (await copyRequest("meta", body)) setTimeout(() => toast("답변을 복사해 왼쪽 'claude.ai 답변 붙여넣기' 칸에 넣고 적용을 누르세요.", 4500), 4600);
    });
  }
  const btn = $("btnMeta");
  btn.disabled = true;
  btn.textContent = "추천 받는 중…";
  try {
    const { titles, tags } = await api("/api/meta", { method: "POST", body: { topic, content, useStyle: $("useStyle").checked } });
    showTitleChips(titles);
    if (!$("tags").value.trim() || !auto) $("tags").value = tags.join(", ");
    if (!$("title").value.trim() && titles[0]) $("title").value = titles[0];
    markDirty();
    toast("제목 후보를 클릭하면 바꿀 수 있습니다.");
  } catch (e) {
    toast(e.message, 3500);
  } finally {
    btn.disabled = false;
    btn.textContent = "제목·태그 추천받기";
  }
}

// ───────────── 글 목록 ─────────────

async function loadPosts() {
  posts = await api("/api/posts");
  renderPosts();
}

function renderPosts() {
  const f = $("filterStatus").value;
  const q = $("filterText").value.trim().toLowerCase();
  const rows = posts.filter((p) => (!f || p.status === f) && (!q || `${p.title} ${p.topic}`.toLowerCase().includes(q)));
  $("postRows").innerHTML = rows
    .map(
      (p) => `<tr data-id="${p.id}">
        <td class="title">${escapeHtml(p.title || "(제목 없음)")}${p.naverUrl ? ` <a href="${escapeHtml(p.naverUrl)}" target="_blank" rel="noopener" class="small">↗</a>` : ""}</td>
        <td><span class="pill ${p.status}">${STATUS_LABEL[p.status]}</span>${p.review ? ` <span class="pill ${{ "발행 가능": "ok", "수정 후 발행": "fix", "발행 보류": "stop" }[p.review.verdict] || "draft"}" title="2차 검증">${p.review.verdict === "판정 없음" ? "검증함" : p.review.verdict}</span>` : ""}</td>
        <td>${p.scheduledAt ? fmtDate(p.scheduledAt) : ""}</td>
        <td class="muted">${fmtDate(p.updatedAt)}</td>
        <td><button class="ghost danger small" data-del="${p.id}">삭제</button></td>
      </tr>`
    )
    .join("");
  $("emptyList").classList.toggle("hidden", rows.length > 0);

  const today = todayStr();
  const up = posts
    .filter((p) => p.status === "scheduled" && p.scheduledAt)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 5);
  $("upcoming").innerHTML = up
    .map((p) => {
      const late = p.scheduledAt < today;
      const when = p.scheduledAt === today ? "오늘" : late ? "지남" : fmtDate(p.scheduledAt);
      return `<div class="item ${late ? "late" : ""}" data-id="${p.id}"><b>${when}</b> · ${escapeHtml(p.title || "(제목 없음)")}</div>`;
    })
    .join("");
}

async function openPost(id) {
  if (!confirmDiscard()) return;
  const p = posts.find((x) => x.id === id) || (await api(`/api/posts/${id}`));
  fillForm(p);
  showView("write");
}

async function deletePost(id) {
  const p = posts.find((x) => x.id === id);
  if (!confirm(`"${p?.title || "(제목 없음)"}" 글을 삭제할까요?\n(복구가 필요하면 data/trash.json에 보관됩니다)`)) return;
  await api(`/api/posts/${id}`, { method: "DELETE" });
  if (currentId === id) fillForm(null);
  toast("삭제했습니다.");
  loadPosts();
}

async function restore(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!confirm(`백업 파일로 복원합니다.\n글 ${data.posts?.length ?? 0}개, 템플릿 ${data.templates?.length ?? 0}개\n\n지금 저장된 글은 백업 내용으로 바뀝니다. (현재 상태는 data 폴더에 따로 보관됩니다)\n계속할까요?`)) return;
    await api("/api/backup", { method: "POST", body: data });
    toast("복원했습니다.");
    await Promise.all([loadPosts(), loadTemplates(), loadSamples()]);
  } catch (e) {
    toast(e.message || "복원 실패", 3500);
  }
}

// ───────────── 템플릿 ─────────────

let editingTpl = null;

async function loadTemplates() {
  templates = await api("/api/templates");
  const sel = $("templateSelect");
  const prev = sel.value;
  sel.innerHTML = `<option value="">자유 구성</option>` + templates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  if (templates.some((t) => t.id === prev)) sel.value = prev;
  else if (templates[0] && !prev) sel.value = templates[0].id;

  $("tplList").innerHTML = templates
    .map(
      (t) => `<div class="tpl"><div class="tpl-top"><b>${escapeHtml(t.name)}</b>
        <span><button class="ghost small" data-edit="${t.id}">수정</button> <button class="ghost danger small" data-tdel="${t.id}">삭제</button></span></div>
        <pre>${escapeHtml(t.guide)}</pre></div>`
    )
    .join("");
}

function editTemplate(t) {
  editingTpl = t?.id || null;
  $("tplFormTitle").textContent = t ? "템플릿 수정" : "새 템플릿";
  $("tplName").value = t?.name || "";
  $("tplGuide").value = t?.guide || "";
  $("btnTplCancel").classList.toggle("hidden", !t);
}

async function saveTemplate() {
  const body = { name: $("tplName").value.trim(), guide: $("tplGuide").value };
  if (!body.name) return toast("템플릿 이름을 입력해 주세요.");
  try {
    if (editingTpl) await api(`/api/templates/${editingTpl}`, { method: "PUT", body });
    else await api("/api/templates", { method: "POST", body });
    editTemplate(null);
    await loadTemplates();
    toast("템플릿을 저장했습니다.");
  } catch (e) {
    toast(e.message, 3500);
  }
}

// ───────────── 내 글 학습 ─────────────

let samples = [];
let sampleCharLimit = 15000;
let editingSample = null;

async function loadSamples() {
  const data = await api("/api/samples");
  samples = data.samples;
  sampleCharLimit = data.charLimit;
  const style = await api("/api/style");
  $("styleProfile").value = style.profile || "";
  $("styleMeta").textContent = style.analyzedAt ? `분석: ${fmtDate(style.analyzedAt)} · 글 ${style.sampleCount ?? "?"}개 기준` : "";
  renderSamples();
}

function usedSamples() {
  // 서버와 같은 규칙: 최근 글부터, 분량 상한 안에서
  const picked = [];
  let total = 0;
  for (const s of samples.filter((x) => x.use)) {
    if (picked.length && total + s.content.length > sampleCharLimit) continue;
    picked.push(s);
    total += Math.min(s.content.length, sampleCharLimit);
  }
  return picked;
}

function renderSamples() {
  const used = usedSamples();
  const usedIds = new Set(used.map((s) => s.id));
  $("sampleCount").textContent = samples.length ? `(${samples.length}개)` : "";
  const skipped = samples.filter((s) => s.use && !usedIds.has(s.id)).length;
  $("sampleUsage").textContent = samples.length
    ? `글을 쓸 때 ${used.length}개가 예시로 쓰입니다.` + (skipped ? ` 분량 한도(약 ${sampleCharLimit.toLocaleString()}자)를 넘어 ${skipped}개는 빠집니다. 꼭 쓸 글만 '반영'을 켜 두세요.` : "")
    : "";
  $("sampleList").innerHTML = samples.length
    ? samples
        .map(
          (s) => `<div class="tpl ${s.use ? "" : "off"}"><div class="tpl-top">
            <b>${escapeHtml(s.title)}</b>
            <span>
              <label class="check"><input type="checkbox" data-use="${s.id}" ${s.use ? "checked" : ""}/> 반영${s.use && !usedIds.has(s.id) ? " (분량 초과로 제외)" : ""}</label>
            </span></div>
            <div class="muted small">${s.content.length.toLocaleString()}자 · 추가 ${fmtDate(s.createdAt)}</div>
            <pre>${escapeHtml(s.content.slice(0, 180))}${s.content.length > 180 ? "…" : ""}</pre>
            <div class="actions" style="margin-top:8px">
              <button class="ghost small" data-sedit="${s.id}">수정</button>
              <button class="ghost danger small" data-sdel="${s.id}">삭제</button>
            </div></div>`
        )
        .join("")
    : '<p class="muted">아직 추가한 글이 없습니다.</p>';
  updateStyleToggle();
}

function updateStyleToggle() {
  const n = usedSamples().length;
  const hasProfile = $("styleProfile").value.trim().length > 0;
  const ready = n > 0 || hasProfile;
  const box = $("useStyle");
  box.disabled = !ready;
  if (!ready) box.checked = false;
  else if (!updateStyleToggle.touched) box.checked = true;
  $("styleInfo").textContent = ready
    ? `내 글 ${n}개${hasProfile ? " + 말투 요약" : ""}을 참고합니다`
    : "'내 글 학습'에 글을 추가하면 사용할 수 있습니다";
}

function editSample(s) {
  editingSample = s?.id || null;
  $("sampleFormTitle").textContent = s ? "글 수정" : "글 추가";
  $("sampleTitle").value = s?.title || "";
  $("sampleContent").value = s?.content || "";
  $("btnSampleCancel").classList.toggle("hidden", !s);
  updateSampleLen();
  if (s) $("sampleTitle").scrollIntoView({ behavior: "smooth", block: "center" });
}

function updateSampleLen() {
  const n = $("sampleContent").value.trim().length;
  $("sampleLen").textContent = n ? `${n.toLocaleString()}자${n < 200 ? " — 200자 이상이어야 합니다" : ""}` : "";
}

async function saveSample() {
  const body = { title: $("sampleTitle").value.trim(), content: $("sampleContent").value.trim() };
  if (body.content.length < 200) return toast("본문을 200자 이상 넣어 주세요.");
  if (/\d{6}\s*-\s*[1-4]\d{6}/.test(body.content) && !confirm("주민등록번호처럼 보이는 숫자가 있습니다. 지우지 않고 저장할까요?")) return;
  try {
    if (editingSample) await api(`/api/samples/${editingSample}`, { method: "PUT", body });
    else await api("/api/samples", { method: "POST", body });
    editSample(null);
    await loadSamples();
    toast("저장했습니다. 글을 추가·수정한 뒤에는 '말투 분석하기'를 다시 눌러 주세요.", 3500);
  } catch (e) {
    toast(e.message, 3500);
  }
}

async function analyzeStyle() {
  if (!usedSamples().length) return toast("'반영'으로 켜 둔 글이 없습니다.");
  if (mode === "copy") return viaAuto("style", {}, $("btnAnalyze"), async (text) => { $("styleProfile").value = text; await saveStyle(); }, () => copyRequest("style"));
  if ($("styleProfile").value.trim() && !confirm("지금 말투 요약을 새 분석 결과로 바꿉니다. 계속할까요?")) return;
  const btn = $("btnAnalyze");
  btn.disabled = true;
  btn.textContent = "분석 중… (1분 정도)";
  try {
    const style = await api("/api/style/analyze", { method: "POST", body: {} });
    $("styleProfile").value = style.profile;
    $("styleMeta").textContent = `분석: ${fmtDate(style.analyzedAt)} · 글 ${style.sampleCount}개 기준`;
    updateStyleToggle();
    toast("말투 분석이 끝났습니다. 내용을 읽어 보고 필요하면 고친 뒤 '요약 저장'을 눌러 주세요.", 4000);
  } catch (e) {
    toast(e.message, 3500);
  } finally {
    btn.disabled = false;
    btn.textContent = "말투 분석하기";
  }
}

async function saveStyle() {
  try {
    await api("/api/style", { method: "PUT", body: { profile: $("styleProfile").value } });
    updateStyleToggle();
    toast("말투 요약을 저장했습니다.");
  } catch (e) {
    toast(e.message, 3500);
  }
}

$("sampleContent").addEventListener("input", updateSampleLen);
$("btnSampleSave").onclick = saveSample;
$("btnSampleCancel").onclick = () => editSample(null);
$("btnAnalyze").onclick = analyzeStyle;
$("btnStyleSave").onclick = saveStyle;
$("useStyle").addEventListener("change", () => (updateStyleToggle.touched = true));
$("sampleList").onclick = async (e) => {
  const ed = e.target.closest("[data-sedit]");
  if (ed) return editSample(samples.find((s) => s.id === ed.dataset.sedit));
  const del = e.target.closest("[data-sdel]");
  if (del) {
    const s = samples.find((x) => x.id === del.dataset.sdel);
    if (!confirm(`"${s?.title}" 글을 학습 목록에서 삭제할까요?`)) return;
    await api(`/api/samples/${del.dataset.sdel}`, { method: "DELETE" });
    if (editingSample === del.dataset.sdel) editSample(null);
    return loadSamples();
  }
};
$("sampleList").onchange = async (e) => {
  const box = e.target.closest("[data-use]");
  if (!box) return;
  await api(`/api/samples/${box.dataset.use}`, { method: "PUT", body: { use: box.checked } });
  await loadSamples();
};

// ───────────── 추천 주제 TOP 5 ─────────────

let topicsDoc = null;
let topicsRenderedAt = null;
let tickerIdx = 0;
let topicsPoll = null;

function timeAgo(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
}

function sparkline(series) {
  const w = 100, h = 26;
  const max = Math.max(...series, 1);
  const pts = series.map((v, i) => `${((i / Math.max(series.length - 1, 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

function moveBadge(t, hasHistory) {
  if (!hasHistory) return "";
  if (t.prevRank == null) return '<span class="move new">NEW</span>';
  const d = t.prevRank - t.rank;
  if (d > 0) return `<span class="move up">▲${d}</span>`;
  if (d < 0) return `<span class="move down">▼${-d}</span>`;
  return '<span class="move">–</span>';
}

function renderTopics(state) {
  const list = $("topicList");
  const doc = state.doc;
  $("regionName").textContent = state.region;
  $("btnTopicsRefresh").disabled = state.refreshing || !state.aiReady;
  $("btnTopicsRefresh").textContent = state.refreshing ? "조사 중…" : "새로 고침";

  if (!doc) {
    list.innerHTML = state.refreshing || state.aiReady
      ? '<li class="skeleton"></li><li class="skeleton"></li><li class="skeleton"></li><li class="skeleton"></li><li class="skeleton"></li>'
      : "";
    $("topicsTime").textContent = "";
    $("topicsNote").textContent = !state.aiReady
      ? "'🔄 갱신'을 누르면 바로 추천 주제가 표시됩니다(무료)."
      : state.error || "최신 소식과 세금 일정을 조사하고 있습니다. 1~3분 걸립니다.";
    $("tickerText").textContent = state.aiReady ? "추천 주제 조사 중…" : "추천 주제 없음 — 🔄 갱신을 눌러 주세요";
    $("topicSources").classList.add("hidden");
    return;
  }

  const hasHistory = doc.topics.some((t) => t.prevRank != null);
  const changed = topicsRenderedAt && topicsRenderedAt !== doc.generatedAt;
  topicsRenderedAt = doc.generatedAt;
  list.innerHTML = doc.topics
    .map((t, i) => {
      const meter = t.trend
        ? `${sparkline(t.trend.series)}<span>지수 ${t.trend.level}${t.trend.change != null ? ` <b class="chg ${t.trend.change >= 0 ? "up" : "down"}">${t.trend.change >= 0 ? "▲" : "▼"}${Math.abs(t.trend.change)}%</b>` : ""}</span>`
        : `<div class="bar"><i style="width:${t.interest}%"></i></div><span>${doc.mode === "auto" ? "점수" : "예상"} ${t.interest}</span>`;
      return `<li class="topic ${changed ? "flash" : ""}">
        <div class="rank">${t.rank}${moveBadge(t, hasHistory)}</div>
        <div class="topic-body">
          <div class="topic-title"><span class="topic-cat">${escapeHtml(t.category)}</span>${escapeHtml(t.title)}${t.basis ? `<span class="topic-basis">${escapeHtml(t.basis)}</span>` : doc.mode === "ai" ? '<span class="topic-basis">AI 조사</span>' : ""}</div>
          <div class="topic-reason">${escapeHtml(t.reason)}</div>
          <div class="meter" title="${t.trend ? "네이버 데이터랩 최근 4주 검색 추이 (5개 주제끼리 비교한 상대값, 전국 기준). 변화율은 최근 7일과 그 전 7일 비교" : "AI가 추정한 예상 관심도입니다. 실제 검색량이 아닙니다."}">${meter}</div>
          <div class="topic-actions"><button data-topic="${i}">이 주제로 쓰기</button></div>
        </div>
      </li>`;
    })
    .join("");

  const notes = [];
  if (doc.mode === "auto") {
    notes.push("자동 갱신(무료·AI 미사용): 세무달력 기한 + 시기별 주제 + 지역 뉴스로 계산");
    notes.push(doc.newsError ? `지역 뉴스를 불러오지 못해 달력·시기별 주제로만 추천했습니다(${doc.newsError})` : (doc.newsCount ? `세금과 관련된 지역 뉴스 ${doc.newsCount}건 반영` : "세금과 관련된 최근 지역 뉴스 없음"));
  }
  notes.push(doc.topics.some((t) => t.trend) ? "그래프: 네이버 데이터랩 최근 4주 검색 추이(전국, 상대값)" : doc.mode === "auto" ? "막대: 앱이 계산한 추천 점수(실제 검색량 아님)" : "막대: AI 추정 관심도(실제 검색량 아님)");
  if (doc.trendError) notes.push(doc.trendError);
  else if (!state.datalab) notes.push("네이버 데이터랩 키를 넣으면 실제 검색 추이로 표시됩니다");
  if (state.error) notes.push(`최근 갱신 실패: ${state.error}`);
  if (!state.aiReady) {
    const days = (Date.now() - new Date(doc.generatedAt).getTime()) / 86400_000;
    if (days >= 3) notes.unshift(`${Math.floor(days)}일 전 목록입니다. '🔄 갱신'을 눌러 새로 받아 보세요`);
  }
  notes.push("날짜·기한은 글 쓰기 전 꼭 확인하세요");
  $("topicsNote").textContent = notes.join(" · ");
  $("topicsTime").textContent = `${timeAgo(doc.generatedAt)} 갱신${state.refreshing ? " · 새로 조사 중…" : ""}`;

  if (doc.sources?.length) {
    $("topicSourceList").innerHTML = doc.sources.map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>`).join("");
    $("topicSources").classList.remove("hidden");
  } else $("topicSources").classList.add("hidden");
  showTicker(false);
}

function showTicker(advance = true) {
  const topics = topicsDoc?.doc?.topics;
  if (!topics?.length) return;
  if (advance) tickerIdx = (tickerIdx + 1) % topics.length;
  const t = topics[tickerIdx % topics.length];
  const el = $("tickerText");
  el.classList.remove("roll");
  void el.offsetWidth; // 애니메이션 다시 시작
  el.textContent = `${t.rank}. ${t.title}`;
  el.classList.add("roll");
}

async function loadTopics() {
  try {
    topicsDoc = await api("/api/topics");
    renderTopics(topicsDoc);
  } catch (e) {
    $("topicsNote").textContent = e.message;
  }
  // 조사 중이면 20초마다, 아니면 10분마다 확인
  clearTimeout(topicsPoll);
  topicsPoll = setTimeout(loadTopics, topicsDoc?.refreshing ? 20_000 : 600_000);
}

async function autoTopics(silent = false) {
  const btn = $("btnTopicsAuto");
  btn.disabled = true;
  btn.textContent = "갱신 중…";
  try {
    const { doc } = await api("/api/topics/auto", { method: "POST", body: {} });
    if (!silent) toast(doc.newsError ? "추천 주제를 갱신했습니다. (지역 뉴스는 불러오지 못해 달력·시기별 주제로 추천)" : doc.newsCount ? `추천 주제를 갱신했습니다. 관련 지역 뉴스 ${doc.newsCount}건을 반영했습니다.` : "추천 주제를 갱신했습니다.", 3500);
  } catch (e) {
    if (!silent) toast(e.message, 3500);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 갱신";
  }
  await loadTopics();
}

async function refreshTopics() {
  if (!confirm("AI로 최신 소식을 정밀 조사합니다. 1~3분 걸리고 API 요금이 나옵니다. 진행할까요?")) return;
  topicsDoc = { ...(topicsDoc || {}), refreshing: true };
  renderTopics(topicsDoc);
  try {
    await api("/api/topics/refresh", { method: "POST", body: {} });
    toast("추천 주제를 새로 만들었습니다.");
  } catch (e) {
    toast(e.message, 4000);
  }
  loadTopics();
}

async function changeRegion() {
  const region = prompt("추천 주제를 찾을 지역을 입력해 주세요. (예: 안성시, 평택시)", topicsDoc?.region || "안성시");
  if (!region || !region.trim() || region.trim() === topicsDoc?.region) return;
  try {
    await api("/api/topics/region", { method: "PUT", body: { region: region.trim() } });
    toast(mode === "api" ? `${region.trim()} 기준으로 새로 조사합니다.` : `지역을 ${region.trim()}(으)로 바꿨습니다. '요청문 복사'로 새 추천을 받아 보세요.`, 4000);
    loadTopics();
  } catch (e) {
    toast(e.message, 3500);
  }
}

function useTopic(i) {
  const t = topicsDoc?.doc?.topics?.[i];
  if (!t) return;
  if ($("topic").value.trim() && $("topic").value.trim() !== t.title && !confirm("작성 중인 주제와 메모를 이 추천 주제로 바꿀까요?")) return;
  $("topic").value = t.title;
  $("memo").value = `글 방향: ${t.angle}\n추천 이유: ${t.reason}\n검색어: ${t.keywords.join(", ")}`;
  $("topic").scrollIntoView({ behavior: "smooth", block: "center" });
  $("topic").focus();
  toast("주제와 메모를 채웠습니다. 확인 후 'AI 초안 작성'을 눌러 주세요.", 3000);
}

$("topicList").onclick = (e) => {
  const b = e.target.closest("[data-topic]");
  if (b) useTopic(Number(b.dataset.topic));
};
$("btnTopicsRefresh").onclick = refreshTopics;
$("btnTopicsAuto").onclick = () => autoTopics(false);
$("btnTopicsCopy").onclick = () => viaAuto("topics", {}, $("btnTopicsCopy"), async (text) => { $("topicPaste").value = text; await $("btnTopicsImport").onclick(); }, () => copyRequest("topics"));
$("btnTopicsPaste").onclick = () => {
  $("topicPasteBox").classList.toggle("hidden");
  if (!$("topicPasteBox").classList.contains("hidden")) $("topicPaste").focus();
};
$("btnTopicsPasteCancel").onclick = () => $("topicPasteBox").classList.add("hidden");
$("btnTopicsImport").onclick = async () => {
  const text = $("topicPaste").value.trim();
  if (!text) return toast("claude.ai 답변을 붙여넣어 주세요.");
  try {
    await api("/api/topics/import", { method: "POST", body: { text } });
    $("topicPaste").value = "";
    $("topicPasteBox").classList.add("hidden");
    toast("추천 주제를 갱신했습니다.");
    loadTopics();
  } catch (e) {
    toast(e.message, 4000);
  }
};
$("regionBtn").onclick = changeRegion;
$("ticker").onclick = () => {
  showView("write");
  const topics = topicsDoc?.doc?.topics;
  $("trendsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  if (topics?.length) {
    const li = $("topicList").children[tickerIdx % topics.length];
    li?.classList.remove("flash");
    void li?.offsetWidth;
    li?.classList.add("flash");
  }
};
setInterval(() => showTicker(true), 3500);
setInterval(() => topicsDoc?.doc && ($("topicsTime").textContent = `${timeAgo(topicsDoc.doc.generatedAt)} 갱신${topicsDoc.refreshing ? " · 새로 조사 중…" : ""}`), 60_000);

// ───────────── 세무달력 ─────────────

const cal = { year: new Date().getFullYear(), month: new Date().getMonth() + 1, sel: null, data: { extraHolidays: {}, events: [] } };
const SCOPE_CLS = { 국세: "tax", 지방세: "local", "신청·안내": "apply" };

function calFilters() {
  const f = {};
  document.querySelectorAll("#calFilters input").forEach((i) => (f[i.dataset.f] = i.checked));
  return f;
}

function md(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}(${weekday(dateStr)})`;
}

function dday(dateStr) {
  const t = new Date(todayStr());
  const d = new Date(dateStr);
  const n = Math.round((d - t) / 86400000);
  return n === 0 ? "D-day" : n > 0 ? `D-${n}` : `D+${-n}`;
}

// 달력에 표시할 항목 (해당 연도 앞뒤 포함)
function calItems() {
  const extra = cal.data.extraHolidays;
  const f = calFilters();
  const items = [];
  for (const y of [cal.year - 1, cal.year, cal.year + 1]) {
    for (const ev of eventsForYear(y, extra)) {
      if (!f[ev.scope]) continue;
      if (ev.level < 2 && !f["참고"]) continue;
      items.push({ date: ev.due, type: "due", ev });
      if (ev.start) items.push({ date: ev.start, type: "start", ev });
      if (f["글추천"]) for (const idea of postIdeas(ev, extra)) items.push({ date: idea.date, type: "idea", ev, idea });
    }
  }
  if (f["내글"]) {
    for (const p of posts) if (p.scheduledAt) items.push({ date: p.scheduledAt, type: "post", post: p });
    for (const e of cal.data.events) items.push({ date: e.date, type: "custom", e });
  }
  return items;
}

function shortName(name) {
  return name.replace(/\(.*?\)/g, "").replace(/부가가치세/g, "부가세").replace(/·?(확정신고|예정신고|신고·납부|신고납부|신고|납부|정기 신청|신청)/g, "").replace(/\s+/g, " ").trim();
}

function chipHtml(it) {
  const cls = it.ev ? SCOPE_CLS[it.ev.scope] : "";
  if (it.type === "due") return `<span class="ev ${it.ev.level < 2 ? "minor" : cls}" title="${escapeHtml(it.ev.name)}">${it.ev.kind === "info" ? "" : "마감 "}${escapeHtml(it.ev.name)}</span>`;
  if (it.type === "start") return `<span class="ev start ${cls}" title="${escapeHtml(it.ev.name)} 시작">시작 ${escapeHtml(it.ev.name)}</span>`;
  if (it.type === "idea") return `<span class="ev idea" title="${escapeHtml(it.idea.title)}">✎ ${escapeHtml(shortName(it.ev.name))} ${escapeHtml(it.idea.type)}</span>`;
  if (it.type === "post") return `<span class="ev mine" title="${escapeHtml(it.post.title || it.post.topic)}">📝 ${escapeHtml(it.post.title || it.post.topic || "(제목 없음)")}</span>`;
  return `<span class="ev mine" title="${escapeHtml(it.e.title)}">📌 ${escapeHtml(it.e.title)}</span>`;
}

function renderCalendar() {
  const { year, month } = cal;
  $("calTitle").textContent = `${year}년 ${month}월`;
  const warn = $("calWarn");
  if (!hasHolidayData(year)) {
    warn.textContent = `${year}년 공휴일 자료가 앱에 없습니다. 토·일요일만 반영해 기한을 계산했으니, 설·추석 등 공휴일에 따른 연장 여부는 꼭 확인해 주세요. (휴일 추가로 직접 넣을 수 있습니다)`;
    warn.classList.remove("hidden");
  } else warn.classList.add("hidden");

  const items = calItems();
  const byDate = {};
  for (const it of items) (byDate[it.date] ||= []).push(it);
  const order = { due: 0, start: 1, custom: 2, post: 3, idea: 4 };

  const first = new Date(year, month - 1, 1);
  const startDate = new Date(year, month - 1, 1 - first.getDay());
  const today = todayStr();
  let html = ["일", "월", "화", "수", "목", "금", "토"].map((d, i) => `<div class="cal-dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    if (i >= 35 && d.getMonth() !== month - 1) break;
    const ds = ymd(d);
    const hn = holidayName(ds, cal.data.extraHolidays);
    const off = d.getDay() === 0 || Boolean(hn);
    const list = (byDate[ds] || []).sort((a, b) => order[a.type] - order[b.type]);
    const shown = list.slice(0, 4).map(chipHtml).join("");
    html += `<div class="cal-cell ${d.getMonth() !== month - 1 ? "other" : ""} ${ds === today ? "today" : ""} ${ds === cal.sel ? "selected" : ""}" data-date="${ds}">
      <div class="cal-num ${off ? "off" : ""}">${d.getDate()}${hn ? `<span class="hname">${escapeHtml(hn)}</span>` : ""}</div>
      ${shown}${list.length > 4 ? `<div class="ev-more">+${list.length - 4}개 더</div>` : ""}
    </div>`;
  }
  $("calGrid").innerHTML = html;
  renderCalSide(items);
  renderHolidayList();
}

function taxItemHtml(ev, idx) {
  const ideas = postIdeas(ev, cal.data.extraHolidays);
  const range = ev.start ? `${md(ev.start)} ~ ${md(ev.due)}` : `${md(ev.due)}${ev.kind === "info" ? "" : " 마감"}`;
  const past = ev.due < todayStr();
  return `<div class="side-item ${SCOPE_CLS[ev.scope]}">
    <span class="dday ${past ? "past" : ""}">${dday(ev.due)}</span>
    <b>${escapeHtml(ev.name)}</b>${ev.check ? '<span class="chk">확인 필요</span>' : ""}
    <div class="meta">${ev.scope} · ${range}${ev.shifted ? ` <span title="기한이 쉬는 날이라 다음 날로 연장">(법정 ${md(ev.legal)} → 연장)</span>` : ""}</div>
    <div class="meta">대상: ${escapeHtml(ev.who)}</div>
    <div class="meta">근거: ${escapeHtml(ev.basis)}</div>
    ${ideas.length ? `<div class="ideas">${ideas.map((i) => `✎ <b>${md(i.date)}</b> ${escapeHtml(i.type)} 글 — <span class="muted">${escapeHtml(i.why)}</span>`).join("<br>")}</div>` : ""}
    <div class="actions">
      <button data-cal-write="${idx}">이 주제로 쓰기</button>
      ${ideas.map((i, k) => `<button class="ghost" data-cal-plan="${idx}:${k}">${md(i.date)} 발행 예정 등록</button>`).join("")}
    </div>
  </div>`;
}

let calSideEvents = [];

function renderCalSide(items) {
  const { year, month } = cal;
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  let list;
  if (cal.sel) {
    $("sideTitle").textContent = `${md(cal.sel)} 일정`;
    list = items.filter((it) => it.date === cal.sel);
  } else {
    $("sideTitle").textContent = `${month}월 일정과 글 추천`;
    list = items.filter((it) => it.date.startsWith(prefix));
  }
  // 세무 일정(마감 기준 한 번씩) + 그 일정으로 이어지는 글 추천
  const evs = [];
  const seen = new Set();
  for (const it of list) {
    if (!it.ev || seen.has(it.ev.key)) continue;
    if (!cal.sel && it.type !== "due" && !(it.type === "idea" || it.type === "start")) continue;
    seen.add(it.ev.key);
    evs.push(it.ev);
  }
  evs.sort((a, b) => a.due.localeCompare(b.due));
  calSideEvents = evs;
  let html = evs.map((ev, i) => taxItemHtml(ev, i)).join("");
  for (const it of list.filter((x) => x.type === "post")) {
    html += `<div class="side-item mine"><b>📝 ${escapeHtml(it.post.title || it.post.topic || "(제목 없음)")}</b>
      <div class="meta">${md(it.date)} 발행 예정 · ${STATUS_LABEL[it.post.status]}</div>
      <div class="actions"><button data-open-post="${it.post.id}">글 열기</button></div></div>`;
  }
  for (const it of list.filter((x) => x.type === "custom")) {
    html += `<div class="side-item mine"><b>📌 ${escapeHtml(it.e.title)}</b><div class="meta">${md(it.date)}</div>
      <div class="actions"><button class="ghost danger" data-del-ev="${it.e.id}">삭제</button></div></div>`;
  }
  $("sideList").innerHTML = html || '<p class="muted">표시할 일정이 없습니다.</p>';
  if (cal.sel) $("sideList").insertAdjacentHTML("afterbegin", '<button class="ghost small" id="calShowMonth">← 이번 달 전체 보기</button>');
}

function renderHolidayList() {
  const entries = Object.entries(cal.data.extraHolidays).sort();
  $("holList").innerHTML = entries.length
    ? entries.map(([d, n]) => `<div>${d} ${escapeHtml(n)} <button class="ghost danger small" data-del-hol="${d}">삭제</button></div>`).join("")
    : "";
}

async function loadCalendar() {
  try {
    const [data, list] = await Promise.all([api("/api/calendar"), api("/api/posts")]);
    cal.data = data;
    posts = list;
  } catch (e) {
    toast(e.message, 3500);
  }
  renderCalendar();
}

function calWrite(ev) {
  if (!confirmDiscard()) return;
  fillForm(null);
  const [y, m, d] = ev.due.split("-").map(Number);
  $("topic").value = `${ev.topic} (${y}년 ${m}월 ${d}일 ${ev.kind === "info" ? "" : "기한"})`.replace(" )", ")");
  $("memo").value = [
    `일정: ${ev.name}`,
    ev.start ? `기간: ${ev.start} ~ ${ev.due}` : `기한: ${ev.due}(${weekday(ev.due)})`,
    ev.shifted ? `법정 기한 ${ev.legal}(${weekday(ev.legal)})이 쉬는 날이라 ${ev.due}(${weekday(ev.due)})로 연장됨 — 반드시 글에 정확히 표시` : "",
    `대상: ${ev.who}`,
    `참고 근거(확인용 — 본문에 법령명·조문은 쓰지 말 것): ${ev.basis}`,
    "기한·대상은 최신 자료로 다시 확인하고, 불확실한 수치는 본문에 쓰지 말고 '확인할 내용'에 적을 것",
  ].filter(Boolean).join("\n");
  const tpl = templates.find((t) => t.id === "tpl-deadline");
  if (tpl) $("templateSelect").value = tpl.id;
  showView("write");
  $("topic").scrollIntoView({ behavior: "smooth", block: "center" });
  toast("주제와 메모를 채웠습니다. '신고기한 안내' 템플릿을 골라 두었습니다.", 3500);
}

async function calPlan(ev, idea) {
  const dup = posts.find((p) => p.scheduledAt === idea.date && p.topic.includes(ev.topic));
  if (dup && !confirm("같은 날짜에 같은 주제의 예정 글이 이미 있습니다. 그래도 등록할까요?")) return;
  if (!confirm(`${md(idea.date)}에 '${idea.title}' 글을 발행 예정으로 등록할까요?\n(글 목록에 빈 초안이 만들어집니다)`)) return;
  try {
    await api("/api/posts", { method: "POST", body: { title: idea.title, topic: ev.topic, content: "", status: "scheduled", scheduledAt: idea.date, tags: [] } });
    toast("발행 예정으로 등록했습니다. 글 목록에서 열어 작성할 수 있습니다.", 3500);
    loadCalendar();
  } catch (e) {
    toast(e.message, 3500);
  }
}

$("calPrev").onclick = () => { cal.month--; if (cal.month < 1) { cal.month = 12; cal.year--; } cal.sel = null; renderCalendar(); };
$("calNext").onclick = () => { cal.month++; if (cal.month > 12) { cal.month = 1; cal.year++; } cal.sel = null; renderCalendar(); };
$("calToday").onclick = () => { const d = new Date(); cal.year = d.getFullYear(); cal.month = d.getMonth() + 1; cal.sel = todayStr(); renderCalendar(); };
$("calFilters").onchange = renderCalendar;
$("calGrid").onclick = (e) => {
  const cell = e.target.closest("[data-date]");
  if (!cell) return;
  cal.sel = cal.sel === cell.dataset.date ? null : cell.dataset.date;
  renderCalendar();
  if (window.innerWidth < 1000) $("sideTitle").scrollIntoView({ behavior: "smooth" });
};
$("sideList").onclick = async (e) => {
  if (e.target.id === "calShowMonth") { cal.sel = null; return renderCalendar(); }
  const w = e.target.closest("[data-cal-write]");
  if (w) return calWrite(calSideEvents[Number(w.dataset.calWrite)]);
  const pl = e.target.closest("[data-cal-plan]");
  if (pl) {
    const [i, k] = pl.dataset.calPlan.split(":").map(Number);
    const ev = calSideEvents[i];
    return calPlan(ev, postIdeas(ev, cal.data.extraHolidays)[k]);
  }
  const op = e.target.closest("[data-open-post]");
  if (op) return openPost(op.dataset.openPost);
  const de = e.target.closest("[data-del-ev]");
  if (de && confirm("이 일정을 삭제할까요?")) {
    cal.data = await api(`/api/calendar/events/${de.dataset.delEv}`, { method: "DELETE" });
    renderCalendar();
  }
};
$("btnEvAdd").onclick = async () => {
  try {
    cal.data = await api("/api/calendar/events", { method: "POST", body: { date: $("evDate").value, title: $("evTitle").value } });
    $("evTitle").value = "";
    renderCalendar();
    toast("일정을 추가했습니다.");
  } catch (e) { toast(e.message, 3500); }
};
$("btnHolAdd").onclick = async () => {
  if (!$("holDate").value) return toast("날짜를 골라 주세요.");
  try {
    cal.data = await api("/api/calendar/holidays", { method: "POST", body: { date: $("holDate").value, name: $("holName").value || "임시공휴일" } });
    $("holName").value = "";
    renderCalendar();
    toast("휴일을 추가했습니다. 기한 연장 계산에 반영됩니다.");
  } catch (e) { toast(e.message, 3500); }
};
$("holList").onclick = async (e) => {
  const b = e.target.closest("[data-del-hol]");
  if (b && confirm("이 휴일을 삭제할까요?")) {
    cal.data = await api(`/api/calendar/holidays/${b.dataset.delHol}`, { method: "DELETE" });
    renderCalendar();
  }
};

// ───────────── 이전 버전 ─────────────

let historyItems = [];

async function openHistory() {
  if (!currentId) return;
  if (dirty) await save({ auto: true });
  try {
    historyItems = await api(`/api/posts/${currentId}/history`);
  } catch (e) {
    return toast(e.message, 3500);
  }
  $("historyPreview").classList.add("hidden");
  $("historyList").innerHTML = historyItems.length
    ? historyItems
        .map(
          (h, i) => `<div class="hist"><div><b>${timeStr(h.savedAt)}</b> <span class="muted">${escapeHtml(h.reason || "")} · ${h.content.length.toLocaleString()}자</span><br>
            <span class="muted">${escapeHtml((h.title || "(제목 없음)").slice(0, 40))} — ${escapeHtml(markdownToPlain(h.content).replace(/\s+/g, " ").slice(0, 60))}…</span></div>
            <div class="hist-btns"><button class="ghost" data-hprev="${i}">미리보기</button><button data-hrestore="${i}">되돌리기</button></div></div>`
        )
        .join("")
    : '<p class="muted">아직 보관된 이전 버전이 없습니다. 글을 고치며 저장하면 자동으로 쌓입니다.</p>';
  $("historyDlg").showModal();
}

$("btnHistory").onclick = openHistory;
$("btnHistoryClose").onclick = () => $("historyDlg").close();
$("historyList").onclick = async (e) => {
  const pv = e.target.closest("[data-hprev]");
  if (pv) {
    const h = historyItems[Number(pv.dataset.hprev)];
    $("historyPreview").innerHTML = `<h2>${escapeHtml(h.title || "(제목 없음)")}</h2>` + markdownToHtml(h.content);
    $("historyPreview").classList.remove("hidden");
    return;
  }
  const rs = e.target.closest("[data-hrestore]");
  if (rs) {
    const h = historyItems[Number(rs.dataset.hrestore)];
    if (!confirm(`${timeStr(h.savedAt)} 버전으로 되돌릴까요?\n지금 내용은 이전 버전 목록에 보관됩니다.`)) return;
    $("title").value = h.title || "";
    $("content").value = h.content || "";
    setMode("edit");
    updateCounter();
    renderReview();
    markDirty();
    await save({ snapshotReason: "버전 되돌리기 전" });
    $("historyDlg").close();
    toast("이전 버전으로 되돌렸습니다.");
  }
};

// ───────────── 자동 백업 설정 ─────────────

let abInfo = null;

async function loadAutoBackup() {
  try {
    abInfo = await api("/api/autobackup");
  } catch {
    return;
  }
  const st = abInfo.status || {};
  const box = $("abStatus");
  box.className = `ab-status small ${st.error ? "err" : ""}`;
  box.innerHTML = [
    st.lastAt ? `✅ 마지막 자동 백업: <b>${timeStr(st.lastAt)}</b>` : "아직 백업한 적이 없습니다.",
    `위치: <code>${escapeHtml(abInfo.dir)}</code>`,
    st.error ? `⚠ ${escapeHtml(st.error)}` : "",
  ].filter(Boolean).join("<br>");
  $("abDir").value = abInfo.dir === abInfo.defaultDir ? "" : abInfo.dir;
  $("btnAbOneDrive").classList.toggle("hidden", !abInfo.oneDrive);
}

$("btnAbOneDrive").onclick = () => {
  if (abInfo?.oneDrive) $("abDir").value = abInfo.oneDrive;
};
$("btnAbSave").onclick = async () => {
  try {
    await api("/api/autobackup/dir", { method: "PUT", body: { dir: $("abDir").value.trim() } });
    toast("백업 위치를 저장하고 바로 백업했습니다.");
  } catch (e) {
    toast(e.message, 4500);
  }
  loadAutoBackup();
};
$("btnAbRun").onclick = async () => {
  try {
    await api("/api/autobackup/run", { method: "POST", body: {} });
    toast("백업했습니다.");
  } catch (e) {
    toast(e.message, 4500);
  }
  loadAutoBackup();
};

// ───────────── 원클릭 전체 진행 ─────────────
// 초안(Claude) → 2차 검증(ChatGPT) → 수정본(Claude) → 재검증(ChatGPT) → 본문 이미지(Claude)
// 이상한 결과(발행 보류, 수정본이 지나치게 짧음 등)가 나오면 멈추고 알려 줌

const pipe = { running: false, stop: false, steps: [], timer: null };
const pipePref = { pipeReview: true, pipeRecheck: true }; // 사용자가 고른 값 (ChatGPT 연결 전에는 잠시 꺼 둠)
const PIPE_ICON = { wait: "⏳", run: "▶", done: "✅", skip: "⏭", stop: "⛔", fail: "❌" };

function updatePipeBox() {
  const claudeOk = engineReady("claude");
  const codexOk = engineReady("codex");
  $("pipeBox").classList.toggle("hidden", !claudeOk);
  for (const id of ["pipeReview", "pipeRecheck"]) {
    $(id).disabled = !codexOk || pipe.running;
    $(id).checked = codexOk && pipePref[id];
  }
  $("pipeImages").disabled = pipe.running;
  $("pipeNote").textContent = codexOk ? "" : "ChatGPT(Codex)가 연결되지 않아 2차 검증은 건너뜁니다. 오른쪽 위 배지에서 설정할 수 있습니다.";
  $("pipeNote").classList.toggle("hidden", codexOk);
}

function renderPipe() {
  $("pipeSteps").innerHTML = pipe.steps
    .map((st) => `<li class="${st.state}"><span class="ic">${PIPE_ICON[st.state]}</span><span>${escapeHtml(st.label)}${st.note ? `<span class="nt">${escapeHtml(st.note)}</span>` : ""}</span><span class="tm">${st.sec != null ? `${st.sec}초` : ""}</span></li>`)
    .join("");
}

function pipeStep(key) {
  return pipe.steps.find((s) => s.key === key);
}

async function runStep(key, fn) {
  const st = pipeStep(key);
  if (!st) return null;
  if (pipe.stop) { st.state = "stop"; st.note = "중단함"; renderPipe(); throw Object.assign(new Error("중단했습니다."), { stopped: true }); }
  st.state = "run";
  const t0 = Date.now();
  clearInterval(pipe.timer);
  pipe.timer = setInterval(() => { st.sec = Math.round((Date.now() - t0) / 1000); renderPipe(); }, 1000);
  renderPipe();
  try {
    const r = await fn();
    st.state = "done";
    return r;
  } catch (e) {
    st.state = e.stopped ? "stop" : "fail";
    st.note = e.message;
    throw e;
  } finally {
    clearInterval(pipe.timer);
    st.sec = Math.round((Date.now() - t0) / 1000);
    renderPipe();
  }
}

function skipStep(key, note) {
  const st = pipeStep(key);
  if (st && st.state === "wait") { st.state = "skip"; st.note = note; renderPipe(); }
}

async function autoText(kind, body) {
  const { text } = await api("/api/localai/run", { method: "POST", body: { kind, body } });
  return text;
}

function reviewBody() {
  return { title: $("title").value.trim(), topic: $("topic").value.trim(), content: $("content").value, checks: currentChecks };
}

async function doReview() {
  $("reviewPaste").value = await autoText("review", reviewBody());
  await saveReview({ silent: true });
  return currentReview;
}

async function runPipeline() {
  if (pipe.running) return;
  if (!$("topic").value.trim()) return toast("주제를 입력해 주세요.");
  if (!engineReady("claude")) return toast("자동 실행이 연결되어 있지 않습니다. 오른쪽 위 배지에서 설정해 주세요.", 4000);
  if (($("content").value.trim() || currentImages.length) && !confirm("지금 본문·이미지를 새로 만든 내용으로 바꿉니다.\n(바꾸기 전 내용은 '이전 버전'에 보관됩니다)\n\n원클릭 전체 진행을 시작할까요?")) return;
  if ($("content").value.trim() && currentId) await save({ snapshotReason: "원클릭 진행 전" });

  const doReviewOn = $("pipeReview").checked && engineReady("codex");
  const doRecheck = doReviewOn && $("pipeRecheck").checked;
  const doImages = $("pipeImages").checked;
  pipe.steps = [
    { key: "draft", label: "초안 작성 (Claude)", state: "wait" },
    ...(doReviewOn ? [{ key: "review", label: "2차 검증 (ChatGPT)", state: "wait" }, { key: "fix", label: "수정본 (Claude)", state: "wait" }] : []),
    ...(doRecheck ? [{ key: "recheck", label: "수정본 재검증 (ChatGPT)", state: "wait" }] : []),
    ...(doImages ? [{ key: "images", label: `본문 이미지 ${$("bodyImgN").value}개 (Claude)`, state: "wait" }] : []),
  ];
  pipe.running = true;
  pipe.stop = false;
  $("pipeSteps").classList.remove("hidden");
  $("pipeResult").classList.add("hidden");
  $("btnPipeStop").classList.remove("hidden");
  $("btnPipeline").disabled = true;
  $("btnPipeline").textContent = "🚀 진행 중… (창을 닫지 마세요)";
  $("btnDraft").disabled = true;
  updatePipeBox();
  renderPipe();

  const result = { ok: false, msg: "" };
  let finalVerdict = null;
  try {
    // 1) 초안
    await runStep("draft", async () => {
      $("pasteResult").value = await autoText("draft", draftRequestBody());
      applyResult({ auto: true });
      currentReview = null; // 새 초안이므로 이전 검증 결과는 지움
      renderReview();
      await save({ auto: true });
    });

    // 2) 검증 → 수정본 → 재검증
    if (doReviewOn) {
      const rv = await runStep("review", doReview);
      pipeStep("review").note = `판정: ${rv.verdict}${rv.issues ? ` · 수정 ${rv.issues}건` : ""}`;
      finalVerdict = rv.verdict;
      if (rv.verdict === "발행 보류") {
        skipStep("fix", "발행 보류 판정이라 멈췄습니다");
        skipStep("recheck", "");
        skipStep("images", "");
        throw Object.assign(new Error("2차 검증 판정이 '발행 보류'입니다. 검증 결과를 읽어 보고 직접 판단해 주세요."), { halt: true });
      }
      if (rv.verdict === "발행 가능" && !rv.issues) {
        skipStep("fix", "수정할 내용 없음");
        skipStep("recheck", "수정본 없음");
      } else {
        await runStep("fix", async () => {
          await applyFix(await autoText("fix", { title: $("title").value.trim(), content: $("content").value, reviewText: currentReview.text, useStyle: $("useStyle").checked }), { auto: true });
        });
        if (doRecheck) {
          const rv2 = await runStep("recheck", doReview);
          pipeStep("recheck").note = `판정: ${rv2.verdict}${rv2.issues ? ` · 수정 ${rv2.issues}건` : ""}`;
          finalVerdict = rv2.verdict;
          if (rv2.verdict === "발행 보류") {
            skipStep("images", "발행 보류 판정이라 멈췄습니다");
            throw Object.assign(new Error("수정본 재검증 판정이 '발행 보류'입니다. 검증 결과를 확인해 주세요."), { halt: true });
          }
        }
      }
    }

    // 3) 본문 이미지
    if (doImages) {
      await runStep("images", async () => {
        const content = $("content").value;
        const r = applyBodyImages(
          await autoText("bodyimages", { title: $("title").value.trim(), content: content.split("\n").filter((l) => !MARKER_RE.test(l)).join("\n"), count: Number($("bodyImgN").value), checks: currentChecks, useImgStyle: $("bodyImgStyle").checked }),
          { auto: true }
        );
        pipeStep("images").note = `이미지 ${r.count}개${r.bad.length ? ` (오류 ${r.bad.length}개 제외)` : ""}`;
      });
    }
    await save({ auto: true });
    result.ok = true;
  } catch (e) {
    result.msg = e.message;
    if (!e.halt && !e.stopped) pipe.steps.filter((s) => s.state === "wait").forEach((s) => { s.state = "skip"; });
    renderPipe();
    await save({ auto: true }).catch(() => {});
  } finally {
    pipe.running = false;
    $("btnPipeStop").classList.add("hidden");
    $("btnPipeline").disabled = false;
    $("btnPipeline").textContent = "🚀 원클릭 전체 진행";
    $("btnDraft").disabled = false;
    updatePipeBox();
  }

  // 결과 요약
  const left = currentChecks.filter((c) => !c.done).length;
  const box = $("pipeResult");
  box.classList.remove("hidden");
  box.classList.toggle("warn", !result.ok || (finalVerdict && finalVerdict !== "발행 가능") || left > 0);
  box.innerHTML = result.ok
    ? `<b>완료했습니다.</b> 아래를 확인해 주세요.<br>· 2차 검증 판정: <b>${escapeHtml(finalVerdict || "검증 안 함")}</b>${finalVerdict && finalVerdict !== "발행 가능" ? " — 검증 결과를 읽고 남은 부분을 직접 고쳐 주세요" : ""}<br>· 발행 전 확인할 내용: <b>${left}개</b><br>· 다음 할 일: 본문 검토 → 대표 이미지(ChatGPT) → 네이버에 붙여넣기`
    : `<b>${escapeHtml(result.msg)}</b><br>여기까지 진행된 내용은 저장되었습니다. 남은 단계는 아래 버튼으로 하나씩 진행할 수 있습니다.`;
  toast(result.ok ? "원클릭 전체 진행을 마쳤습니다. 결과를 꼭 검토해 주세요." : "원클릭 진행이 멈췄습니다. 안내를 확인해 주세요.", 5000);
  $("pipeBox").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("btnPipeline").onclick = runPipeline;
for (const id of ["pipeReview", "pipeRecheck"]) $(id).addEventListener("change", () => { pipePref[id] = $(id).checked; });
$("btnPipeStop").onclick = () => {
  pipe.stop = true;
  $("btnPipeStop").textContent = "중단 예약됨 (지금 단계가 끝나면 멈춤)";
  toast("지금 단계가 끝나면 멈춥니다.");
};

// ───────────── 화면 전환·연결 ─────────────

function showView(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  if (name === "list") { loadPosts(); loadAutoBackup(); }
  if (name === "samples") loadSamples();
  if (name === "imgstyle") loadImgStyle();
  if (name === "calendar") loadCalendar();
}

document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showView(t.dataset.view)));
document.querySelectorAll(".seg-btn").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
for (const id of ["title", "content", "tags", "status", "scheduledAt", "naverUrl"]) $(id).addEventListener("input", markDirty);
$("content").addEventListener("input", updateCounter);
$("status").addEventListener("change", () => {
  if ($("status").value === "scheduled" && !$("scheduledAt").value) $("scheduledAt").value = todayStr();
});

$("btnDraft").onclick = draft;
$("btnApplyResult").onclick = applyResult;
$("btnMeta").onclick = () => suggestMeta(false);
$("btnSave").onclick = save;
$("btnNew").onclick = () => confirmDiscard() && fillForm(null);
$("btnOpenNaver").onclick = () => window.open(NAVER_WRITE_URL, "_blank", "noopener");
$("btnCopyTitle").onclick = () => ($("title").value.trim() ? copyText($("title").value.trim(), "제목") : toast("제목이 비어 있습니다."));
$("btnCopyBody").onclick = copyBody;
// 태그 하나씩 복사 (네이버 태그 칸은 여러 개를 한 번에 붙여넣으면 하나로 뭉침)
let copiedTags = new Set();
let lastTagKey = "";

function renderTagChips() {
  const tags = tagList();
  const key = tags.join(",");
  if (key !== lastTagKey) { copiedTags = new Set(); lastTagKey = key; } // 태그가 바뀌면 처음부터
  const done = tags.filter((t) => copiedTags.has(t)).length;
  $("tagChips").innerHTML = tags.map((t, i) => `<button class="chip ${copiedTags.has(t) ? "done" : ""}" data-tag="${i}">${copiedTags.has(t) ? "✓ " : ""}${escapeHtml(t)}</button>`).join("");
  $("tagProgress").textContent = tags.length ? (done === tags.length ? `모두 복사함 (${tags.length}개)` : `${done}/${tags.length}개 복사함`) : "태그가 없습니다";
  $("btnCopyNextTag").textContent = tags.length && done === tags.length ? "처음부터 다시" : "다음 태그 복사";
}

async function copyOneTag(tag) {
  try {
    await navigator.clipboard.writeText(tag);
  } catch {
    fallbackCopy(tag);
  }
  copiedTags.add(tag);
  renderTagChips();
  const tags = tagList();
  toast(`'${tag}' 복사 (${tags.indexOf(tag) + 1}/${tags.length}) — 네이버 태그 칸에 Ctrl+V 후 Enter`, 2500);
}

$("btnCopyNextTag").onclick = () => {
  const tags = tagList();
  if (!tags.length) return toast("태그가 비어 있습니다.");
  if (tags.every((t) => copiedTags.has(t))) { copiedTags = new Set(); renderTagChips(); return toast("처음부터 다시 복사할 수 있습니다."); }
  copyOneTag(tags.find((t) => !copiedTags.has(t)));
};
$("tagChips").onclick = (e) => {
  const b = e.target.closest("[data-tag]");
  if (b) copyOneTag(tagList()[Number(b.dataset.tag)]);
};

$("filterStatus").onchange = renderPosts;
$("filterText").oninput = renderPosts;
$("postRows").onclick = (e) => {
  const del = e.target.closest("[data-del]");
  if (del) return deletePost(del.dataset.del);
  if (e.target.closest("a")) return;
  const row = e.target.closest("tr[data-id]");
  if (row) openPost(row.dataset.id);
};
$("upcoming").onclick = (e) => {
  const item = e.target.closest("[data-id]");
  if (item) openPost(item.dataset.id);
};
$("restoreFile").onchange = (e) => e.target.files[0] && restore(e.target.files[0]).finally(() => (e.target.value = ""));

$("tplList").onclick = async (e) => {
  const ed = e.target.closest("[data-edit]");
  if (ed) return editTemplate(templates.find((t) => t.id === ed.dataset.edit));
  const del = e.target.closest("[data-tdel]");
  if (del && confirm("이 템플릿을 삭제할까요?")) {
    await api(`/api/templates/${del.dataset.tdel}`, { method: "DELETE" });
    loadTemplates();
  }
};
$("btnTplSave").onclick = saveTemplate;
$("btnTplCancel").onclick = () => editTemplate(null);

// Ctrl+S 저장
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
});
window.addEventListener("pagehide", flushOnLeave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && dirty) save({ auto: true });
});

// 시작
(async () => {
  try {
    const s = await api("/api/status");
    applyMode(s.aiReady);
    loadLocalAi();
  } catch {
    applyMode(false);
  }
  await loadTemplates();
  await loadSamples();
  await loadImgStyle();
  fillForm(null);
  await loadTopics();
  if (!topicsDoc?.doc && !topicsDoc?.refreshing) autoTopics(true);
})();
