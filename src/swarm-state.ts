/**
 * Durable swarm state — persisted as a single JSON file at
 * .evalgate/swarm-state.json.
 *
 * A single JSON file (not NDJSON) is used here because the swarm orchestrator
 * needs random-access updates to individual worker records. NDJSON is append-
 * only; updating a specific entry would require rewriting the whole file anyway.
 *
 * Writes are atomic: we write to a .tmp file and rename it over the target.
 * On POSIX systems rename(2) is atomic within the same filesystem.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SwarmState, WorkerState } from "./types.js";

function stateDir(todoPath: string): string {
	return join(dirname(todoPath), ".evalgate");
}

function statePath(todoPath: string): string {
	return join(stateDir(todoPath), "swarm-state.json");
}

/** Reads .evalgate/swarm-state.json; returns null if absent or unreadable. */
export function loadState(todoPath: string): SwarmState | null {
	const p = statePath(todoPath);
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, "utf8")) as SwarmState;
	} catch {
		return null;
	}
}

/** Atomically writes the full SwarmState to disk. */
export function saveState(todoPath: string, state: SwarmState): void {
	const dir = stateDir(todoPath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const p = statePath(todoPath);
	const tmp = `${p}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, 2));
	renameSync(tmp, p);
}

/**
 * Merges `partial` into the WorkerState with the given `id` and saves.
 * No-op if the state file doesn't exist or the worker id is not found.
 */
export function updateWorker(todoPath: string, id: string, partial: Partial<WorkerState>): void {
	const state = loadState(todoPath);
	if (!state) return;
	const idx = state.workers.findIndex((w) => w.id === id);
	if (idx === -1) return;
	const existing = state.workers[idx];
	if (!existing) return; // type guard (idx is in-bounds, so this never fires)
	state.workers[idx] = { ...existing, ...partial };
	saveState(todoPath, state);
}
