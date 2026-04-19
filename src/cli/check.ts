import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parseTodo } from "../parser.js";
import { runContract } from "../verifier.js";
import { updateTodo } from "../writer.js";
import { C, looksLikeFailure } from "./helpers.js";

export async function cmdCheck(todoPath: string, watchFlag = false): Promise<number> {
	if (!existsSync(todoPath)) {
		console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
		return 1;
	}

	const source = readFileSync(todoPath, "utf8");
	const contracts = parseTodo(source);
	const pending = contracts.filter((c) => !c.checked && c.verifier);

	if (pending.length === 0) {
		console.log(
			`${C.dim}evalgate: no pending contracts with verifiers in ${basename(todoPath)}${C.reset}`,
		);
		return 0;
	}

	console.log(
		`${C.bold}evalgate${C.reset} ${C.dim}·${C.reset} checking ${pending.length} contract${pending.length === 1 ? "" : "s"} ${C.dim}in ${basename(todoPath)}${C.reset}\n`,
	);

	const cwd = resolve(dirname(todoPath));
	const results = [];
	let passed = 0;
	let failed = 0;

	for (const c of pending) {
		process.stdout.write(`  ${C.dim}▸${C.reset} ${c.title} ${C.dim}(${c.id})${C.reset} ... `);
		const result = await runContract(c, cwd, { todoPath, trigger: "manual" });
		results.push(result);

		if (result.passed) {
			console.log(`${C.green}✓ passed${C.reset} ${C.dim}(${result.durationMs}ms)${C.reset}`);
			passed++;
		} else {
			console.log(
				`${C.red}✗ failed${C.reset} ${C.dim}(exit ${result.exitCode}, ${result.durationMs}ms)${C.reset}`,
			);
			failed++;
			const stderr = result.stderr.trim();
			const stdout = result.stdout.trim();
			const failSource = looksLikeFailure(stderr) ? stderr : stdout || stderr;
			const tail = failSource.split("\n").slice(-20);
			for (const l of tail) {
				console.log(`    ${C.dim}│${C.reset} ${l}`);
			}
		}
	}

	const updated = updateTodo(source, results);
	if (updated !== source) {
		writeFileSync(todoPath, updated);
	}

	console.log(
		`\n${C.bold}Summary:${C.reset} ${C.green}${passed} passed${C.reset}, ${failed > 0 ? C.red : C.dim}${failed} failed${C.reset}`,
	);

	if (watchFlag) {
		const failedIds = new Set(results.filter((r) => !r.passed).map((r) => r.contract.id));

		if (failedIds.size === 0) {
			return 0;
		}

		console.log(`\nWatching for changes... (Ctrl+C to stop)\n`);

		const { startCheckWatch } = await import("../check-watch.js");
		const resolvedTodoPath = resolve(todoPath);

		return new Promise<number>((resolvePromise) => {
			const handle = startCheckWatch({
				todoPath: resolvedTodoPath,
				failedIds,
				cwd,
				onCycle(cycleResults) {
					for (const r of cycleResults) {
						const icon = r.passed ? "✓" : "✗";
						const color = r.passed ? C.green : C.red;
						console.log(
							`  ${color}${icon}${C.reset} ${r.contract.title} ${C.dim}(${r.durationMs}ms)${C.reset}`,
						);
					}
					if (failedIds.size === 0) {
						console.log(`\n${C.green}All contracts passed.${C.reset}\n`);
					}
				},
			});

			const origStop = handle.stop.bind(handle);
			handle.stop = () => {
				origStop();
				resolvePromise(failedIds.size === 0 ? 0 : 1);
			};

			function shutdown() {
				handle.stop();
			}

			process.once("SIGINT", shutdown);
			process.once("SIGTERM", shutdown);
		});
	}

	return failed > 0 ? 1 : 0;
}
