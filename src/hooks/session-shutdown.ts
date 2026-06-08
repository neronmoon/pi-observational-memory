import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../runtime.js";

export function registerSessionShutdown(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("session_shutdown", async () => {
		await runtime.awaitBackgroundWork();
	});
}
