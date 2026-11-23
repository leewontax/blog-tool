// 세무사용 네이버 블로그 글 작성 도우미 — 서버
// 실행: npm start  →  브라우저에서 http://localhost:3000
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { upcoming, weekday } from "./public/taxcal.js";
import { buildAutoTopics } from "./topics-auto.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const DATA_DIR = path.join(here, "data");
// 설정 파일(.env)이 있으면 읽음 — 없어도 정상(요청문 복사 방식은 설정 불필요)
try {
  process.loadEnvFile(path.join(here, ".env"));
} catch {}
const PORT = Number(process.env.PORT) || 3000;
const MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// 공식 자료 위주로만 검색하도록 제한 (블로그·카페 제외)
const OFFICIAL_DOMAINS = [
  "law.go.kr",
  "nts.go.kr",
  "moef.go.kr",
  "taxlaw.nts.go.kr",
  "glaw.scourt.go.kr",
  "korea.kr",
];

// API 키가 있을 때만 AI 연결 부품(SDK)을 불러옵니다.
// 키가 없으면(요청문 복사 방식) 부품 설치(npm install) 없이 바로 실행됩니다.
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
let Anthropic = null;
if (hasKey) {
  try {
    ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
  } catch {
    console.log("\n  ⚠ API 키가 있지만 AI 연결 부품이 설치되어 있지 않습니다. 이 폴더에서 npm install 을 실행해 주세요.");
    console.log("    (지금은 요청문 복사 방식으로 실행합니다)\n");
  }
}
const client = Anthropic ? new Anthropic() : null;

// ───────────────────────── 저장소 (data/*.json) ─────────────────────────

const DEFAULT_TEMPLATES = [
  {
    id: "tpl-column",
    name: "세무 칼럼",
    guide:
      "1) 도입: 독자가 겪는 상황 한 문단\n2) 결론 먼저: 가능/불가능, 해당/비해당\n3) 적용 요건: 누가, 어떤 경우에 해당하는지\n4) 사례로 쉽게 풀기(숫자 예시)\n5) 놓치기 쉬운 점·주의사항\n6) 요약 3줄",
  },
  {
    id: "tpl-deadline",
    name: "신고기한 안내",
    guide:
      "1) 어떤 세금, 누가 대상인지\n2) 신고기한·납부기한(휴일이면 연장 여부 표시)\n3) 준비서류 체크리스트\n4) 신고 방법(홈택스 메뉴 위치 등 확인된 내용만)\n5) 기한을 놓치면 생기는 가산세\n6) 요약",
  },
  {
    id: "tpl-revision",
    name: "세법 개정 소식",
    guide:
      "1) 무엇이 바뀌었는지 한 줄 요약\n2) 개정 전 vs 개정 후 비교표\n3) 시행일·적용시기·경과규정\n4) 누구에게 영향이 있는지\n5) 지금 준비할 일\n6) 요약",
  },
  {
    id: "tpl-qa",
    name: "자주 묻는 질문(Q&A)",
    guide:
      "질문 3~5개를 Q/A 형식으로 작성.\n각 답변은 결론 → 이유(근거) → 주의사항 순서.\n마지막에 요약.",
  },
];

const OLD_COLUMN_GUIDE = "1) 도입: 독자가 겪는 상황 한 문단\n2) 결론 먼저: 가능/불가능, 해당/비해당\n3) 적용 요건과 법령 근거(법령명·조문)\n4) 사례로 쉽게 풀기(숫자 예시)\n5) 놓치기 쉬운 점·주의사항\n6) 요약 3줄";

async function readStore(name, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, `${name}.json`), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return structuredClone(fallback);
    throw err;
  }
}

async function writeStore(name, value) {
  const file = path.join(DATA_DIR, `${name}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file); // 저장 도중 꺼져도 파일이 깨지지 않도록
}

// ───────────────────────── AI 프롬프트 ─────────────────────────

const SYSTEM_PROMPT = `당신은 대한민국 세무사가 운영하는 네이버 블로그의 글을 대신 초안 작성하는 보조 작가입니다.
독자는 세무 지식이 거의 없는 일반인·소상공인입니다.

작성 원칙:
- 결론을 먼저 쓰고, 이유와 근거를 뒤에 씁니다.
- 전문용어는 처음 나올 때 괄호 안에 쉬운 말로 풀어 씁니다. 예: 필요경비(사업을 위해 쓴 돈으로 인정받는 비용)
- 본문에 법령명·조문 번호(예: ○○법 제○조)는 쓰지 않습니다. 법 내용은 쉬운 말로만 설명합니다.
- 확실하지 않은 금액·세율·기한은 지어내지 말고 그 자리에 [확인 필요]라고 표시합니다.
- 귀속연도(소득이 생긴 해)와 신고연도를 구분해 씁니다.
- 세액 예시는 산식을 함께 보여 줍니다.
- "무조건", "100% 절세" 같은 과장·단정 표현, 다른 세무사와의 비교, 수임료 할인 등 광고성 문구는 쓰지 않습니다.
- 블로그·카페 글을 근거로 삼지 않습니다.
- 개인 사례는 실명·주민번호·계좌 등 개인정보 없이 일반화해서 씁니다.

출력 형식(네이버 에디터에 붙여 넣기 좋게):
- 제목은 쓰지 말고 본문만 씁니다.
- 소제목은 "## 소제목", 강조는 **굵게**, 목록은 "- " 로 씁니다.
- 표가 필요하면 "| 항목 | 내용 |" 형식의 간단한 표를 씁니다.
- 한 문단은 2~3문장으로 짧게 씁니다.
- 마지막 줄에 "※ 이 글은 일반적인 안내이며, 개별 사실관계에 따라 결론이 달라질 수 있습니다."를 넣습니다.`;

// ───────────────────────── 내 글 학습(말투 반영) ─────────────────────────
// AI를 다시 훈련시키는 것이 아니라, 글을 쓸 때마다 세무사님 글을 예시로 함께 보여 주는 방식입니다.

const SAMPLE_CHAR_LIMIT = 15000; // 한 번에 AI에 보여 줄 예시 글 분량 상한 (비용·속도 조절)

async function activeSamples() {
  const samples = await readStore("samples", []);
  const picked = [];
  let total = 0;
  for (const s of samples.filter((x) => x.use).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (picked.length && total + s.content.length > SAMPLE_CHAR_LIMIT) continue;
    picked.push(s.content.length > SAMPLE_CHAR_LIMIT ? { ...s, content: s.content.slice(0, SAMPLE_CHAR_LIMIT) } : s);
    total += Math.min(s.content.length, SAMPLE_CHAR_LIMIT);
  }
  return picked;
}

async function styleSystemBlock() {
  const style = await readStore("style", { profile: "" });
  const samples = await activeSamples();
  if (!style.profile.trim() && !samples.length) return null;
  const parts = [
    "아래는 이 블로그 주인(세무사)이 직접 쓴 글의 말투와 형식입니다. 새 글은 이 사람이 직접 쓴 것처럼 써 주세요.",
    "따라 할 것: 말투(존댓말 수준, 어미), 인사말·맺음말, 문단 길이, 소제목 붙이는 방식, 강조·목록·이모지 사용 습관, 글 구성 순서.",
    "따라 하지 말 것: 예시 글에 나온 세법 내용·세율·금액·기한·조문. 예전 글이라 지금 법령과 다를 수 있으므로 사실관계는 작성 원칙에 따라 새로 판단하고, 불확실하면 [확인 필요]로 표시하세요.",
    "출력 문법(## 소제목, **굵게**, - 목록)과 마지막 안내 문장은 작성 원칙을 그대로 따르세요. 예시 글에 고유한 맺음말이 있으면 그 맺음말을 쓰고 그 아래에 안내 문장을 붙이세요.",
  ];
  if (style.profile.trim()) parts.push(`<말투_요약>\n${style.profile.trim()}\n</말투_요약>`);
  samples.forEach((s, i) => parts.push(`<예시_글 번호="${i + 1}" 제목="${s.title.replace(/"/g, "'")}">\n${s.content}\n</예시_글>`));
  // 같은 예시 글을 반복해서 보낼 때 요금이 줄도록 캐시 지정
  return { type: "text", text: parts.join("\n\n"), cache_control: { type: "ephemeral" } };
}

async function systemBlocks(useStyle) {
  const blocks = [{ type: "text", text: SYSTEM_PROMPT }];
  if (useStyle) {
    const style = await styleSystemBlock();
    if (style) blocks.push(style);
  }
  return blocks;
}

