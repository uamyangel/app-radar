/**
 * 本地订阅的 AI 命令行工具：claude（Claude Code）、cursor（cursor-agent）、codex。
 * 统一成「系统提示 + 用户输入 → 文本」。不开任何工具，在一个空目录里运行，避免读到项目文件。
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PROVIDERS = ["claude", "cursor", "codex"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * Cursor Ultra 里「Cursor Models」（Composer、Cursor Grok）额度很足，「Other Models」（GPT、Claude、Gemini 等）用完就按量计费。
 * 所以 cursor 默认只放行自家模型；不指定模型时用 composer-2.5-fast（基准测试 31 秒/批，质量通过）。
 * 确实要用其他模型时设环境变量 ALLOW_CURSOR_OTHER_MODELS=1。
 */
export const CURSOR_DEFAULT_MODEL = "composer-2.5-fast";
const CURSOR_OWN = /^(composer-|cursor-grok-|grok-4\.7-)/; // Cursor 设置里 Grok 4.7 归在 Cursor Models
export function checkCursorModel(model: string | undefined): string {
  const m = model ?? CURSOR_DEFAULT_MODEL;
  if (!CURSOR_OWN.test(m) && process.env.ALLOW_CURSOR_OTHER_MODELS !== "1") {
    throw new Error(`cursor 只允许自家模型（composer-*、grok-4.7-*、cursor-grok-*），${m} 会消耗 Other Models 额度或产生按量费用。确实要用请设 ALLOW_CURSOR_OTHER_MODELS=1`);
  }
  return m;
}

/** 撞到订阅额度或频率上限：整个运行应停下，已完成的部分都已写库，换个订阅接着跑即可 */
export class QuotaExceeded extends Error {}

export type Completion = { text: string; costUsd: number | null; inputTokens: number | null; outputTokens: number | null };

const QUOTA_RE = /usage limit|rate limit|quota|too many requests|429|limit reached|exceeded your|credits|upgrade your plan|额度|限额/i;
const WORKDIR = join(tmpdir(), "app-radar-llm");

/** 正在运行的子进程：本进程不管怎么退出（看门狗、Ctrl-C、launchd 停止），都先把它们结束，避免留下孤儿进程继续占用额度 */
const children = new Set<ReturnType<typeof spawn>>();
export function killChildren() {
  for (const c of children) c.kill("SIGTERM");
  children.clear();
}
process.on("exit", killChildren);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => process.exit(128 + (sig === "SIGINT" ? 2 : sig === "SIGTERM" ? 15 : 1)));

function run(cmd: string, args: string[], input: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  mkdirSync(WORKDIR, { recursive: true });
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: WORKDIR, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    children.add(p);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { p.kill("SIGTERM"); reject(new Error(`${cmd} 超时（${timeoutMs / 1000}s）`)); }, timeoutMs);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => { children.delete(p); clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    p.stdin.end(input);
  });
}

export async function complete(provider: Provider, model: string | undefined, system: string, user: string, timeoutMs = 600_000): Promise<Completion> {
  if (provider === "claude") {
    const args = ["-p", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--system-prompt", system];
    if (model) args.push("--model", model);
    const r = await run("claude", args, user, timeoutMs);
    let d: { result?: string; is_error?: boolean; total_cost_usd?: number; usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number } };
    try { d = JSON.parse(r.stdout); } catch { throw classify(`claude 输出不是 JSON：${(r.stdout || r.stderr).slice(0, 300)}`); }
    if (d.is_error || r.code !== 0) throw classify(`claude 出错：${(d.result ?? r.stderr).slice(0, 300)}`);
    const u = d.usage ?? {};
    return {
      text: d.result ?? "",
      costUsd: d.total_cost_usd ?? null,
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? null,
    };
  }

  if (provider === "cursor") {
    // cursor-agent 没有单独的系统提示参数，拼在前面
    // --trust：无界面运行时跳过「信任工作区」确认（工作目录是一个空的临时目录）
    const args = ["-p", "--output-format", "json", "--trust", "--model", checkCursorModel(model)];
    args.push(`${system}\n\n---\n\n${user}`);
    const r = await run("cursor-agent", args, "", timeoutMs);
    let d: { result?: string; is_error?: boolean; usage?: { inputTokens?: number; outputTokens?: number } };
    try { d = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? ""); } catch { throw classify(`cursor-agent 输出不是 JSON：${(r.stdout || r.stderr).slice(0, 300)}`); }
    if (d.is_error || r.code !== 0) throw classify(`cursor-agent 出错：${(d.result ?? r.stderr).slice(0, 300)}`);
    return { text: d.result ?? "", costUsd: null, inputTokens: d.usage?.inputTokens ?? null, outputTokens: d.usage?.outputTokens ?? null };
  }

  // codex exec：最终回复写到文件里
  const out = join(WORKDIR, `codex-${process.pid}-${Date.now()}.txt`);
  const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "-o", out];
  if (model) args.push("--model", model);
  args.push("-");
  const r = await run(process.env.CODEX_BIN || "codex", args, `${system}\n\n---\n\n${user}`, timeoutMs);
  if (r.code !== 0) throw classify(`codex 出错：${r.stderr.slice(-300)}`);
  try {
    return { text: readFileSync(out, "utf8"), costUsd: null, inputTokens: null, outputTokens: null };
  } finally {
    rmSync(out, { force: true });
  }
}

function classify(msg: string): Error {
  return QUOTA_RE.test(msg) ? new QuotaExceeded(msg) : new Error(msg);
}

/** 模型偶尔会在 JSON 外面包 ```json 代码块或解释文字，取最外层的 {...} */
export function extractJson(text: string): unknown {
  const t = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try { return JSON.parse(t); } catch { /* 往下找 */ }
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("找不到 JSON");
}
