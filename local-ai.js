// 내 PC의 공식 AI 도구로 자동 실행 (추가 비용 없음 — 구독 요금제 사용 한도 안에서)
//
// - Claude Code (Anthropic 공식): claude.ai Pro·Max 구독 계정으로 로그인해 사용
// - Codex (OpenAI 공식): ChatGPT Plus 이상 구독 계정으로 로그인해 사용
//
// 요청문은 표준 입력(stdin)으로만 넘깁니다(명령어 줄에 넣지 않음).
// API 키 환경변수는 자식 프로세스에서 지워서, 실수로 API 요금이 나가지 않게 합니다.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const IS_WIN = process.platform === "win32";
const RUN_TIMEOUT_MS = 6 * 60 * 1000;

// 요금이 나갈 수 있는 API 키·클라우드 설정은 자동 실행에 넘기지 않음
function safeEnv() {
  const env = { ...process.env };
  for (const k of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
  ]) delete env[k];
  return env;
}

// 설치 직후 PATH가 아직 반영 안 된 경우를 위해 기본 설치 위치도 찾아봄
async function resolveCmd(name) {
  if (!IS_WIN) return name;
  const home = os.homedir();
  const candidates = {
    claude: [path.join(home, ".local", "bin", "claude.exe")],
    codex: [path.join(home, "AppData", "Roaming", "npm", "codex.cmd"), path.join(home, ".local", "bin", "codex.exe")],
  }[name] || [];
  for (const c of candidates) {
    try { await fs.access(c); return c; } catch {}
  }
  return name;
}

