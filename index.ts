/**
 * pi-requesty — Requesty (https://requesty.ai) model provider for Pi.
 *
 * Registers "requesty" as a model provider with a catalog discovered from
 * Requesty's GET /v1/models endpoint:
 *
 * - The async factory fetches the public catalog once per startup (Pi waits
 *   for async factories), so models exist before any refresh pass runs and an
 *   empty store can never deadlock discovery.
 * - refreshModels restores the persisted catalog offline, refreshes the
 *   key-scoped catalog at most once a day, and persists successful fetches.
 * - Streaming and Bearer authentication come from Pi's built-in OpenAI Chat
 *   Completions implementation; the API key lives in auth.json via
 *   `/login requesty`.
 */

import type { Model, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "requesty";
const DEFAULT_BASE_URL = "https://router.requesty.ai/v1";

/** Re-fetch the key-scoped catalog at most this often (a forced refresh bypasses it). */
const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Upper bound on the startup catalog fetch; a failure just means no bootstrap models. */
const BOOTSTRAP_TIMEOUT_MS = 10_000;

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

type RequestyModel = Model<"openai-completions">;

/** Catalog fetched by the factory; serves refresh passes until the store has data. */
let bootstrapModels: RequestyModel[] | undefined;

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

function mapModel(entry: RequestyModelEntry & { id: string }, baseUrl: string): RequestyModel {
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

/**
 * Fetch and map the catalog. A rejected or absent key (HTTP 401/403) still
 * deserves model discovery: retry unauthenticated for the public catalog.
 * Chat requests keep using the key, so a bad key fails loudly there instead
 * of hiding models.
 */
async function fetchCatalog(
	baseUrl: string,
	apiKey: string | undefined,
	signal?: AbortSignal,
): Promise<RequestyModel[]> {
	const fetchCatalogRequest = (headers: HeadersInit | undefined) =>
		fetch(`${baseUrl}/models`, { headers, signal });
	let response = await fetchCatalogRequest(apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined);
	if ((response.status === 401 || response.status === 403) && apiKey) {
		response = await fetchCatalogRequest(undefined);
	}
	if (!response.ok) {
		throw new Error(`Requesty model list failed: HTTP ${response.status} ${response.statusText}`);
	}
	const payload = (await response.json()) as { data?: RequestyModelEntry[] };
	const models = (payload.data ?? []).filter(isChatEntry).map((entry) => mapModel(entry, baseUrl));
	if (models.length === 0) {
		throw new Error("Requesty model list returned no chat models");
	}
	return models;
}

export async function refreshModels(context: RefreshModelsContext): Promise<RequestyModel[]> {
	const baseUrl = context.baseUrl ?? DEFAULT_BASE_URL;
	// The store is keyed by provider ID; normalize entries against the current config.
	const stored = ((context.stored?.models ?? []) as RequestyModel[])
		.filter((model) => model.provider === PROVIDER_ID)
		.map((model) => ({ ...model, baseUrl }));

	// Offline phase: serve the persisted catalog, falling back to the startup
	// bootstrap, so models stay selectable without network access.
	if (!context.allowNetwork) {
		return stored.length > 0 ? stored : (bootstrapModels ?? []);
	}

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

	if (context.signal.aborted) return stored.length > 0 ? stored : (bootstrapModels ?? []);

	// Key-scoped refresh: the credential comes from auth.json (/login requesty);
	// Pi runs this phase only after credential resolution. A superseding refresh
	// may abort it — that is fine, the bootstrap catalog already serves models.
	const apiKey = context.credential?.type === "api_key" ? context.credential.key : undefined;
	const models = await fetchCatalog(baseUrl, apiKey, context.signal);

	// Persist so the catalog is available offline and on the next startup.
	await context.publish({ persist: { models, checkedAt: Date.now() } });
	return models;
}

export default async function (pi: ExtensionAPI): Promise<void> {
	let models: RequestyModel[] | undefined;
	if (process.env.PI_OFFLINE !== "1") {
		try {
			models = await fetchCatalog(DEFAULT_BASE_URL, undefined, AbortSignal.timeout(BOOTSTRAP_TIMEOUT_MS));
		} catch {
			// Startup must not fail over model discovery; refreshModels still runs later.
		}
	}
	bootstrapModels = models;
	pi.registerProvider(PROVIDER_ID, {
		name: "Requesty",
		baseUrl: DEFAULT_BASE_URL,
		api: "openai-completions",
		models,
		refreshModels,
	});
}