function draftPrompt({ topic, audience, memo, templateGuide, length }) {
  return [
    `주제: ${topic}`,
    audience ? `대상 독자: ${audience}` : "",
    templateGuide ? `글 구성(이 순서를 따르세요):\n${templateGuide}` : "",
    memo ? `세무사 메모(반드시 반영):\n${memo}` : "",
    `분량: 약 ${length || 2000}자`,
    `작성 기준일: ${new Date().toISOString().slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const META_SCHEMA = {
  type: "object",
  properties: {
    titles: {
      type: "array",
      items: { type: "string" },
      description: "네이버 검색에 잘 걸리는 제목 후보 5개 (각 40자 이내, 핵심 키워드를 앞쪽에)",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "해시태그 10개 (# 없이, 띄어쓰기 없이)",
    },
  },
  required: ["titles", "tags"],
  additionalProperties: false,
};

function textOf(message) {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function refusalMessage(message) {
  return message.stop_reason === "refusal"
    ? "AI가 이 요청에 대한 작성을 거절했습니다. 주제나 표현을 바꿔 다시 시도해 주세요."
    : null;
}

// ───────────────────────── HTTP 도우미 ─────────────────────────

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 3_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("요청이 너무 큽니다."), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function apiErrorMessage(err) {
  if (!Anthropic) return err.message || "알 수 없는 오류";
  if (err instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다. .env 파일의 ANTHROPIC_API_KEY를 확인해 주세요.";
  if (err instanceof Anthropic.RateLimitError) return "요청이 많아 잠시 제한되었습니다. 1~2분 뒤 다시 시도해 주세요.";
  if (err instanceof Anthropic.APIConnectionError) return "AI 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.";
  if (err instanceof Anthropic.APIError) return `AI 요청 오류(${err.status ?? "?"}): ${err.message}`;
  return err.message || "알 수 없는 오류";
}

// ───────────────────────── AI 처리 ─────────────────────────

// 본문 초안: 스트리밍으로 글자가 써지는 대로 브라우저에 전달
async function handleDraft(req, res) {
  const body = await readBody(req);
  if (!body.topic?.trim()) return sendJson(res, 400, { error: "주제를 입력해 주세요." });

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  const send = (obj) => res.write(JSON.stringify(obj) + "\n");

  const tools = body.webSearch
    ? [{ type: "web_search_20260209", name: "web_search", max_uses: 5, allowed_domains: OFFICIAL_DOMAINS }]
    : undefined;

  const messages = [{ role: "user", content: draftPrompt(body) }];
  try {
    const system = await systemBlocks(body.useStyle);
    if (body.useStyle && system.length > 1) send({ type: "status", text: "내 말투를 반영해 작성 중…" });
    // 웹검색을 쓰면 서버가 중간에 멈추고(pause_turn) 이어 쓰기를 요청할 수 있어 몇 번 반복
    for (let turn = 0; turn < 4; turn++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system,
        messages,
        ...(tools ? { tools } : {}),
      });
      stream.on("text", (delta) => send({ type: "text", text: delta }));
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
          send({ type: "status", text: "공식 자료 검색 중…" });
        }
      });
      const final = await stream.finalMessage();

      const refused = refusalMessage(final);
      if (refused) { send({ type: "error", text: refused }); break; }
      if (final.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: final.content });
        continue;
      }
      if (final.stop_reason === "max_tokens") send({ type: "status", text: "분량 한도에 도달해 글이 중간에 끝났을 수 있습니다." });
      // 검색에 사용된 출처 링크 모으기
      const sources = [];
      for (const block of final.content) {
        if (block.type === "text" && Array.isArray(block.citations)) {
          for (const c of block.citations) {
            if (c.url && !sources.some((s) => s.url === c.url)) sources.push({ url: c.url, title: c.title || c.url });
          }
        }
      }
      if (sources.length) send({ type: "sources", sources });
      break;
    }
    send({ type: "done" });
  } catch (err) {
    console.error(err);
    send({ type: "error", text: apiErrorMessage(err) });
  }
  res.end();
}

// 제목 후보·해시태그 추천 (JSON 형식으로 받기)
async function handleMeta(req, res) {
  const body = await readBody(req);
  if (!body.content?.trim() && !body.topic?.trim()) return sendJson(res, 400, { error: "주제나 본문이 필요합니다." });
  try {
    const style = body.useStyle ? (await readStore("style", { profile: "" })).profile.trim() : "";
    const message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema: META_SCHEMA } },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system:
        "당신은 네이버 블로그 검색 노출에 밝은 편집자입니다. 과장·낚시성 표현, '무조건/100%' 같은 단정 표현은 피하고, 실제 검색어(예: 종합소득세 신고기간, 연말정산 의료비공제)를 자연스럽게 넣으세요.",
      messages: [
        {
          role: "user",
          content:
            `주제: ${body.topic || "(본문 참고)"}\n\n본문:\n${(body.content || "").slice(0, 12000)}` +
            (style ? `\n\n블로그 주인의 말투 요약(제목 스타일도 이에 맞춰 주세요):\n${style.slice(0, 3000)}` : ""),
        },
      ],
    });
    const refused = refusalMessage(message);
    if (refused) return sendJson(res, 422, { error: refused });
    const parsed = JSON.parse(textOf(message));
    sendJson(res, 200, {
      titles: parsed.titles.slice(0, 5),
      tags: parsed.tags.map((t) => t.replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 10),
    });
  } catch (err) {
    console.error(err);
    sendJson(res, 502, { error: apiErrorMessage(err) });
  }
}

// ───────────────────────── 글·템플릿 저장 ─────────────────────────

const POST_STATUSES = ["draft", "scheduled", "published"];

const REVIEW_VERDICTS = ["발행 가능", "수정 후 발행", "발행 보류", "판정 없음"];

// 2차 검증(ChatGPT) 결과
function cleanReview(r) {
  if (!r || typeof r !== "object" || !String(r.text || "").trim()) return null;
  return {
    text: String(r.text).slice(0, 60000),
    verdict: REVIEW_VERDICTS.includes(r.verdict) ? r.verdict : "판정 없음",
    issues: Math.max(0, Math.min(999, Number(r.issues) || 0)),
    contentHash: String(r.contentHash || "").slice(0, 40),
    reviewedAt: r.reviewedAt || new Date().toISOString(),
  };
}

// 본문 이미지(SVG) — 스크립트·외부 링크 등 위험한 요소는 저장하지 않음
function safeSvg(svg) {
  const t = String(svg || "").trim();
  if (!/^<svg[\s>]/i.test(t) || !/<\/svg>\s*$/i.test(t)) return null;
  if (/<script|<foreignObject|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/)/i.test(t)) return null;
  return t.length <= 300_000 ? t : null;
}

function cleanImages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((im) => ({ n: Number(im?.n) || 0, place: String(im?.place || "").slice(0, 100), alt: String(im?.alt || "").slice(0, 200), svg: safeSvg(im?.svg) }))
    .filter((im) => im.n > 0 && im.svg)
    .slice(0, 8);
}

const THUMB_PRESETS = ["bottom", "center", "top"];
function cleanThumb(t) {
  if (!t || typeof t !== "object") return null;
  return {
    title: String(t.title || "").slice(0, 120),
    sub: String(t.sub || "").slice(0, 80),
    office: String(t.office || "").slice(0, 40),
    preset: THUMB_PRESETS.includes(t.preset) ? t.preset : "bottom",
    bgFile: /^[\w-]+-bg\.(png|jpg|webp)$/.test(t.bgFile || "") ? t.bgFile : "",
  };
}

function cleanPost(input, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: existing.id || randomUUID(),
    title: String(input.title ?? existing.title ?? "").slice(0, 200),
    topic: String(input.topic ?? existing.topic ?? "").slice(0, 500),
    content: String(input.content ?? existing.content ?? ""),
    tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 30) : existing.tags || [],
    status: POST_STATUSES.includes(input.status) ? input.status : existing.status || "draft",
    scheduledAt: input.scheduledAt ?? existing.scheduledAt ?? "",
    naverUrl: String(input.naverUrl ?? existing.naverUrl ?? "").slice(0, 500),
    review: cleanReview(input.review !== undefined ? input.review : existing.review),
    images: cleanImages(input.images !== undefined ? input.images : existing.images),
    thumb: cleanThumb(input.thumb !== undefined ? input.thumb : existing.thumb),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

// ───────── 이전 버전 기록 ─────────
// 자동 저장이 덮어쓰기 때문에, 저장 직전 내용을 보관합니다.
// 10분에 한 번, 또는 내용이 크게 바뀌었을 때(300자 이상 차이, 수정본 적용·되돌리기 등)만 남깁니다.
const HISTORY_KEEP = 30;

async function snapshotPost(prev, next) {
  const newContent = next.content ?? prev.content;
  const newTitle = next.title ?? prev.title;
  if (prev.content === newContent && prev.title === newTitle) return;
  if (!String(prev.content || "").trim() && !String(prev.title || "").trim()) return;
  const name = `history/${prev.id}`;
  const list = await readStore(name, []);
  const last = list[list.length - 1];
  const minutes = last ? (Date.now() - new Date(last.savedAt).getTime()) / 60000 : Infinity;
  const bigChange = Math.abs(String(newContent || "").length - String(prev.content || "").length) >= 300;
  if (!next.forceSnapshot && minutes < 10 && !bigChange) return;
  list.push({ savedAt: new Date().toISOString(), title: prev.title, content: prev.content, reason: next.snapshotReason || (bigChange ? "큰 수정 전" : "자동 기록") });
  await writeStore(name, list.slice(-HISTORY_KEEP));
}

const IMAGE_DIR = path.join(DATA_DIR, "images");
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

async function handlePosts(req, res, id, sub) {
  if (sub === "thumbbg") {
    if (req.method !== "PUT") return sendJson(res, 405, { error: "지원하지 않는 요청" });
    const posts = await readStore("posts", []);
    const idx = posts.findIndex((p) => p.id === id);
    if (idx < 0) return sendJson(res, 404, { error: "먼저 글을 저장해 주세요." });
    const b = await readBody(req, 25_000_000);
    const m = String(b.dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return sendJson(res, 400, { error: "PNG·JPG·WEBP 이미지만 넣을 수 있습니다." });
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 15_000_000) return sendJson(res, 400, { error: "이미지가 너무 큽니다(15MB 이하)." });
    await fs.mkdir(IMAGE_DIR, { recursive: true });
    // 예전 배경 파일 정리
    for (const ext of Object.values(IMAGE_TYPES)) await fs.rm(path.join(IMAGE_DIR, `${id}-bg.${ext}`), { force: true });
    const file = `${id}-bg.${IMAGE_TYPES[m[1]]}`;
    await fs.writeFile(path.join(IMAGE_DIR, file), buf);
    posts[idx].thumb = { ...(cleanThumb(posts[idx].thumb) || cleanThumb({})), bgFile: file };
    posts[idx].updatedAt = new Date().toISOString();
    await writeStore("posts", posts);
    return sendJson(res, 200, { bgFile: file });
  }
  if (sub === "history") {
    if (req.method !== "GET") return sendJson(res, 405, { error: "지원하지 않는 요청" });
    const list = await readStore(`history/${id}`, []);
    return sendJson(res, 200, list.slice().reverse());
  }
  const posts = await readStore("posts", []);
  if (req.method === "GET" && !id) {
    posts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sendJson(res, 200, posts);
  }
  if (req.method === "POST" && !id) {
    const post = cleanPost(await readBody(req));
    posts.push(post);
    await writeStore("posts", posts);
    return sendJson(res, 201, post);
  }
  const idx = posts.findIndex((p) => p.id === id);
  if (idx < 0) return sendJson(res, 404, { error: "글을 찾을 수 없습니다." });
  if (req.method === "GET") return sendJson(res, 200, posts[idx]);
  if (req.method === "PUT") {
    const body = await readBody(req);
    await snapshotPost(posts[idx], body);
    posts[idx] = cleanPost(body, posts[idx]);
    await writeStore("posts", posts);
    return sendJson(res, 200, posts[idx]);
  }
  if (req.method === "DELETE") {
    const [removed] = posts.splice(idx, 1);
    await writeStore("posts", posts);
    // 실수로 지운 글을 되살릴 수 있도록 휴지통에 보관
    const trash = await readStore("trash", []);
    trash.push({ ...removed, deletedAt: new Date().toISOString() });
    await writeStore("trash", trash.slice(-200));
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 405, { error: "지원하지 않는 요청" });
}

async function handleTemplates(req, res, id) {
  const templates = await readStore("templates", DEFAULT_TEMPLATES);
  // 예전 기본 '세무 칼럼' 템플릿(법령명·조문 표기)을 그대로 쓰고 있으면 새 문구로 교체
  const col = templates.find((t) => t.id === "tpl-column" && t.guide === OLD_COLUMN_GUIDE);
  if (col) {
    col.guide = DEFAULT_TEMPLATES.find((t) => t.id === "tpl-column").guide;
    await writeStore("templates", templates);
  }
  if (req.method === "GET" && !id) return sendJson(res, 200, templates);
  if (req.method === "POST" && !id) {
    const b = await readBody(req);
    if (!b.name?.trim()) return sendJson(res, 400, { error: "템플릿 이름을 입력해 주세요." });
    const tpl = { id: randomUUID(), name: b.name.trim().slice(0, 60), guide: String(b.guide || "") };
    templates.push(tpl);
    await writeStore("templates", templates);
    return sendJson(res, 201, tpl);
  }
  const idx = templates.findIndex((t) => t.id === id);
  if (idx < 0) return sendJson(res, 404, { error: "템플릿을 찾을 수 없습니다." });
  if (req.method === "PUT") {
    const b = await readBody(req);
    templates[idx] = { ...templates[idx], name: String(b.name ?? templates[idx].name).slice(0, 60), guide: String(b.guide ?? templates[idx].guide) };
    await writeStore("templates", templates);
    return sendJson(res, 200, templates[idx]);
  }
  if (req.method === "DELETE") {
    templates.splice(idx, 1);
    await writeStore("templates", templates);
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 405, { error: "지원하지 않는 요청" });
}

// 내 글 샘플 저장
async function handleSamples(req, res, id) {
  const samples = await readStore("samples", []);
  if (req.method === "GET" && !id) {
    samples.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sendJson(res, 200, { samples, charLimit: SAMPLE_CHAR_LIMIT });
  }
  if (req.method === "POST" && !id) {
    const b = await readBody(req);
    const content = String(b.content || "").trim();
    if (content.length < 200) return sendJson(res, 400, { error: "본문이 너무 짧습니다. 200자 이상인 글을 넣어 주세요." });
    const sample = {
      id: randomUUID(),
      title: String(b.title || "").trim().slice(0, 200) || content.split("\n")[0].slice(0, 40),
      content,
      use: true,
      createdAt: new Date().toISOString(),
    };
    samples.push(sample);
    await writeStore("samples", samples);
    return sendJson(res, 201, sample);
  }
  const idx = samples.findIndex((s) => s.id === id);
  if (idx < 0) return sendJson(res, 404, { error: "글을 찾을 수 없습니다." });
  if (req.method === "PUT") {
    const b = await readBody(req);
    const s = samples[idx];
    if (b.title !== undefined) s.title = String(b.title).trim().slice(0, 200) || s.title;
    if (b.content !== undefined && String(b.content).trim().length >= 200) s.content = String(b.content).trim();
    if (b.use !== undefined) s.use = Boolean(b.use);
    await writeStore("samples", samples);
    return sendJson(res, 200, s);
  }
  if (req.method === "DELETE") {
    samples.splice(idx, 1);
    await writeStore("samples", samples);
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 405, { error: "지원하지 않는 요청" });
}

// 말투 요약 보기·저장
async function handleStyle(req, res) {
  if (req.method === "GET") return sendJson(res, 200, await readStore("style", { profile: "", analyzedAt: "" }));
  if (req.method === "PUT") {
    const b = await readBody(req);
    const prev = await readStore("style", { profile: "", analyzedAt: "" });
    const style = { ...prev, profile: String(b.profile || "").slice(0, 6000), updatedAt: new Date().toISOString() };
    await writeStore("style", style);
    return sendJson(res, 200, style);
  }
  sendJson(res, 405, { error: "지원하지 않는 요청" });
}

// AI가 내 글을 읽고 말투·형식 특징을 정리
async function handleStyleAnalyze(req, res) {
  const samples = await activeSamples();
  if (!samples.length) return sendJson(res, 400, { error: "'반영'으로 켜 둔 내 글이 없습니다. 먼저 글을 1개 이상 추가해 주세요." });
  try {
    const message = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "medium" },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system:
        "당신은 글쓰기 문체 분석가입니다. 주어진 블로그 글들의 공통된 말투와 형식만 분석합니다. 세법 내용이나 수치는 분석 대상이 아닙니다.",
      messages: [
        {
          role: "user",
          content:
            samples.map((s, i) => `<글 번호="${i + 1}">\n${s.content}\n</글>`).join("\n\n") +
            `\n\n위 글들을 쓴 사람과 똑같은 말투로 새 글을 쓰려는 작가에게 줄 '말투 지침'을 작성해 주세요.
다음 항목별로 짧은 글머리표로, 실제 글에서 가져온 짧은 표현 예시를 따옴표로 곁들여 주세요.
1. 말투·어미 (예: ~습니다/~해요, 독자를 부르는 호칭)
2. 시작 인사와 맺음말
3. 글 구성 순서
4. 소제목 스타일
5. 문단 길이·줄바꿈 습관
6. 강조·목록·표·이모지·기호 사용
7. 자주 쓰는 표현
8. 피하는 표현이나 특징
글 수가 적어 판단하기 어려운 항목은 "판단 어려움"이라고 적어 주세요. 전체 1,500자 이내로 써 주세요. 고객 이름 등 개인정보는 옮겨 적지 마세요.`,
        },
      ],
    });
    const refused = refusalMessage(message);
    if (refused) return sendJson(res, 422, { error: refused });
    const style = { profile: textOf(message).trim(), analyzedAt: new Date().toISOString(), sampleCount: samples.length };
    await writeStore("style", style);
    sendJson(res, 200, style);
  } catch (err) {
    console.error(err);
    sendJson(res, 502, { error: apiErrorMessage(err) });
  }
}

// 전체 백업 / 복원
async function handleBackup(req, res) {
  if (req.method === "GET") {
    const payload = {
      exportedAt: new Date().toISOString(),
      posts: await readStore("posts", []),
      templates: await readStore("templates", DEFAULT_TEMPLATES),
      samples: await readStore("samples", []),
      style: await readStore("style", { profile: "" }),
      calendar: await readStore("calendar", CAL_DEFAULT),
    };
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="blog-backup-${payload.exportedAt.slice(0, 10)}.json"`,
    });
    return res.end(JSON.stringify(payload, null, 2));
  }
  if (req.method === "POST") {
    const b = await readBody(req);
    if (!Array.isArray(b.posts) || !Array.isArray(b.templates)) return sendJson(res, 400, { error: "백업 파일 형식이 아닙니다." });
    // 복원 전 현재 상태를 따로 저장해 두어 되돌릴 수 있게 함
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeStore(`before-restore-${stamp}`, {
      posts: await readStore("posts", []),
      templates: await readStore("templates", DEFAULT_TEMPLATES),
      samples: await readStore("samples", []),
      style: await readStore("style", { profile: "" }),
    });
    // 예전 백업 파일에는 내 글·말투가 없을 수 있음 → 그때는 기존 것을 그대로 둠
    if (Array.isArray(b.samples)) {
      await writeStore(
        "samples",
        b.samples
          .filter((s) => s && typeof s.content === "string" && s.content.trim())
          .map((s) => ({ id: s.id || randomUUID(), title: String(s.title || ""), content: s.content, use: s.use !== false, createdAt: s.createdAt || new Date().toISOString() }))
      );
    }
    if (b.style && typeof b.style.profile === "string") await writeStore("style", b.style);
    if (b.calendar && typeof b.calendar === "object" && Array.isArray(b.calendar.events)) await writeStore("calendar", { extraHolidays: b.calendar.extraHolidays || {}, events: b.calendar.events });
    await writeStore("posts", b.posts.map((p) => cleanPost(p, { id: p.id, createdAt: p.createdAt })));
    await writeStore("templates", b.templates.filter((t) => t && t.name).map((t) => ({ id: t.id || randomUUID(), name: String(t.name), guide: String(t.guide || "") })));
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 405, { error: "지원하지 않는 요청" });
}

