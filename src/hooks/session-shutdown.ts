import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { maybeCompact } from "./compaction-trigger.js";
import type { Runtime } from "../runtime.js";

export function registerSessionShutdown(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("session_shutdown", async (_event, ctx) => {
		await runtime.awaitBackgroundWork();
		await maybeCompact(runtime, ctx);
	});
}
