# pi-requesty

Pi extension that adds [Requesty](https://requesty.ai) as a model provider, with the
full Requesty model catalog (600+ models from many upstreams behind one
OpenAI-compatible router) discovered live from `GET /v1/models`.

- Streaming, request format, and `Authorization: Bearer` authentication come from
  Pi's built-in OpenAI Chat Completions implementation — no custom stream code.
- The API key is stored in `~/.pi/agent/auth.json` through `/login requesty`.
- The catalog (IDs, context windows, costs, vision/reasoning flags) is fetched
  from `https://router.requesty.ai/v1/models` once per startup (public,
  unauthenticated), persisted, and re-refreshed with the key at most once a day —
  so models stay selectable offline.

## Install

```bash
pi install git:github.com/OleMussmann/pi-requesty
```

`pi list` shows it; `pi update --extensions` picks up new revisions.
For a one-off run without installing: `pi -e git:github.com/OleMussmann/pi-requesty`.

## Use

1. Start Pi and run `/login requesty` — paste your Requesty API key
   (Dashboard → API Keys). It is saved to `auth.json` under `requesty`.
2. Run `/model` and search, e.g. `openai/gpt-5-mini`, `anthropic/claude-sonnet-4.5`,
   `google/gemini-2.5-pro`. Model IDs are namespaced by their upstream, so a full
   reference looks like `requesty/openai/gpt-5-mini`.
3. Chat. Costs in the footer use Requesty's catalog pricing (USD per million tokens).

Check your key with either:

- **In a session** — run `/requesty`. It reports where the key came from
  (auth.json, environment, ...), validates it live against Requesty
  (a rejected key shows as `HTTP 403`), and shows the org catalog size next
  to the number of models Pi can actually use.
- **From the shell** — `pi --list-models requesty` loads extensions and prints
  the requesty models when the credential resolves; `No models matching
  "requesty"` means it does not.

`REQUESTY_API_KEY` is not consulted — this extension deliberately keeps the key in
`auth.json` only.

## Notes and limits

- Only `api: "chat"` catalog entries become models (Requesty's other modalities —
  embeddings, image, audio — are out of scope).
- `supports_reasoning` maps to Pi's `reasoning` flag; no per-provider thinking-level
  mapping is applied yet.
- Costs are `price × 1e6` from the catalog; cache-write pricing is reported as 0
  because Requesty does not publish it.
- Pi lists a provider's models only once it has a usable credential, so `/login
  requesty` is required before `/model` shows them. The catalog itself is already
  loaded by then (startup fetch + persisted store), so discovery does not wait on
  a refresh.
- The key-scoped refresh sends `Authorization: Bearer <key>` to `GET /v1/models`
  (the catalog is then scoped to models approved for your organization) and retries
  unauthenticated if the key is rejected (HTTP 401/403). A bad key therefore still
  gets models; it fails loudly only when actually chatting.
- `pi auth check --provider requesty` always reports `not_ready` (`provider_not_found`
  with `--json`): the auth subcommands run before extensions load, so they only know
  built-in providers. Use `/requesty` or `pi --list-models requesty` instead.

## Development

```bash
pi -e .            # run Pi with this checkout
pi -e . --list-models
```

Edit `index.ts` and restart (or `/reload` in a session). Layout follows the
conventional Pi package format: `package.json` with a `pi.extensions` manifest.

## License

MIT