// ───────────────────────── 추천 주제 TOP 5 ─────────────────────────
// 네이버 실시간 검색어는 2021년에 폐지되어 "지금 많이 검색되는 단어"를 직접 가져올 공식 방법이 없습니다.
// 그래서 ① AI가 최신 지역 소식·세금 일정을 검색해 주제를 고르고
//        ② (선택) 네이버 데이터랩으로 그 주제들의 실제 최근 검색 추세를 붙입니다.

const TOPIC_REFRESH_HOURS = Number(process.env.TOPIC_REFRESH_HOURS) || 12;
const NAVER_ID = process.env.NAVER_CLIENT_ID;
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;
const DATALAB_URL = process.env.NAVER_DATALAB_URL || "https://openapi.naver.com/v1/datalab/search";
const TOPIC_CATEGORIES = ["지역 이슈", "신고·납부 기한", "세법 개정", "부동산·토지", "생활 세금"];
// 근거로 삼지 않을 사이트(블로그·카페)
const NON_OFFICIAL_DOMAINS = ["blog.naver.com", "cafe.naver.com", "tistory.com", "brunch.co.kr", "blog.daum.net", "cafe.daum.net"];

const TOPICS_SCHEMA = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      description: "추천 주제 정확히 5개, 1위부터 순서대로",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "블로그 글 주제 (40자 이내)" },
          keywords: { type: "array", items: { type: "string" }, description: "사람들이 네이버에 실제로 검색할 만한 짧은 검색어 1~3개" },
          category: { type: "string", enum: TOPIC_CATEGORIES },
          reason: { type: "string", description: "지금 관심이 높을 것으로 보는 이유 한두 문장, 근거가 된 날짜·사건 포함" },
          angle: { type: "string", description: "글을 어떤 방향으로 쓰면 좋을지 한두 문장" },
          interest: { type: "integer", description: "예상 관심도 1~100 (AI 추정치)" },
        },
        required: ["title", "keywords", "category", "reason", "angle", "interest"],
        additionalProperties: false,
      },
    },
  },
  required: ["topics"],
  additionalProperties: false,
};

