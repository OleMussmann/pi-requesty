# pi-requesty

Pi extension that adds [Requesty](https://requesty.ai) as a model provider, with the
full Requesty model catalog (600+ models from many upstreams behind one
OpenAI-compatible router) discovered live from `GET /v1/models`.

- Streaming, request format, and `Authorization: Bearer` authentication come from
  Pi's built-in OpenAI Chat Completions implementation — no custom stream code.
- The API key is stored in `~/.pi/agent/auth.json` through `/login requesty`.
- The catalog (IDs, context windows, costs, vision/reasoning flags) is refreshed
  from `https://router.requesty.ai/v1/models` at most once a day and persisted, so
  models stay selectable offline.

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

Check credential resolution with:

```bash
pi auth check --provider requesty   # prints ready / not_ready / invalid
```

`REQUESTY_API_KEY` is not consulted — this extension deliberately keeps the key in
`auth.json` only.

## Notes and limits

- Only `api: "chat"` catalog entries become models (Requesty's other modalities —
  embeddings, image, audio — are out of scope).
- `supports_reasoning` maps to Pi's `reasoning` flag; no per-provider thinking-level
  mapping is applied yet.
- Costs are `price × 1e6` from the catalog; cache-write pricing is reported as 0
  because Requesty does not publish it.
- The network refresh runs only after `/login requesty` (Pi resolves a credential
  before any remote catalog fetch); the first run therefore shows models only after
  login.

## Development

```bash
pi -e .            # run Pi with this checkout
pi -e . --list-models
```

Edit `index.ts` and restart (or `/reload` in a session). Layout follows the
conventional Pi package format: `package.json` with a `pi.extensions` manifest.

## License

MIT
