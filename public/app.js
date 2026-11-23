// 블로그 글 작성 도우미 — 화면 동작
const $ = (id) => document.getElementById(id);
const NAVER_WRITE_URL = "https://blog.naver.com/GoBlogWrite.naver";
const STATUS_LABEL = { draft: "초안", scheduled: "발행 예정", published: "발행 완료" };

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
  s = s.replace(/\[확인 필요\]/g, forCopy ? `<span style="${S.mark}">[확인 필요]</span>` : "<mark>[확인 필요]</mark>");
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
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\s*[-*]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p${st("p")}>${para.map((p) => inline(p, forCopy)).join("<br>")}</p>`);
  }
  return out.join("\n");
}

function markdownToPlain(md) {
  return md
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
  if (left && !confirm(`본문에 [확인 필요] 표시가 ${left}곳 남아 있습니다.\n확인하지 않은 내용이 그대로 발행될 수 있습니다.\n\n그래도 복사할까요?`)) return;
  const html = markdownToHtml(md, true);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([markdownToPlain(md)], { type: "text/plain" }),
      }),
    ]);
    toast("본문(서식 포함) 복사 완료 — 네이버 본문에 붙여넣기 하세요");
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

function markDirty() {
  dirty = true;
  $("saveState").textContent = "저장 안 됨";
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
  };
}

function fillForm(p) {
  currentId = p?.id || null;
  $("title").value = p?.title || "";
  $("topic").value = p?.topic || "";
  $("content").value = p?.content || "";
  $("tags").value = (p?.tags || []).join(", ");
  $("status").value = p?.status || "draft";
  $("scheduledAt").value = p?.scheduledAt || "";
  $("naverUrl").value = p?.naverUrl || "";
  $("titleSuggest").innerHTML = "";
  $("sources").classList.add("hidden");
  $("draftStatus").textContent = "";
  dirty = false;
  $("saveState").textContent = currentId ? `저장됨 · ${fmtDate(p.updatedAt)}` : "";
  setMode("edit");
  updateCounter();
}

async function save() {
  const data = readForm();
  if (!data.title && !data.content.trim()) return toast("제목이나 본문을 입력해 주세요.");
  if (data.status === "scheduled" && !data.scheduledAt) return toast("발행 예정이면 예정일을 넣어 주세요.");
  if (data.status === "published" && !data.naverUrl) toast("발행 완료 글은 네이버 글 주소도 넣어 두면 나중에 찾기 쉽습니다.", 3000);
  try {
    const saved = currentId
      ? await api(`/api/posts/${currentId}`, { method: "PUT", body: data })
      : await api("/api/posts", { method: "POST", body: data });
    currentId = saved.id;
    dirty = false;
    $("saveState").textContent = `저장됨 · ${fmtDate(saved.updatedAt)}`;
    toast("저장했습니다.");
  } catch (e) {
    toast(e.message, 3500);
  }
}

function confirmDiscard() {
  return !dirty || confirm("저장하지 않은 내용이 있습니다. 버리고 진행할까요?");
}

// ───────────── AI ─────────────

async function draft() {
  const topic = $("topic").value.trim();
  if (!topic) return toast("주제를 입력해 주세요.");
  if ($("content").value.trim() && !confirm("지금 본문을 AI 초안으로 바꿉니다. 계속할까요?")) return;

  const tpl = templates.find((t) => t.id === $("templateSelect").value);
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
      body: JSON.stringify({
        topic,
        audience: $("audience").value.trim(),
        memo: $("memo").value.trim(),
        templateGuide: tpl?.guide || "",
        length: Number($("length").value),
        webSearch: $("webSearch").checked,
        useStyle: $("useStyle").checked,
      }),
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
      const left = ($("content").value.match(/\[확인 필요\]/g) || []).length;
      status.textContent = left ? `완료 — [확인 필요] ${left}곳을 꼭 확인해 주세요.` : "완료 — 내용을 검토해 주세요.";
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
  const btn = $("btnMeta");
  btn.disabled = true;
  btn.textContent = "추천 받는 중…";
  try {
    const { titles, tags } = await api("/api/meta", { method: "POST", body: { topic, content, useStyle: $("useStyle").checked } });
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
        <td><span class="pill ${p.status}">${STATUS_LABEL[p.status]}</span></td>
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

// ───────────── 화면 전환·연결 ─────────────

function showView(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  if (name === "list") loadPosts();
  if (name === "samples") loadSamples();
}

document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showView(t.dataset.view)));
document.querySelectorAll(".seg-btn").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
for (const id of ["title", "content", "tags", "status", "scheduledAt", "naverUrl"]) $(id).addEventListener("input", markDirty);
$("content").addEventListener("input", updateCounter);
$("status").addEventListener("change", () => {
  if ($("status").value === "scheduled" && !$("scheduledAt").value) $("scheduledAt").value = todayStr();
});

$("btnDraft").onclick = draft;
$("btnMeta").onclick = () => suggestMeta(false);
$("btnSave").onclick = save;
$("btnNew").onclick = () => confirmDiscard() && fillForm(null);
$("btnOpenNaver").onclick = () => window.open(NAVER_WRITE_URL, "_blank", "noopener");
$("btnCopyTitle").onclick = () => ($("title").value.trim() ? copyText($("title").value.trim(), "제목") : toast("제목이 비어 있습니다."));
$("btnCopyBody").onclick = copyBody;
$("btnCopyTags").onclick = () => (tagList().length ? copyText(tagList().join(","), "태그") : toast("태그가 비어 있습니다."));

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
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

// 시작
(async () => {
  try {
    const s = await api("/api/status");
    const badge = $("aiBadge");
    badge.textContent = s.aiReady ? "AI 연결됨" : "AI 키 없음";
    badge.className = `badge ${s.aiReady ? "ok" : "off"}`;
    if (!s.aiReady) badge.title = "README의 '처음 한 번 설정'을 따라 .env에 API 키를 넣으세요.";
  } catch {}
  await loadTemplates();
  await loadSamples();
  fillForm(null);
})();