let topicJob = null; // 동시에 두 번 만들지 않도록

function kstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

async function researchTopics(region) {
  const today = kstDate();
  const messages = [
    {
      role: "user",
      content: `오늘은 ${today}입니다. ${region}에서 세무사가 운영하는 네이버 블로그에 올릴 글감을 찾고 있습니다.
웹검색으로 다음을 조사해 메모로 정리해 주세요.

1. 오늘부터 약 6주 안에 있는 세금 신고·납부 기한 (국세청 신고 일정, 지방세 납부 일정). 날짜를 정확히 적고, 기한이 휴일이면 연장 여부도 적어 주세요.
2. ${region} 지역 소식 중 주민·사업자의 세금 문제와 연결될 만한 것 (개발사업·토지 보상·산업단지·부동산 거래·농지·지역 상권·지자체 지원금 등). 최근 3개월 이내 뉴스나 ${region}청 발표 위주로 찾아 주세요.
3. 최근 시행됐거나 곧 시행되는 세법 개정 중 개인·소상공인·농업인에게 영향이 큰 것.
4. 이 시기에 사람들이 네이버에서 많이 찾아볼 만한 세금 질문.

각 항목마다 날짜와 출처 URL을 적어 주세요. 블로그·카페 글은 근거로 쓰지 마세요. 확인되지 않은 내용은 "확인 필요"라고 적어 주세요.`,
    },
  ];
  const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 8, blocked_domains: NON_OFFICIAL_DOMAINS, user_location: { type: "approximate", country: "KR", region: "Gyeonggi-do", timezone: "Asia/Seoul" } }];
  const sources = [];
  let notes = "";
  for (let turn = 0; turn < 4; turn++) {
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      tools,
      messages,
    });
    const refused = refusalMessage(msg);
    if (refused) throw new Error(refused);
    notes += textOf(msg);
    for (const block of msg.content) {
      if (block.type === "text" && Array.isArray(block.citations)) {
        for (const c of block.citations) {
          if (c.url && !sources.some((s) => s.url === c.url)) sources.push({ url: c.url, title: c.title || c.url });
        }
      }
    }
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  return { notes, sources };
}

async function pickTopics(region, notes, previous) {
  const msg = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 6000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: TOPICS_SCHEMA } },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system:
      "당신은 세무사 블로그의 편집장입니다. 조사 메모만 근거로 삼아, 지금 글을 쓰면 방문자가 가장 많이 올 것 같은 주제 5개를 고릅니다. 메모에 없는 날짜·수치는 만들지 않습니다. 과장·낚시성 제목은 피합니다.",
    messages: [
      {
        role: "user",
        content: `지역: ${region}\n오늘: ${kstDate()}\n\n선정 기준:
- 마감이 임박한 신고·납부 기한은 검색이 몰리므로 우선
- ${region} 지역 소식과 연결된 주제를 최소 2개 포함
- 5개의 분류가 한쪽으로 몰리지 않게
- 너무 넓은 주제(예: "절세 방법")보다 구체적인 주제
${previous.length ? `- 직전 목록: ${previous.join(" / ")} (여전히 유효하면 유지해도 됨)\n` : ""}
<조사_메모>\n${notes.slice(0, 30000)}\n</조사_메모>`,
      },
    ],
  });
  const refused = refusalMessage(msg);
  if (refused) throw new Error(refused);
  const { topics } = JSON.parse(textOf(msg));
  return topics.slice(0, 5).map((t, i) => ({
    rank: i + 1,
    title: t.title,
    keywords: t.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 3),
    category: t.category,
    reason: t.reason,
    angle: t.angle,
    interest: Math.max(1, Math.min(100, Math.round(t.interest))),
  }));
}

