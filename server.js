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
    // 웹검색을 쓰면 서버가 중간에 멈추고(pause_turn) 이어 쓰기를 요청할 수 있어 몇 번 반복
    for (let turn = 0; turn < 4; turn++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
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
          content: `주제: ${body.topic || "(본문 참고)"}\n\n본문:\n${(body.content || "").slice(0, 12000)}`,
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

// 전체 백업 / 복원
async function handleBackup(req, res) {
  if (req.method === "GET") {
    const payload = {
      exportedAt: new Date().toISOString(),
      posts: await readStore("posts", []),
      templates: await readStore("templates", DEFAULT_TEMPLATES),
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
    await writeStore(`before-restore-${stamp}`, { posts: await readStore("posts", []), templates: await readStore("templates", DEFAULT_TEMPLATES) });
    await writeStore("posts", b.posts.map((p) => cleanPost(p, { id: p.id, createdAt: p.createdAt })));
    await writeStore("templates", b.templates.filter((t) => t && t.name).map((t) => ({ id: t.id || randomUUID(), name: String(t.name), guide: String(t.guide || "") })));
    return sendJson(res, 200, { ok: true });
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
    if (pathname === "/api/status") return sendJson(res, 200, { aiReady: hasKey, model: MODEL });
    if (pathname === "/api/draft" || pathname === "/api/meta") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "POST만 가능" });
      if (!client) return sendJson(res, 503, { error: "AI 키가 설정되지 않았습니다. README의 '처음 한 번 설정'을 따라 .env 파일에 ANTHROPIC_API_KEY를 넣어 주세요." });
      return pathname === "/api/draft" ? await handleDraft(req, res) : await handleMeta(req, res);
    }
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
