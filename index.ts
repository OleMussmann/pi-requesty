/**
 * pi-requesty — Requesty (https://requesty.ai) model provider for Pi.
 *
 * Registers "requesty" as a model provider whose catalog is refreshed from
 * Requesty's GET /v1/models endpoint. Streaming and Bearer authentication are
 * handled by Pi's built-in OpenAI Chat Completions implementation, so this
 * extension ships no stream code. The API key lives in auth.json and is
 * entered through `/login requesty`.
 */

import type { Model, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "requesty";
const DEFAULT_BASE_URL = "https://router.requesty.ai/v1";

/** Re-fetch the remote catalog at most this often (a forced refresh bypasses it). */
const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Fallbacks for catalog entries with missing or zero metadata. */
const FALLBACK_CONTEXT_WINDOW = 128_000;
const FALLBACK_MAX_TOKENS = 16_384;

/** Fields this extension reads from Requesty GET /v1/models entries. */
interface RequestyModelEntry {
	api?: string;
	id?: string;
	input_price?: number;
	output_price?: number;
	cached_price?: number;
	context_window?: number;
	max_output_tokens?: number;
	supports_caching?: boolean;
	supports_vision?: boolean;
	supports_reasoning?: boolean;
}

function isChatEntry(entry: RequestyModelEntry): entry is RequestyModelEntry & { id: string } {
	return entry.api === "chat" && typeof entry.id === "string" && entry.id.length > 0;
}

function positiveInt(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** Requesty prices are USD per token; Pi costs are USD per million tokens. */
function perMillion(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value * 1_000_000 : 0;
}

function mapModel(entry: RequestyModelEntry & { id: string }, baseUrl: string): Model<"openai-completions"> {
	const contextWindow = positiveInt(entry.context_window, FALLBACK_CONTEXT_WINDOW);
	return {
		type: "chat",
		provider: PROVIDER_ID,
		api: "openai-completions",
		baseUrl,
		id: entry.id,
		name: entry.id,
		input: entry.supports_vision ? ["text", "image"] : ["text"],
		reasoning: entry.supports_reasoning === true,
		contextWindow,
		maxTokens: positiveInt(entry.max_output_tokens, Math.min(contextWindow, FALLBACK_MAX_TOKENS)),
		cost: {
			input: perMillion(entry.input_price),
			output: perMillion(entry.output_price),
			cacheRead: entry.supports_caching ? perMillion(entry.cached_price) : 0,
			cacheWrite: 0,
		},
	};
}

export async function refreshModels(context: RefreshModelsContext): Promise<Model<"openai-completions">[]> {
	const baseUrl = context.baseUrl ?? DEFAULT_BASE_URL;
	// The store is keyed by provider ID; normalize entries against the current config.
	const stored = ((context.stored?.models ?? []) as Model<"openai-completions">[])
		.filter((model) => model.provider === PROVIDER_ID)
		.map((model) => ({ ...model, baseUrl }));

	// Offline phase: restore the persisted catalog before any network access,
	// so models are selectable even when the refresh cannot run.
	if (!context.allowNetwork) return stored;

	// Serve a fresh persisted snapshot without re-fetching.
	const checkedAt = context.stored?.checkedAt;
	if (
		!context.force &&
		stored.length > 0 &&
		typeof checkedAt === "number" &&
		Date.now() - checkedAt < CATALOG_MAX_AGE_MS
	) {
		return stored;
	}

	if (context.signal.aborted) return stored;

	// Network phase only runs after Pi resolves a credential, so the key comes
	// from auth.json via /login requesty. The endpoint also answers without
	// authentication; the key scopes the catalog to the organization's models.
	const apiKey = context.credential?.type === "api_key" ? context.credential.key : undefined;
	const response = await fetch(`${baseUrl}/models`, {
		headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
		signal: context.signal,
	});
	if (!response.ok) {
		throw new Error(`Requesty model list failed: HTTP ${response.status} ${response.statusText}`);
	}
	const payload = (await response.json()) as { data?: RequestyModelEntry[] };
	const models = (payload.data ?? []).filter(isChatEntry).map((entry) => mapModel(entry, baseUrl));
	if (models.length === 0) {
		throw new Error("Requesty model list returned no chat models");
	}

	// Persist so the catalog is available offline and on the next startup.
	await context.publish({ persist: { models, checkedAt: Date.now() } });
	return models;
}

export default function (pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER_ID, {
		name: "Requesty",
		baseUrl: DEFAULT_BASE_URL,
		api: "openai-completions",
		refreshModels,
	});
}