// 네이버 데이터랩: 최근 4주 일별 검색 추이 (5개 주제끼리 비교한 상대값, 전국 기준)
async function attachTrends(topics) {
  if (!NAVER_ID || !NAVER_SECRET) return null;
  const end = new Date(Date.now() - 86400_000);
  const start = new Date(end.getTime() - 27 * 86400_000);
  try {
    const res = await fetch(DATALAB_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET },
      body: JSON.stringify({
        startDate: kstDate(start),
        endDate: kstDate(end),
        timeUnit: "date",
        keywordGroups: topics.map((t) => ({ groupName: `${t.rank}. ${t.title}`.slice(0, 100), keywords: t.keywords.length ? t.keywords : [t.title] })),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return `네이버 데이터랩 연결 실패(${res.status}): ${data.errorMessage || data.message || "키나 사용 설정을 확인해 주세요"}`;
    for (const [i, r] of (data.results || []).entries()) {
      const series = (r.data || []).map((d) => d.ratio);
      if (!topics[i] || !series.length) continue;
      const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
      const last7 = avg(series.slice(-7));
      const prev7 = avg(series.slice(-14, -7));
      topics[i].trend = {
        series: series.map((v) => Math.round(v * 10) / 10),
        level: Math.round(last7 * 10) / 10,
        change: prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : null,
      };
    }
    return null;
  } catch (err) {
    return `네이버 데이터랩 연결 실패: ${err.message}`;
  }
}

async function saveTopicsDoc(region, topics, sources, extra = {}) {
  const old = await readStore("topics", null);
  // 순위 변동 표시용: 직전 목록에서 같은 대표 검색어(또는 같은 제목)가 몇 위였는지
  for (const t of topics) {
    const before = old?.topics?.find((o) => (o.keywords?.[0] && o.keywords[0] === t.keywords[0]) || o.title === t.title);
    t.prevRank = before ? before.rank : null;
  }
  const trendError = await attachTrends(topics);
  const doc = { region, generatedAt: new Date().toISOString(), topics, sources: sources.slice(0, 15), trendError, mode: "ai", ...extra };
  await writeStore("topics", doc);
  return doc;
}

async function generateTopics() {
  const settings = await readStore("settings", { region: "안성시" });
  const old = await readStore("topics", null);
  const { notes, sources } = await researchTopics(settings.region);
  const topics = await pickTopics(settings.region, notes, old?.topics?.map((t) => t.title) || []);
  return saveTopicsDoc(settings.region, topics, sources);
}

function startTopicJob() {
  if (!topicJob) {
    topicJob = generateTopics()
      .then((doc) => ({ ok: true, doc }))
      .catch((err) => {
        console.error(err);
        return { ok: false, error: apiErrorMessage(err) };
      })
      .finally(() => setTimeout(() => (topicJob = null), 0));
  }
  return topicJob;
}

let lastTopicError = null;

async function handleTopics(req, res, action) {
  const settings = await readStore("settings", { region: "안성시" });
  if (req.method === "GET" && !action) {
    const doc = await readStore("topics", null);
    const ageHours = doc ? (Date.now() - new Date(doc.generatedAt).getTime()) / 3600_000 : Infinity;
    const stale = !doc || ageHours >= TOPIC_REFRESH_HOURS || doc.region !== settings.region;
    // 오래됐으면 화면을 연 김에 뒤에서 새로 만들기 (실패한 직후에는 자동으로 다시 시도하지 않음)
    if (stale && client && !topicJob && !(lastTopicError && Date.now() - lastTopicError.at < 30 * 60_000)) {
      startTopicJob().then((r) => (lastTopicError = r.ok ? null : { at: Date.now(), message: r.error }));
    }
    return sendJson(res, 200, {
      doc,
      region: settings.region,
      refreshing: Boolean(topicJob),
      refreshHours: TOPIC_REFRESH_HOURS,
      datalab: Boolean(NAVER_ID && NAVER_SECRET),
      aiReady: Boolean(client),
      error: lastTopicError?.message || null,
    });
  }
  if (req.method === "POST" && action === "refresh") {
    if (!client) return sendJson(res, 503, { error: "AI 키가 설정되지 않았습니다." });
    const r = await startTopicJob();
    lastTopicError = r.ok ? null : { at: Date.now(), message: r.error };
    return r.ok ? sendJson(res, 200, { doc: r.doc }) : sendJson(res, 502, { error: r.error });
  }
  if (req.method === "POST" && action === "auto") {
    // 무료 자동 갱신: 세무달력 + 시기별 주제 + 지역 뉴스 (AI 사용 안 함)
    const cal = await readStore("calendar", CAL_DEFAULT);
    const r = await buildAutoTopics({
      region: settings.region,
      today: kstDate(),
      extraHolidays: cal.extraHolidays,
      posts: await readStore("posts", []),
      naver: {
        id: NAVER_ID,
        secret: NAVER_SECRET,
        newsUrl: process.env.NAVER_NEWS_URL || "https://openapi.naver.com/v1/search/news.json",
        rssUrl: process.env.NEWS_RSS_URL,
      },
    });
    const doc = await saveTopicsDoc(settings.region, r.topics, r.sources, { mode: "auto", newsCount: r.newsCount, newsError: r.newsError });
    lastTopicError = null;
    return sendJson(res, 200, { doc });
  }
  if (req.method === "POST" && action === "import") {
    const b = await readBody(req);
    const doc = await importTopics(String(b.text || ""));
    lastTopicError = null;
    return sendJson(res, 200, { doc });
  }
  if (req.method === "PUT" && action === "region") {
    const b = await readBody(req);
    const region = String(b.region || "").trim().slice(0, 30);
    if (!region) return sendJson(res, 400, { error: "지역 이름을 입력해 주세요." });
    await writeStore("settings", { ...settings, region });
    lastTopicError = null;
    return sendJson(res, 200, { region });
  }
  sendJson(res, 405, { error: "지원하지 않는 요청" });
}

// ───────────────────────── 요청문 복사 방식 (추가 비용 없음) ─────────────────────────
// API를 쓰지 않고, 요청문을 만들어 claude.ai(구독 요금에 포함)에 붙여넣게 합니다.

const OFFICIAL_SITES_TEXT = "국가법령정보센터(law.go.kr), 국세청(nts.go.kr), 국세법령정보시스템(taxlaw.nts.go.kr), 기획재정부(moef.go.kr)";

async function buildDraftRequest(body) {
  const parts = [SYSTEM_PROMPT.replace("- 제목은 쓰지 말고 본문만 씁니다.\n", "")];
  if (body.useStyle) {
    const style = await styleSystemBlock();
    if (style) parts.push(style.text);
  }
  parts.push("──────── 이번 글 ────────", draftPrompt(body));
  if (body.webSearch) {
    parts.push(
      `웹 검색을 사용할 수 있다면 ${OFFICIAL_SITES_TEXT} 등 공식 자료로 세율·금액·기한을 확인한 뒤 쓰고(확인에 쓴 법령명·조문 번호는 본문에 쓰지 마세요), 본문 맨 끝에 "참고 자료:" 아래로 출처 링크를 적어 주세요. 블로그·카페 글은 근거로 쓰지 마세요.`
    );
  }
  parts.push(`아래 형식 그대로 답해 주세요. 구분선(=== ===)은 지우지 말고, 형식 밖의 설명은 쓰지 마세요.

===제목 후보===
1. (네이버 검색에 잘 걸리는 제목, 40자 이내, 핵심 검색어를 앞쪽에)
2.
3.
4.
5.
===본문===
(본문. 제목은 넣지 마세요.)
===해시태그===
(해시태그 10개, # 없이 쉼표로 구분, 띄어쓰기 없이)`);
  return parts.join("\n\n");
}

async function buildMetaRequest(body) {
  const style = body.useStyle ? (await readStore("style", { profile: "" })).profile.trim() : "";
  return `네이버 블로그 글의 제목과 해시태그를 추천해 주세요. 과장·낚시성 표현, '무조건/100%' 같은 단정 표현은 피하고, 사람들이 실제로 검색할 말(예: 종합소득세 신고기간, 연말정산 의료비공제)을 자연스럽게 넣어 주세요.
${style ? `\n블로그 주인의 말투 요약(제목 스타일도 이에 맞춰 주세요):\n${style.slice(0, 3000)}\n` : ""}
주제: ${body.topic || "(본문 참고)"}

본문:
${String(body.content || "").slice(0, 12000)}

아래 형식 그대로 답해 주세요.

===제목 후보===
1.
2.
3.
4.
5.
===해시태그===
(해시태그 10개, # 없이 쉼표로 구분, 띄어쓰기 없이)`;
}

async function buildStyleRequest() {
  const samples = await activeSamples();
  if (!samples.length) return null;
  return `아래 블로그 글들을 쓴 사람과 똑같은 말투로 새 글을 쓰려는 작가에게 줄 '말투 지침'을 작성해 주세요.
세법 내용이나 수치는 분석하지 말고, 말투와 형식만 분석해 주세요.

${samples.map((s, i) => `<글 번호="${i + 1}">\n${s.content}\n</글>`).join("\n\n")}

다음 항목별로 짧은 글머리표로, 실제 글에서 가져온 짧은 표현 예시를 따옴표로 곁들여 주세요.
1. 말투·어미 (예: ~습니다/~해요, 독자를 부르는 호칭)
2. 시작 인사와 맺음말
3. 글 구성 순서
4. 소제목 스타일
5. 문단 길이·줄바꿈 습관
6. 강조·목록·표·이모지·기호 사용
7. 자주 쓰는 표현
8. 피하는 표현이나 특징
글 수가 적어 판단하기 어려운 항목은 "판단 어려움"이라고 적어 주세요. 전체 1,500자 이내로, 지침 내용만 답해 주세요. 고객 이름 등 개인정보는 옮겨 적지 마세요.`;
}

// 2차 검증 요청문 (ChatGPT에 붙여넣기)
function buildReviewRequest(body) {
  const today = kstDate();
  return `당신은 대한민국 세법에 밝은 검수 담당자입니다. 아래는 세무사가 네이버 블로그에 올리려는 글(다른 AI가 작성한 초안)입니다.
발행 전 2차 검증을 해 주세요. 오늘은 ${today}입니다.

[검증 기준]
1. 사실 확인: 세율·공제 한도·금액·신고/납부 기한·시행일·적용 귀속연도가 오늘 기준 최신 법령과 맞는지
   - 이 블로그는 본문에 법령명·조문 번호를 쓰지 않는 것이 원칙입니다. 본문에 들어가 있으면 '수정 필요'로 표시하고, 수정안에도 조문 번호를 넣지 마세요. (근거 칸에는 확인에 쓴 법령·조문을 적어도 됩니다)
   - 웹 검색을 사용할 수 있다면 ${OFFICIAL_SITES_TEXT} 등 공식 자료로 확인하고 출처 링크를 적어 주세요.
   - 블로그·카페 글은 근거로 쓰지 마세요.
   - 확인할 수 없으면 추측하지 말고 "확인 불가"로 판정해 주세요.
2. 본문에 [확인 필요]로 표시된 곳은 하나도 빠짐없이 확인해 올바른 내용을 알려 주세요.
3. 계산 예시가 있으면 산식대로 다시 계산해 맞는지 확인해 주세요.
4. 귀속연도(소득이 생긴 해)와 신고연도를 혼동한 곳, 개정 전후 규정을 섞어 쓴 곳이 있는지
5. 독자가 오해하기 쉬운 단정 표현, 예외·요건 누락
6. 세무사 광고로 부적절할 수 있는 표현 (과장·단정·"무조건/100%", 다른 세무사와 비교, 수임료 할인 등)
7. 실명·주민등록번호·연락처 등 개인정보가 들어 있는지

[답변 형식] 아래 형식 그대로, 구분선(=== ===)을 지우지 말고 답해 주세요.

===검증 요약===
판정: (발행 가능 / 수정 후 발행 / 발행 보류 중 하나만)
수정 필요 항목 수: (숫자)
한 줄 의견:
===항목별 검증===
| 번호 | 본문 내용(짧게 인용) | 판정(적정/수정 필요/확인 불가) | 근거(법령·조문·출처 링크) | 수정안 |
|---|---|---|---|---|
===[확인 필요] 확인 결과===
- (본문의 [확인 필요] 각각에 대해: 위치 → 확인된 내용 → 근거)
===표현·광고·개인정보 점검===
- (문제 없으면 "문제 없음")

──────── 검증할 글 ────────
제목: ${body.title || "(제목 없음)"}
${body.topic ? `주제: ${body.topic}
` : ""}
${String(body.content || "")}`;
}

// 2차 검증 결과를 반영한 수정본 요청문 (claude.ai에 붙여넣기)
async function buildFixRequest(body) {
  const parts = [SYSTEM_PROMPT.replace("- 제목은 쓰지 말고 본문만 씁니다.\n", "")];
  if (body.useStyle) {
    const style = await styleSystemBlock();
    if (style) parts.push(style.text);
  }
  parts.push(`──────── 이번 작업: 2차 검증 결과 반영 ────────
아래 [원래 글]을 다른 AI(ChatGPT)가 검증한 [검증 결과]가 있습니다. 검증 결과를 반영해 수정한 전체 글을 만들어 주세요.

[수정 원칙]
1. 검증 결과에서 "수정 필요"로 판정된 항목과 [확인 필요] 확인 결과만 고칩니다. 나머지 문장·말투·구성·서식은 그대로 둡니다.
2. 검증 의견을 그대로 믿지 말고, 반영하기 전에 그 내용이 맞는지 스스로 확인하세요.
   - 웹 검색을 사용할 수 있다면 ${OFFICIAL_SITES_TEXT} 등 공식 자료로 확인하세요.
   - 검증 의견이 틀렸다고 판단되면 반영하지 말고, 수정 내역에 "미반영"과 이유를 적으세요.
3. "확인 불가" 항목이나 확인되지 않은 내용은 지어내지 말고 [확인 필요]로 남겨 두세요.
4. 광고·개인정보 점검에서 지적된 표현은 고쳐 주세요.
5. 세액 계산을 고쳤다면 산식을 다시 검산하세요.
6. 본문에 법령명·조문 번호는 넣지 마세요(이미 있으면 쉬운 말로 바꾸기). 근거는 수정 내역에만 적으세요.

[답변 형식] 아래 형식 그대로, 구분선(=== ===)을 지우지 말고 답해 주세요.

===수정 내역===
- (반영) 원래 문장 → 고친 문장 / 근거
- (미반영) 검증 의견 → 반영하지 않은 이유
===본문===
(수정한 전체 본문. 제목은 넣지 마세요. 고치지 않은 부분도 빠짐없이 전부 써 주세요.)

──────── 원래 글 ────────
제목: ${body.title || "(제목 없음)"}

${String(body.content || "")}

──────── 검증 결과 (ChatGPT) ────────
${String(body.reviewText || "")}`);
  return parts.join("\n\n");
}

// 본문 이미지 요청문 (claude.ai) — 도표형 이미지를 SVG 코드로 받기
function buildBodyImagesRequest(body) {
  const count = Math.max(1, Math.min(4, Number(body.count) || 3));
  return `아래 네이버 블로그 글(세무사 블로그)의 본문에 넣을 도표형 이미지 ${count}개를 SVG 코드로 만들어 주세요.

[중요: 답변 방식]
- 아티팩트(별도 창)를 쓰지 말고, 답변 본문 안의 코드 블록으로 SVG 코드를 그대로 써 주세요. 저는 답변 전체를 복사해서 프로그램에 붙여넣습니다.

[어떤 이미지를 만들지]
- 글 내용을 한눈에 이해하도록 돕는 이미지를 고르세요. 예: 핵심 요약 카드, 신고·납부 일정표, 대상/비대상 비교표, 준비서류 체크리스트, 계산 흐름(산식) 그림
- 각 이미지는 본문의 한 소제목 내용을 담고, 그 소제목 바로 아래에 넣을 것입니다.

[정확성 — 반드시 지킬 것]
- 본문에 있는 내용·숫자·날짜만 쓰세요. 새로운 수치나 내용을 만들지 마세요.
- 본문에서 [확인 필요]로 표시된 수치는 이미지에 넣지 마세요.
- 맞춤법을 지키고, 글자를 생략하거나 줄이지 마세요.
- 법령명·조문 번호는 이미지에 넣지 마세요.
- 실명·연락처 등 개인정보, 광고 문구는 넣지 마세요.

[SVG 규칙]
- <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="(600~1500 사이)" viewBox="0 0 1200 (같은 높이)"> 로 시작
- 맨 처음에 흰색 배경 사각형을 깔아 주세요.
- 글꼴: font-family="'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif"
- 글자 크기: 제목 44~52, 본문 최소 28 (작은 글씨 금지). 한 줄은 한글 26자 이내로 직접 줄바꿈(<tspan> 또는 여러 <text>)하고, 글자가 상자 밖으로 넘치지 않게 여백을 넉넉히 두세요.
- 색: 주색 #03a94d, 진한 글자 #1d2320, 연한 배경 #e6f6ec, 회색 #6b746f, 강조 빨강 #d64545 (주의·마감 표시에만)
- 사용 금지: <script>, <foreignObject>, 외부 이미지·링크, 이모지, 그림자 효과 과다 사용
- 단정하고 전문적인 느낌, 인쇄해도 또렷하게

[답변 형식] 이미지마다 아래 형식으로, 구분선을 지우지 말고 써 주세요.

===이미지 1===
위치: (이미지를 넣을 본문 소제목을 ## 없이 그대로)
설명: (이미지 내용 한 줄)
\`\`\`svg
<svg ...>...</svg>
\`\`\`

──────── 블로그 글 ────────
제목: ${body.title || "(제목 없음)"}

${String(body.content || "")}`;
}

// 대표 이미지 요청문 (ChatGPT 이미지 생성)
function buildThumbRequest(body) {
  const withText = body.withText === true;
  const title = String(body.title || body.topic || "").trim();
  return `네이버 블로그 대표 이미지(썸네일)를 만들어 주세요. 이미지 생성 기능으로 그림 한 장을 만들어 주세요.

[글 정보]
- 블로그 성격: 대한민국 세무사가 운영하는 세금 정보 블로그
- 글 제목: ${title || "(제목 없음)"}
${body.topic && body.topic !== title ? `- 주제: ${body.topic}
` : ""}
[그림 조건]
- 정사각형(1:1), 고해상도
- 깔끔하고 신뢰감 있는 전문가 블로그 느낌. 과장되거나 유치한 느낌은 피해 주세요.
- 색감: 초록(#03a94d) 계열을 중심으로 흰색·짙은 남색을 곁들인 밝고 단정한 색
- 글 주제와 어울리는 소재를 단순하게 표현 (예: 서류, 계산기, 달력, 집·토지, 동전, 체크리스트 등 주제에 맞게)
- 실존 인물·유명인 얼굴, 회사 로고·상표, 워터마크는 넣지 마세요.
${withText
  ? `- 그림 아래쪽에 다음 글자를 크고 또렷하게 넣어 주세요(맞춤법 그대로, 글자 하나도 바꾸지 말 것): "${title}"
- 한글이 깨지거나 틀리면 다시 만들어 주세요.`
  : `- 그림 안에 글자·숫자·기호를 절대 넣지 마세요. (제목 글자는 제가 따로 얹습니다)
- 아래쪽 3분의 1은 제목 글자를 얹을 수 있도록 단순한 배경(복잡한 무늬 없이)으로 비워 주세요.`}`;
}

async function buildTopicsRequest() {
  const { region } = await readStore("settings", { region: "안성시" });
  const old = await readStore("topics", null);
  const today = kstDate();
  const cal = await readStore("calendar", CAL_DEFAULT);
  const soon = upcoming(today, 45, cal.extraHolidays)
    .filter((e) => e.level >= 2)
    .map((e) => `- ${e.due}(${weekday(e.due)}) ${e.name}${e.shifted ? ` (법정 ${e.legal}, 휴일로 연장)` : ""}`)
    .join("\n");
  return `오늘은 ${today}입니다. 저는 ${region}에서 일하는 세무사이고, 네이버 블로그에 올릴 글감을 찾고 있습니다.
웹 검색으로 아래를 조사한 뒤, 지금 글을 쓰면 방문자가 가장 많이 올 것 같은 주제 5개를 골라 주세요.

[조사할 것]
1. 오늘부터 약 6주 안에 있는 세금 신고·납부 기한 (국세청 신고 일정, 지방세 납부 일정). 기한이 휴일이면 연장 여부도 확인.
2. ${region} 지역 소식 중 주민·사업자의 세금 문제와 연결될 만한 것 (개발사업·토지 보상·산업단지·부동산 거래·농지·지역 상권·지자체 지원금 등). 최근 3개월 이내 뉴스나 ${region}청 발표 위주.
3. 최근 시행됐거나 곧 시행되는 세법 개정 중 개인·소상공인·농업인에게 영향이 큰 것.
4. 이 시기에 사람들이 네이버에서 많이 찾아볼 만한 세금 질문.

${soon ? `[참고: 제 앱의 세무달력 기준 45일 안의 주요 기한 — 맞는지 함께 확인해 주세요]\n${soon}\n\n` : ""}[고르는 기준]
- 마감이 임박한 신고·납부 기한은 검색이 몰리므로 우선
- ${region} 지역 소식과 연결된 주제를 최소 2개 포함
- 5개의 분류가 한쪽으로 몰리지 않게, 너무 넓은 주제(예: "절세 방법")보다 구체적인 주제
- 블로그·카페 글은 근거로 쓰지 말고, 확인되지 않은 날짜·수치는 만들지 말 것
${old?.topics?.length ? `- 직전 목록: ${old.topics.map((t) => t.title).join(" / ")} (여전히 유효하면 유지해도 됨)\n` : ""}
[답변 형식]
아래 JSON만 코드 블록 하나로 답해 주세요. 다른 설명은 쓰지 마세요.
category는 ${TOPIC_CATEGORIES.map((c) => `"${c}"`).join(", ")} 중 하나, interest는 예상 관심도 1~100입니다.

\`\`\`json
{
  "topics": [
    {
      "title": "블로그 글 주제 (40자 이내)",
      "keywords": ["사람들이 네이버에 검색할 짧은 검색어 1~3개"],
      "category": "신고·납부 기한",
      "reason": "지금 관심이 높을 것으로 보는 이유 한두 문장 (근거가 된 날짜·사건 포함)",
      "angle": "글을 어떤 방향으로 쓰면 좋을지 한두 문장",
      "interest": 80
    }
  ],
  "sources": [{ "title": "자료 제목", "url": "https://..." }]
}
\`\`\``;
}

// claude.ai 답변(JSON)을 추천 주제로 저장
async function importTopics(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw Object.assign(new Error("답변에서 JSON을 찾지 못했습니다. claude.ai 답변의 코드 블록을 그대로 복사해 주세요."), { status: 400 });
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw Object.assign(new Error("답변 형식이 올바르지 않습니다. 코드 블록 오른쪽 위 복사 버튼으로 복사해 주세요."), { status: 400 });
  }
  const list = Array.isArray(parsed.topics) ? parsed.topics : [];
  const topics = list
    .filter((t) => t && typeof t.title === "string" && t.title.trim())
    .slice(0, 5)
    .map((t, i) => ({
      rank: i + 1,
      title: t.title.trim().slice(0, 80),
      keywords: (Array.isArray(t.keywords) ? t.keywords : []).map((k) => String(k).trim()).filter(Boolean).slice(0, 3),
      category: TOPIC_CATEGORIES.includes(t.category) ? t.category : "생활 세금",
      reason: String(t.reason || "").slice(0, 400),
      angle: String(t.angle || "").slice(0, 400),
      interest: Math.max(1, Math.min(100, Math.round(Number(t.interest) || 50))),
    }));
  if (!topics.length) throw Object.assign(new Error("답변에 주제가 없습니다."), { status: 400 });
  for (const t of topics) if (!t.keywords.length) t.keywords = [t.title];
  const sources = (Array.isArray(parsed.sources) ? parsed.sources : [])
    .filter((s) => s && /^https?:\/\//.test(s.url || ""))
    .slice(0, 15)
    .map((s) => ({ url: String(s.url), title: String(s.title || s.url).slice(0, 200) }));
  const { region } = await readStore("settings", { region: "안성시" });
  return saveTopicsDoc(region, topics, sources);
}

async function handlePromptRequest(req, res, kind) {
  const body = req.method === "POST" ? await readBody(req) : {};
  let text = null;
  if (kind === "draft") {
    if (!String(body.topic || "").trim()) return sendJson(res, 400, { error: "주제를 입력해 주세요." });
    text = await buildDraftRequest(body);
  } else if (kind === "meta") {
    if (!String(body.content || "").trim() && !String(body.topic || "").trim()) return sendJson(res, 400, { error: "주제나 본문을 먼저 입력해 주세요." });
    text = await buildMetaRequest(body);
  } else if (kind === "style") {
    text = await buildStyleRequest();
    if (!text) return sendJson(res, 400, { error: "'반영'으로 켜 둔 내 글이 없습니다. 먼저 글을 1개 이상 추가해 주세요." });
  } else if (kind === "topics") {
    text = await buildTopicsRequest();
  } else if (kind === "bodyimages") {
    if (!String(body.content || "").trim()) return sendJson(res, 400, { error: "본문을 먼저 완성해 주세요." });
    text = buildBodyImagesRequest(body);
  } else if (kind === "thumb") {
    if (!String(body.title || body.topic || "").trim()) return sendJson(res, 400, { error: "제목을 먼저 입력해 주세요." });
    text = buildThumbRequest(body);
  } else if (kind === "fix") {
    if (!String(body.content || "").trim()) return sendJson(res, 400, { error: "본문이 없습니다." });
    if (!String(body.reviewText || "").trim()) return sendJson(res, 400, { error: "먼저 2차 검증 결과를 저장해 주세요." });
    text = await buildFixRequest(body);
  } else if (kind === "review") {
    if (!String(body.content || "").trim()) return sendJson(res, 400, { error: "검증할 본문이 없습니다." });
    text = buildReviewRequest(body);
  } else return sendJson(res, 404, { error: "not found" });
  sendJson(res, 200, { text });
}

// ───────────────────────── 세무달력 (내 일정·추가 휴일) ─────────────────────────

const CAL_DEFAULT = { extraHolidays: {}, events: [] };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function handleCalendar(req, res, sub, id) {
  const cal = await readStore("calendar", CAL_DEFAULT);
  if (req.method === "GET" && !sub) return sendJson(res, 200, cal);
  if (sub === "holidays" && req.method === "POST") {
    const b = await readBody(req);
    if (!DATE_RE.test(b.date || "")) return sendJson(res, 400, { error: "날짜를 확인해 주세요." });
    cal.extraHolidays[b.date] = String(b.name || "임시공휴일").slice(0, 30);
    await writeStore("calendar", cal);
    return sendJson(res, 200, cal);
  }
  if (sub === "holidays" && req.method === "DELETE" && DATE_RE.test(id || "")) {
    delete cal.extraHolidays[id];
    await writeStore("calendar", cal);
    return sendJson(res, 200, cal);
  }
  if (sub === "events" && req.method === "POST") {
    const b = await readBody(req);
    if (!DATE_RE.test(b.date || "") || !String(b.title || "").trim()) return sendJson(res, 400, { error: "날짜와 일정 이름을 입력해 주세요." });
    cal.events.push({ id: randomUUID(), date: b.date, title: String(b.title).trim().slice(0, 100), note: String(b.note || "").slice(0, 500) });
    await writeStore("calendar", cal);
    return sendJson(res, 200, cal);
  }
  if (sub === "events" && req.method === "DELETE" && id) {
    cal.events = cal.events.filter((e) => e.id !== id);
    await writeStore("calendar", cal);
    return sendJson(res, 200, cal);
  }
  sendJson(res, 405, { error: "지원하지 않는 요청" });
}

// ───────────────────────── 자동 백업 ─────────────────────────
// 하루 한 번 data 폴더 전체를 날짜별 폴더로 복사합니다. 최근 30일치만 보관합니다.
// 기본 위치: 프로그램 폴더의 backups. 설정에서 OneDrive 등 다른 폴더로 바꿀 수 있습니다.
const DEFAULT_BACKUP_DIR = path.join(here, "backups");
const BACKUP_KEEP_DAYS = 30;
let backupRunning = null;

async function backupDir() {
  const settings = await readStore("settings", { region: "안성시" });
  return settings.backupDir || DEFAULT_BACKUP_DIR;
}

function oneDriveSuggestion() {
  const base = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
  return base ? path.join(base, "블로그도우미 백업") : null;
}

async function runBackup({ force = false } = {}) {
  if (backupRunning) return backupRunning;
  backupRunning = (async () => {
    const dir = await backupDir();
    const today = kstDate();
    const target = path.join(dir, today);
    const status = await readStore("backup-status", {});
    if (!force && status.lastDate === today && status.dir === dir) return { skipped: true, ...status };
    try {
      await fs.access(DATA_DIR);
    } catch {
      return { skipped: true, reason: "아직 저장된 자료가 없습니다." };
    }
    await fs.mkdir(dir, { recursive: true });
    // 같은 날 다시 백업하면 덮어씀
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(DATA_DIR, target, {
      recursive: true,
      filter: (src) => !src.endsWith(".tmp") && path.basename(src) !== "backup-status.json",
    });
    // 오래된 백업 정리 (날짜 이름 폴더만)
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dated = entries.filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name)).map((e) => e.name).sort();
    for (const old of dated.slice(0, Math.max(0, dated.length - BACKUP_KEEP_DAYS))) {
      await fs.rm(path.join(dir, old), { recursive: true, force: true });
    }
    const result = { lastDate: today, lastAt: new Date().toISOString(), dir, kept: Math.min(dated.length, BACKUP_KEEP_DAYS), error: null };
    await writeStore("backup-status", result);
    return result;
  })()
    .catch(async (err) => {
      const result = { ...(await readStore("backup-status", {})), error: `자동 백업 실패: ${err.message}`, errorAt: new Date().toISOString() };
      await writeStore("backup-status", result).catch(() => {});
      console.error("  ⚠ 자동 백업 실패:", err.message);
      return result;
    })
    .finally(() => (backupRunning = null));
  return backupRunning;
}