const q = (s) => (s === "" ? '""' : /[\s"&|<>^]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);

// 명령 실행: 인자는 앱이 정한 고정값만, 요청문은 stdin으로
function run(cmd, args, { input = "", cwd, timeout = RUN_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const opts = { cwd, env: safeEnv(), windowsHide: true };
    // 윈도우에서는 .cmd/.exe를 모두 찾기 위해 셸로 실행(인자는 고정값이라 안전)
    const child = IS_WIN ? spawn([q(cmd), ...args.map(q)].join(" "), { ...opts, shell: true }) : spawn(cmd, args, opts);
    let out = "", err = "", done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => {
      if (IS_WIN && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGKILL");
      finish({ code: -1, out, err: err + "\n시간 초과(6분)로 중단했습니다." });
    }, timeout);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => finish({ code: -1, out, err: e.code === "ENOENT" ? "NOT_INSTALLED" : e.message }));
    child.on("close", (code) => finish({ code, out, err }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const notInstalled = (r) => r.err === "NOT_INSTALLED" || /not recognized|not found|찾을 수 없|인식되지 않/i.test(r.err) || r.code === 9009 || r.code === 127;

// ───────── 상태 확인 ─────────
let statusCache = null;

export async function localAiStatus(refresh = false) {
  if (statusCache && !refresh && Date.now() - statusCache.at < 60_000) return statusCache.value;
  const claudeCmd = await resolveCmd("claude");
  const codexCmd = await resolveCmd("codex");
  const [cv, cs, xv, xs] = await Promise.all([
    run(claudeCmd, ["--version"], { timeout: 20_000 }),
    run(claudeCmd, ["auth", "status"], { timeout: 20_000 }), // 기본 출력(JSON)의 loggedIn 값으로 판단
    run(codexCmd, ["--version"], { timeout: 20_000 }),
    run(codexCmd, ["login", "status"], { timeout: 20_000 }),
  ]);
  const claudeInstalled = cv.code === 0 && !notInstalled(cv);
  const claudeText = `${cs.out}\n${cs.err}`.trim();
  // '로그인 안 됨'이 분명할 때만 막고, 확인 명령이 버전 차이 등으로 실패하면 일단 사용하게 둠(실행 시 다시 확인됨)
  const NOT_LOGGED = /not (logged|signed) in|no (active )?(credentials|account)|unauthenticated|please (log|sign) ?in|log ?in required|로그인(되어 있지 않|하지 않|이 필요)/i;
  // 1순위: JSON의 "loggedIn" 값 (글자 안내문은 Console 미로그인 같은 줄이 섞여 오판할 수 있음)
  let claudeJson = null;
  try {
    const a = claudeText.indexOf("{"), b = claudeText.lastIndexOf("}");
    if (a >= 0 && b > a) claudeJson = JSON.parse(claudeText.slice(a, b + 1));
  } catch {}
  const hasFlag = typeof claudeJson?.loggedIn === "boolean";
  const claudeSaysNo = hasFlag ? !claudeJson.loggedIn : NOT_LOGGED.test(claudeText);
  const claudeLogged = claudeInstalled && !claudeSaysNo;
  const claudeUncertain = claudeInstalled && !claudeSaysNo && !hasFlag;
  const claudeDetail = hasFlag
    ? `로그인: ${claudeJson.loggedIn ? "됨" : "안 됨"}${claudeJson.authMethod ? ` · 방식: ${claudeJson.authMethod}` : ""}${claudeJson.apiProvider ? ` · ${claudeJson.apiProvider}` : ""}`
    : claudeText.slice(0, 300);
  const codexInstalled = xv.code === 0 && !notInstalled(xv);
  const codexText = `${xs.out}\n${xs.err}`.trim();
  const codexSaysNo = NOT_LOGGED.test(codexText);
  const codexLogged = codexInstalled && !codexSaysNo;
  const codexUncertain = codexInstalled && !codexSaysNo && !/logged in/i.test(codexText);
  const value = {
    claude: { installed: claudeInstalled, ready: claudeLogged, uncertain: claudeUncertain, version: claudeInstalled ? cv.out.trim().split("\n")[0] : "", detail: claudeInstalled ? claudeDetail : "", authMethod: claudeJson?.authMethod || "" },
    codex: { installed: codexInstalled, ready: codexLogged, uncertain: codexUncertain, version: codexInstalled ? xv.out.trim().split("\n")[0] : "", detail: codexInstalled ? codexText.slice(0, 300) : "", chatgpt: /chatgpt/i.test(codexText) },
  };
  statusCache = { at: Date.now(), value };
  return value;
}

// ───────── 실행 ─────────
const busy = { claude: false, codex: false };

async function workDir(dataDir) {
  // 빈 작업 폴더에서 실행 (AI가 다른 파일을 읽지 않도록)
  const dir = path.join(dataDir, "ai-work");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function runClaude(prompt, { web = false, dataDir }) {
  if (busy.claude) throw new Error("Claude가 다른 작업을 하는 중입니다. 끝난 뒤 다시 눌러 주세요.");
  busy.claude = true;
  try {
    const cmd = await resolveCmd("claude");
    const tools = web ? "WebSearch,WebFetch" : "";
    const args = [
      "-p",
      "표준 입력으로 받은 요청을 그대로 수행하고, 요청한 형식의 답변만 출력하세요.",
      "--output-format", "json",
      "--tools", tools,
      ...(web ? ["--allowedTools", tools] : []),
      "--disallowedTools", "mcp__*",
    ];
    const r = await run(cmd, args, { input: prompt, cwd: await workDir(dataDir) });
    if (notInstalled(r)) throw new Error("Claude Code가 설치되어 있지 않습니다. '자동 실행 설정'을 확인해 주세요.");
    let parsed = null;
    try { parsed = JSON.parse(r.out.trim().split("\n").filter(Boolean).pop() || ""); } catch {}
    const text = parsed?.result ?? "";
    if (r.code !== 0 || parsed?.is_error || !String(text).trim()) {
      const msg = String(text || r.err || r.out).trim().slice(0, 400);
      if (/usage limit|rate limit|limit reached|한도/i.test(msg)) throw new Error("Claude 구독 사용 한도에 닿았습니다. 잠시 뒤 다시 시도하거나 요청문 복사 방식을 써 주세요.");
      if (/log ?in|auth|credential|unauthori/i.test(msg)) throw new Error("Claude Code 로그인이 필요합니다. '자동 실행 설정'의 안내대로 로그인해 주세요.");
      throw new Error(`Claude 자동 실행 실패: ${msg || "알 수 없는 오류"}`);
    }
    return String(text).trim();
  } finally {
    busy.claude = false;
  }
}

export async function runCodex(prompt, { dataDir }) {
  if (busy.codex) throw new Error("ChatGPT(Codex)가 다른 작업을 하는 중입니다. 끝난 뒤 다시 눌러 주세요.");
  busy.codex = true;
  const dir = await workDir(dataDir);
  const outFile = path.join(dir, `codex-${Date.now()}.txt`);
  try {
    const cmd = await resolveCmd("codex");
    const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-last-message", outFile, "-"];
    const r = await run(cmd, args, { input: prompt, cwd: dir });
    if (notInstalled(r)) throw new Error("Codex가 설치되어 있지 않습니다. '자동 실행 설정'을 확인해 주세요.");
    let text = "";
    try { text = await fs.readFile(outFile, "utf8"); } catch { text = r.out; }
    if (r.code !== 0 || !text.trim()) {
      const msg = `${r.err}\n${r.out}`.trim().slice(-400);
      if (/usage limit|rate limit|limit/i.test(msg)) throw new Error("ChatGPT 구독 사용 한도에 닿았습니다. 잠시 뒤 다시 시도하거나 요청문 복사 방식을 써 주세요.");
      if (/log ?in|auth|unauthori/i.test(msg)) throw new Error("Codex 로그인이 필요합니다. '자동 실행 설정'의 안내대로 로그인해 주세요.");
      throw new Error(`ChatGPT(Codex) 자동 실행 실패: ${msg || "알 수 없는 오류"}`);
    }
    return text.trim();
  } finally {
    busy.codex = false;
    fs.rm(outFile, { force: true }).catch(() => {});
  }
}
