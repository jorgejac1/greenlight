import { listMessages, sendMessage } from "../messages.js";
import type { MessageKind } from "../types.js";
import { C } from "./helpers.js";

export async function cmdMsg(subCmd: string, args: string[], todoPath: string): Promise<number> {
	if (subCmd === "send") {
		const [from, to, kind, payloadRaw] = args;
		if (!from || !to || !kind) {
			console.error(`${C.red}usage: evalgate msg send <from> <to> <kind> [payload-json]${C.reset}`);
			return 1;
		}
		let payload: unknown = null;
		if (payloadRaw) {
			try {
				payload = JSON.parse(payloadRaw);
			} catch {
				payload = payloadRaw;
			}
		}
		const msg = sendMessage(todoPath, {
			from,
			to,
			kind: kind as MessageKind,
			payload,
		});
		console.log(`${C.green}sent${C.reset} ${C.dim}(${msg.id})${C.reset}`);
		console.log(JSON.stringify(msg, null, 2));
		return 0;
	}

	if (subCmd === "list") {
		const toArg = args.find((a) => a.startsWith("--to="))?.split("=")[1];
		const kindArg = args.find((a) => a.startsWith("--kind="))?.split("=")[1];
		const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
		const messages = listMessages(todoPath, {
			to: toArg,
			kind: kindArg as MessageKind | undefined,
			limit: limitArg ? parseInt(limitArg, 10) : 20,
		});
		if (messages.length === 0) {
			console.log(`${C.dim}no messages found${C.reset}`);
			return 0;
		}
		for (const m of messages) {
			console.log(
				`${C.cyan}${m.kind}${C.reset}  ${C.dim}${m.from} → ${m.to}${C.reset}  ${new Date(m.ts).toLocaleString()}`,
			);
			if (m.contractId) console.log(`  ${C.dim}contract: ${m.contractId}${C.reset}`);
			console.log(`  ${C.dim}${JSON.stringify(m.payload)}${C.reset}`);
		}
		return 0;
	}

	console.error(`${C.red}unknown msg subcommand: ${subCmd}${C.reset}`);
	console.error(`  usage: evalgate msg send|list ...`);
	return 1;
}
