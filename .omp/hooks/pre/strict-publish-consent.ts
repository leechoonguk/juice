import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { recordedBlocks } from "../lib/hook-metrics.ts";
import { commandRunsOutsideProject, eventWithCwd } from "../lib/hook-project-root.ts";
import type { BranchEntry } from "../lib/hook-publish-consent.ts";
import { publishConsent } from "../lib/hook-publish-consent.ts";

/**
 * Publishing without being asked, blocked at the tool boundary.
 *
 * `strict-verified-git.ts` answers "is this tree green"; this answers "did
 * anyone ask for it". They are different failures: this session published five
 * commits nobody requested, every one of them green.
 *
 * Both routes are covered because both are bash commands: the raw `git commit` /
 * `git push`, and the `make commit` / `make push` targets that own the verify
 * prerequisite. `make release` and `make unrelease` publish to every installed
 * copy, so they need the same request; `make release … DRY_RUN=1` publishes
 * nothing and passes. A publish that never reaches the bash tool - a user running
 * make in their own terminal - is the user's own action and needs no gate.
 */

// 명령의 시작점 — 셸에서는 구분자 뒤, eval 본문에서는 명령이 문자열 리터럴 안에 있어(execSync("git push"))
// 인용부호·백틱도 시작점이다. bash 에서 `echo "git push is listed"` 의 인용부호는 시작점이 아니라 산문이다.
const SHELL_START = String.raw`(?:^|[\n&|;()]\s*)(?:sudo\s+)?`;
const EVAL_START = String.raw`(?:^|[\n&|;()"'\x60]\s*)(?:sudo\s+)?`;
const publishFrom = (start: string): RegExp =>
  new RegExp(
    start +
      String.raw`(?:git(?:\s+-\S+(?:\s+\S+)?)*\s+(?:commit|push)|make\s+(?:-\S+\s+)*(?:commit|push|release|unrelease)\b(?![^\n;&|]*\bDRY_RUN=1))`,
  );
const SHELL_PUBLISH = publishFrom(SHELL_START);
const EVAL_PUBLISH = publishFrom(EVAL_START);

export default function strictPublishConsent(pi: ExtensionAPI): void {
  type PublishEvent = { toolName?: string; input?: Record<string, unknown> };
  type PublishContext = { sessionManager?: { getBranch?: () => BranchEntry[] } };

  // ctx-ok: 발행 동의 판정은 세션 브랜치(sessionManager.getBranch)를 읽어야 한다 — event 에는 없다.
  // 모든 접근이 옵셔널 체이닝이라 던질 수 없다(아래 ?? null).
  pi.on("tool_call", recordedBlocks("strict-publish-consent", (event: PublishEvent, ctx: PublishContext) => {
    // 실행 채널은 bash 만이 아니다 — eval 본문(subprocess.run/execSync)로도 push 가 나간다
    // (원 하네스 전수 점검: 라우팅 우회의 32% 가 eval). 같은 판정을 두 채널에 건다.
    if (event.toolName !== "bash" && event.toolName !== "eval") return;
    const body = String(event.input?.command ?? event.input?.code ?? "");
    // argv 리스트형(subprocess.run(["git","push"…]))은 연속 문자열이 아니다 — 실행 함수 + 대상
    // 토큰 공존으로 판정한다(strict-verified-git 과 같은 계약).
    const evalPublish = event.toolName === "eval"
      && /\b(execSync|exec|spawnSync|spawn|subprocess\.(?:run|call|check_call|Popen)|os\.system|popen)\b/.test(body)
      && /["'`]git["'`]/.test(body)
      && /["'`](commit|push)\b/.test(body);
    if (!(event.toolName === "eval" ? EVAL_PUBLISH : SHELL_PUBLISH).test(body) && !evalPublish) return;
    // 형제 프로젝트에서 도는 명령은 그쪽 프로젝트의 발행이다 — 이 프로젝트의 동의 판정 대상이 아니다.
    if (commandRunsOutsideProject(event.input, eventWithCwd(event, ctx))) return;

    const entries = ctx.sessionManager?.getBranch?.() ?? null;
    if (entries === null) {
      return {
        block: true,
        reason:
          "publish blocked: the session history is unreadable, so consent cannot be established — " +
          "ask the user to confirm, or let them run `make commit` / `make push` themselves",
      };
    }

    const verdict = publishConsent(entries);
    if (verdict.granted) return;

    return {
      block: true,
      reason:
        `publish blocked: ${verdict.reason}. Report the work and ask; ` +
        "when the user asks, `make commit m=\"...\"` and `make push` run the gate first.",
    };
  }));
}