async function handleAutoBackup(req, res, action) {
  if (req.method === "GET" && !action) {
    return sendJson(res, 200, {
      status: await readStore("backup-status", {}),
      dir: await backupDir(),
      defaultDir: DEFAULT_BACKUP_DIR,
      oneDrive: oneDriveSuggestion(),
      keepDays: BACKUP_KEEP_DAYS,
    });
  }
  if (req.method === "POST" && action === "run") {
    const r = await runBackup({ force: true });
    return r.error ? sendJson(res, 500, { error: r.error }) : sendJson(res, 200, { status: r });
  }
  if (req.method === "PUT" && action === "dir") {
    const b = await readBody(req);
    const dir = String(b.dir || "").trim();
    const settings = await readStore("settings", { region: "안성시" });
    if (!dir) {
      delete settings.backupDir; // 기본 위치로
    } else {
      if (!path.isAbsolute(dir)) return sendJson(res, 400, { error: "폴더 전체 경로를 입력해 주세요. 예: C:\\Users\\이름\\OneDrive\\블로그도우미 백업" });
      try {
        await fs.mkdir(dir, { recursive: true });
        const probe = path.join(dir, ".write-test");
        await fs.writeFile(probe, "ok");
        await fs.rm(probe);
      } catch (err) {
        return sendJson(res, 400, { error: `이 폴더에 저장할 수 없습니다: ${err.message}` });
      }
      settings.backupDir = dir;
    }
    await writeStore("settings", settings);
    const r = await runBackup({ force: true });
    return r.error ? sendJson(res, 500, { error: r.error }) : sendJson(res, 200, { status: r, dir: await backupDir() });
  }
  sendJson(res, 405, { error: "지원하지 않는 요청" });
}

