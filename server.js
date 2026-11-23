// 세무사용 네이버 블로그 글 작성 도우미 — 서버
// 실행: npm start  →  브라우저에서 http://localhost:3000
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const DATA_DIR = path.join(here, "data");
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

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const client = hasKey ? new Anthropic() : null;

// ───────────────────────── 저장소 (data/*.json) ─────────────────────────

const DEFAULT_TEMPLATES = [
  {
    id: "tpl-column",
    name: "세무 칼럼",
    guide:
      "1) 도입: 독자가 겪는 상황 한 문단\n2) 결론 먼저: 가능/불가능, 해당/비해당\n3) 적용 요건과 법령 근거(법령명·조문)\n4) 사례로 쉽게 풀기(숫자 예시)\n5) 놓치기 쉬운 점·주의사항\n6) 요약 3줄",
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

async function readStore(name, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, `${name}.json`), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return structuredClone(fallback);
    throw err;
  }
}

async function writeStore(name, value) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `${name}.json`);
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
- 법령 근거는 법령명과 조문을 적습니다. 확실하지 않은 조문 번호·금액·세율·기한은 지어내지 말고 그 자리에 [확인 필요]라고 표시합니다.
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

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw Object.assign(new Error("요청이 너무 큽니다."), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function apiErrorMessage(err) {
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
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

async function handlePosts(req, res, id) {
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
    posts[idx] = cleanPost(await readBody(req), posts[idx]);
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

async function saveTopicsDoc(region, topics, sources) {
  const old = await readStore("topics", null);
  // 순위 변동 표시용: 직전 목록에서 같은 대표 검색어(또는 같은 제목)가 몇 위였는지
  for (const t of topics) {
    const before = old?.topics?.find((o) => (o.keywords?.[0] && o.keywords[0] === t.keywords[0]) || o.title === t.title);
    t.prevRank = before ? before.rank : null;
  }
  const trendError = await attachTrends(topics);
  const doc = { region, generatedAt: new Date().toISOString(), topics, sources: sources.slice(0, 15), trendError };
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
      `웹 검색을 사용할 수 있다면 ${OFFICIAL_SITES_TEXT} 등 공식 자료로 세율·금액·기한·조문을 확인한 뒤 쓰고, 본문 맨 끝에 "참고 자료:" 아래로 출처 링크를 적어 주세요. 블로그·카페 글은 근거로 쓰지 마세요.`
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

async function buildTopicsRequest() {
  const { region } = await readStore("settings", { region: "안성시" });
  const old = await readStore("topics", null);
  const today = kstDate();
  return `오늘은 ${today}입니다. 저는 ${region}에서 일하는 세무사이고, 네이버 블로그에 올릴 글감을 찾고 있습니다.
웹 검색으로 아래를 조사한 뒤, 지금 글을 쓰면 방문자가 가장 많이 올 것 같은 주제 5개를 골라 주세요.

[조사할 것]
1. 오늘부터 약 6주 안에 있는 세금 신고·납부 기한 (국세청 신고 일정, 지방세 납부 일정). 기한이 휴일이면 연장 여부도 확인.
2. ${region} 지역 소식 중 주민·사업자의 세금 문제와 연결될 만한 것 (개발사업·토지 보상·산업단지·부동산 거래·농지·지역 상권·지자체 지원금 등). 최근 3개월 이내 뉴스나 ${region}청 발표 위주.
3. 최근 시행됐거나 곧 시행되는 세법 개정 중 개인·소상공인·농업인에게 영향이 큰 것.
4. 이 시기에 사람들이 네이버에서 많이 찾아볼 만한 세금 질문.

[고르는 기준]
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
  } else return sendJson(res, 404, { error: "not found" });
  sendJson(res, 200, { text });
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
    if (pathname === "/api/status") return sendJson(res, 200, { aiReady: hasKey, model: MODEL });
    const aiRoutes = { "/api/draft": handleDraft, "/api/meta": handleMeta, "/api/style/analyze": handleStyleAnalyze };
    if (aiRoutes[pathname]) {
      if (req.method !== "POST") return sendJson(res, 405, { error: "POST만 가능" });
      if (!client) return sendJson(res, 503, { error: "AI 키가 설정되지 않았습니다. README의 '처음 한 번 설정'을 따라 .env 파일에 ANTHROPIC_API_KEY를 넣어 주세요." });
      return await aiRoutes[pathname](req, res);
    }
    const topicMatch = pathname.match(/^\/api\/topics(?:\/(refresh|region|import))?$/);
    if (topicMatch) return await handleTopics(req, res, topicMatch[1]);
    const promptMatch = pathname.match(/^\/api\/prompt\/(draft|meta|style|topics)$/);
    if (promptMatch) return await handlePromptRequest(req, res, promptMatch[1]);
    const sampleMatch = pathname.match(/^\/api\/samples(?:\/([\w-]+))?$/);
    if (sampleMatch) return await handleSamples(req, res, sampleMatch[1]);
    if (pathname === "/api/style") return await handleStyle(req, res);
    const postMatch = pathname.match(/^\/api\/posts(?:\/([\w-]+))?$/);
    if (postMatch) return await handlePosts(req, res, postMatch[1]);
    const tplMatch = pathname.match(/^\/api\/templates(?:\/([\w-]+))?$/);
    if (tplMatch) return await handleTemplates(req, res, tplMatch[1]);
    if (pathname === "/api/backup") return await handleBackup(req, res);
    if (req.method === "GET") return await serveStatic(req, res, pathname);
    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message || "서버 오류" });
    else res.end();
  }
});

// 내 컴퓨터에서만 접속되도록 127.0.0.1 에만 연결
server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  블로그 글 작성 도우미 실행 중 → http://localhost:${PORT}\n`);
  if (!hasKey) console.log("  ⚠ ANTHROPIC_API_KEY 가 없습니다. AI 기능 없이 글 보관·복사만 사용할 수 있습니다.\n");
});
