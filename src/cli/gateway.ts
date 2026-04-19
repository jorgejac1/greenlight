import { runGateway } from "../gateway.js";
import { loadConfig, setupConfig } from "../gateway-config.js";
import { C } from "./helpers.js";

export async function cmdGatewaySetup(): Promise<number> {
	try {
		const config = await setupConfig();
		const { configPath } = await import("../gateway-config.js");
		console.log(`\n${C.green}Config saved to ${configPath()}${C.reset}`);
		console.log(`${C.dim}token: ${config.token.slice(0, 8)}…${C.reset}`);
		console.log(`${C.dim}chatId: ${config.chatId}${C.reset}`);
		console.log(`${C.dim}todoPath: ${config.todoPath}${C.reset}`);
		console.log(`\nRun ${C.bold}evalgate gateway${C.reset} to start the bot.`);
		return 0;
	} catch (err) {
		console.error(
			`${C.red}gateway setup failed:${C.reset}`,
			err instanceof Error ? err.message : err,
		);
		return 1;
	}
}

export async function cmdGateway(args: string[]): Promise<number> {
	const tokenArg = args.find((a) => a.startsWith("--token="))?.split("=")[1];
	const chatIdArg = args.find((a) => a.startsWith("--chat-id="))?.split("=")[1];
	const todoArg = args.find((a) => a.startsWith("--todo="))?.split("=")[1];
	const concurrencyArg = args.find((a) => a.startsWith("--concurrency="))?.split("=")[1];

	const stored = loadConfig();

	const token = tokenArg ?? stored?.token;
	const chatId = chatIdArg ? parseInt(chatIdArg, 10) : stored?.chatId;
	const todoPath = todoArg ?? stored?.todoPath ?? "todo.md";
	const concurrency = concurrencyArg ? parseInt(concurrencyArg, 10) : (stored?.concurrency ?? 3);

	if (!token) {
		console.error(
			`${C.red}evalgate gateway: no token found.${C.reset}\n` +
				`  Run ${C.bold}evalgate gateway setup${C.reset} first, ` +
				`or pass ${C.cyan}--token=<token>${C.reset}`,
		);
		return 1;
	}

	if (chatId === undefined || Number.isNaN(chatId)) {
		console.error(
			`${C.red}evalgate gateway: no chat ID found.${C.reset}\n` +
				`  Run ${C.bold}evalgate gateway setup${C.reset} first, ` +
				`or pass ${C.cyan}--chat-id=<id>${C.reset}`,
		);
		return 1;
	}

	console.log(`${C.bold}evalgate gateway${C.reset} ${C.dim}· Telegram bot starting…${C.reset}`);
	console.log(`${C.dim}todo: ${todoPath} · concurrency: ${concurrency}${C.reset}`);
	console.log(`${C.dim}Press Ctrl+C to stop.${C.reset}\n`);

	process.on("SIGINT", () => process.exit(0));
	process.on("SIGTERM", () => process.exit(0));

	try {
		await runGateway({
			config: { token, chatId, todoPath, concurrency },
			todoPath,
		});
	} catch (err) {
		console.error(
			`${C.red}evalgate gateway error:${C.reset}`,
			err instanceof Error ? err.message : err,
		);
		return 1;
	}

	return 0;
}
