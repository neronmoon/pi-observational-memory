import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { rawTokensSinceLastCompaction, type Entry } from "../session-ledger/index.js";
import type { Runtime } from "../runtime.js";

const RETRYABLE_ERROR_RE =
	/overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

export async function maybeCompact(runtime: Runtime, ctx: any): Promise<void> {
	runtime.ensureConfig(ctx.cwd);
	if (runtime.config.passive === true) return;
	if (runtime.compactPromise) {
		await runtime.compactPromise;
		return;
	}
	if (runtime.compactInFlight) return;

	const entries = ctx.sessionManager.getBranch() as Entry[];
	const tokens = rawTokensSinceLastCompaction(entries);
	if (tokens < runtime.config.compactAfterTokens) return;

	const hasUI = ctx.hasUI;
	const ui = ctx.ui;

	if (hasUI) ui?.notify(
		`Observational memory: compaction threshold reached (~${tokens.toLocaleString()} tokens); triggering compaction`,
		"info",
	);

	runtime.beginCompact();
	await new Promise<void>((resolve) => {
		try {
			ctx.compact({
				onComplete: () => {
					runtime.finishCompact();
					if (hasUI) ui?.notify("Observational memory: compaction complete", "info");
					resolve();
				},
				onError: (error: { message: string }) => {
					runtime.finishCompact();
					if (error.message !== "Compaction cancelled" && hasUI) {
						ui?.notify(`Observational memory: ${error.message}`, "error");
					}
					resolve();
				},
			});
		} catch (error) {
			runtime.finishCompact();
			const msg = error instanceof Error ? error.message : String(error);
			if (hasUI) ui?.notify(`Observational memory: compact threw: ${msg}`, "error");
			resolve();
		}
	});
}

export function registerCompactionTrigger(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("agent_end", (event: any, ctx: any) => {
		runtime.ensureConfig(ctx.cwd);
		if (runtime.config.passive === true) return;
		if (runtime.compactInFlight || runtime.compactPromise) return;

		const lastAssistant = [...event.messages].reverse().find(
			(m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant",
		);
		if (
			lastAssistant
			&& lastAssistant.stopReason === "error"
			&& lastAssistant.errorMessage
			&& RETRYABLE_ERROR_RE.test(lastAssistant.errorMessage)
		) {
			return;
		}

		const entries = ctx.sessionManager.getBranch() as Entry[];
		const tokens = rawTokensSinceLastCompaction(entries);
		if (tokens < runtime.config.compactAfterTokens) return;

		const hasUI = ctx.hasUI;
		const ui = ctx.ui;

		if (hasUI) ui?.notify(
			`Observational memory: compaction threshold reached (~${tokens.toLocaleString()} tokens); triggering compaction`,
			"info",
		);

		runtime.beginCompact();
		setTimeout(() => {
			try {
				if (!ctx.isIdle()) {
					runtime.finishCompact();
					if (hasUI) ui?.notify(
						"Observational memory: compaction deferred — agent became busy before compaction",
						"info",
					);
					return;
				}
				const currentEntries = ctx.sessionManager.getBranch() as Entry[];
				const currentTokens = rawTokensSinceLastCompaction(currentEntries);
				if (currentTokens < runtime.config.compactAfterTokens) {
					runtime.finishCompact();
					if (hasUI) ui?.notify(
						"Observational memory: compaction skipped — another compaction already ran before deferred compaction",
						"info",
					);
					return;
				}
				ctx.compact({
					onComplete: () => {
						runtime.finishCompact();
						if (hasUI) ui?.notify("Observational memory: compaction complete", "info");
					},
					onError: (error: { message: string }) => {
						runtime.finishCompact();
						if (error.message === "Compaction cancelled") return;
						if (hasUI) ui?.notify(`Observational memory: ${error.message}`, "error");
					},
				});
			} catch (error) {
				runtime.finishCompact();
				const msg = error instanceof Error ? error.message : String(error);
				if (hasUI) ui?.notify(`Observational memory: compact threw: ${msg}`, "error");
			}
		}, 0);
	});
}
