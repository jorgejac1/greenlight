import type { McpToolDefinition } from "../types.js";

export const TOOLS: McpToolDefinition[] = [
	{
		name: "list_triggers",
		description:
			"List all contracts that have an automatic trigger (schedule, watch, or webhook). Shows what will fire without manual intervention.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
		},
	},
	{
		name: "list_all",
		description:
			"List all contracts in the todo.md file — checked and unchecked, with and without verifiers. Shows current status of the full project.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
		},
	},
	{
		name: "list_pending",
		description: "List all unchecked contracts that have an eval verifier in the todo.md file.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
		},
	},
	{
		name: "run_eval",
		description:
			"Run the verifier for a single contract identified by its id or title slug. Returns pass/fail and full output.",
		inputSchema: {
			type: "object",
			properties: {
				contract_id: {
					type: "string",
					description: "The contract id (slug) or exact title to run.",
				},
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
			required: ["contract_id"],
		},
	},
	{
		name: "check_all",
		description:
			"Run verifiers for all pending (unchecked) contracts in the todo.md file. Updates checkboxes for contracts that pass.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
		},
	},
	{
		name: "get_retry_context",
		description:
			"Return the full failure output from the last run of a contract, formatted for an agent to read and retry.",
		inputSchema: {
			type: "object",
			properties: {
				contract_id: {
					type: "string",
					description: "The contract id (slug) or exact title.",
				},
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
			required: ["contract_id"],
		},
	},
	{
		name: "get_run_history",
		description:
			"Return the run history for all contracts or a specific contract from the durable log.",
		inputSchema: {
			type: "object",
			properties: {
				contract_id: {
					type: "string",
					description: "Filter by contract id. Omit for all contracts.",
				},
				failed_only: { type: "boolean", description: "If true, return only failed runs." },
				limit: { type: "number", description: "Max records to return (default 20)." },
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
		},
	},
	{
		name: "get_last_failure",
		description:
			"Return the most recent failed run record for a contract. Useful for understanding why a contract keeps failing.",
		inputSchema: {
			type: "object",
			properties: {
				contract_id: { type: "string", description: "The contract id (slug)." },
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
			required: ["contract_id"],
		},
	},
	{
		name: "send_message",
		description:
			"Send a typed message to another agent. Messages are persisted in .evalgate/messages.ndjson.",
		inputSchema: {
			type: "object",
			properties: {
				from: { type: "string", description: "Sender agent id." },
				to: { type: "string", description: "Recipient agent id or '*' for broadcast." },
				kind: {
					type: "string",
					description:
						"Message kind: completion | blocker | review_request | status_update | retry_request",
				},
				payload: { type: "string", description: "JSON string payload." },
				contract_id: {
					type: "string",
					description: "Optional contract this message relates to.",
				},
				correlation_id: { type: "string", description: "Optional id to link related messages." },
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
			required: ["from", "to", "kind"],
		},
	},
	{
		name: "list_messages",
		description:
			"List agent messages from the durable log, optionally filtered by recipient or kind.",
		inputSchema: {
			type: "object",
			properties: {
				to: { type: "string", description: "Filter by recipient agent id." },
				kind: { type: "string", description: "Filter by message kind." },
				limit: { type: "number", description: "Max messages to return (default 20)." },
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
		},
	},
	{
		name: "get_provider_hints",
		description:
			"Return provider routing hints for all contracts: preferred model (opus/sonnet/haiku), role (coordinator/worker/linter), allowed MCP servers, and budget. Orchestrators use this to route the right model to each task.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
		},
	},
	{
		name: "suggest_template",
		description:
			"Given a task title, find the most similar past successful completions using trigram similarity. Returns ranked suggestions with verifier commands to reuse as templates.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Task title to find similar completions for.",
				},
				limit: { type: "number", description: "Max suggestions to return (default 5)." },
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "get_patterns",
		description:
			"Analyze run history for systemic failure patterns: contracts with high failure rates, flaky contracts, and common error messages.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
		},
	},
	{
		name: "export_state",
		description:
			"Export the full project state as a JSON snapshot: contracts, run history, budget, messages, and failure patterns.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
		},
	},
	{
		name: "report_token_usage",
		description:
			"Report how many tokens were consumed working on a contract. Greenlight persists this in .evalgate/budget.ndjson and emits a budget_exceeded message if the contract's budget is breached.",
		inputSchema: {
			type: "object",
			properties: {
				contract_id: { type: "string", description: "The contract id (slug)." },
				tokens: { type: "number", description: "Number of tokens used in this session." },
				path: { type: "string", description: "Path to todo.md. Defaults to ./todo.md." },
				workspace: {
					type: "string",
					description:
						"Named workspace (alternative to path). Use list_workspaces to see available names.",
				},
			},
			required: ["contract_id", "tokens"],
		},
	},
	{
		name: "list_workspaces",
		description:
			"List all named workspaces configured in this MCP server instance. Each workspace maps a short name to a todo.md path.",
		inputSchema: { type: "object", properties: {} },
	},
];