// ───────────────────────── 라우팅 ─────────────────────────

async function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: "forbidden" });
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "not found" });
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (pathname === "/api/status") return sendJson(res, 200, { aiReady: Boolean(client), model: MODEL });
    const aiRoutes = { "/api/draft": handleDraft, "/api/meta": handleMeta, "/api/style/analyze": handleStyleAnalyze };
    if (aiRoutes[pathname]) {
      if (req.method !== "POST") return sendJson(res, 405, { error: "POST만 가능" });
      if (!client) return sendJson(res, 503, { error: "AI 키가 설정되지 않았습니다. README의 '처음 한 번 설정'을 따라 .env 파일에 ANTHROPIC_API_KEY를 넣어 주세요." });
      return await aiRoutes[pathname](req, res);
    }
    const topicMatch = pathname.match(/^\/api\/topics(?:\/(refresh|region|import|auto))?$/);
    if (topicMatch) return await handleTopics(req, res, topicMatch[1]);
    const calMatch = pathname.match(/^\/api\/calendar(?:\/(holidays|events)(?:\/([\w-]+))?)?$/);
    if (calMatch) return await handleCalendar(req, res, calMatch[1], calMatch[2]);
    const promptMatch = pathname.match(/^\/api\/prompt\/(draft|meta|style|topics|review|fix|bodyimages|thumb)$/);
    if (promptMatch) return await handlePromptRequest(req, res, promptMatch[1]);
    const sampleMatch = pathname.match(/^\/api\/samples(?:\/([\w-]+))?$/);
    if (sampleMatch) return await handleSamples(req, res, sampleMatch[1]);
    if (pathname === "/api/style") return await handleStyle(req, res);
    const imgMatch = pathname.match(/^\/api\/images\/([\w-]+-bg\.(?:png|jpg|webp))$/);
    if (imgMatch && req.method === "GET") {
      try {
        const data = await fs.readFile(path.join(IMAGE_DIR, imgMatch[1]));
        const ext = imgMatch[1].split(".").pop();
        res.writeHead(200, { "Content-Type": { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[ext], "Cache-Control": "no-cache" });
        return res.end(data);
      } catch {
        return sendJson(res, 404, { error: "이미지가 없습니다." });
      }
    }
    const postMatch = pathname.match(/^\/api\/posts(?:\/([\w-]+)(?:\/(history|thumbbg))?)?$/);
    if (postMatch) return await handlePosts(req, res, postMatch[1], postMatch[2]);
    const tplMatch = pathname.match(/^\/api\/templates(?:\/([\w-]+))?$/);
    if (tplMatch) return await handleTemplates(req, res, tplMatch[1]);
    if (pathname === "/api/backup") return await handleBackup(req, res);
    const abMatch = pathname.match(/^\/api\/autobackup(?:\/(run|dir))?$/);
    if (abMatch) return await handleAutoBackup(req, res, abMatch[1]);
    if (req.method === "GET") return await serveStatic(req, res, pathname);
    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message || "서버 오류" });
    else res.end();
  }
});

// 내 컴퓨터에서만 접속되도록 127.0.0.1 에만 연결
process.title = "블로그 글 도우미 - 이 창을 닫으면 프로그램이 꺼집니다";

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`\n  이미 프로그램이 실행 중입니다 → http://localhost:${PORT}\n`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, "127.0.0.1", async () => {
  console.log(`\n  블로그 글 작성 도우미 실행 중 → http://localhost:${PORT}`);
  console.log("  (이 창을 닫으면 프로그램이 꺼집니다. 최소화해 두세요.)\n");
  if (client) console.log("  ⚠ ANTHROPIC_API_KEY 가 설정되어 있어 AI 기능 사용 시 API 요금이 나옵니다.\n");
  // 시작할 때, 그리고 켜 둔 동안 1시간마다 오늘 백업이 있는지 확인
  const check = async () => {
    const r = await runBackup();
    if (r && !r.skipped && !r.error) console.log(`  자동 백업 완료 → ${path.join(r.dir, r.lastDate)}`);
  };
  check();
  setInterval(check, 60 * 60 * 1000).unref();
});
