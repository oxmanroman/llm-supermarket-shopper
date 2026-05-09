# Agent-Driven Matcher

**Status:** approved 2026-05-09
**Replaces:** the single-shot `pickSkus` call in `src/lib/llm/match.ts`

## Problem

Today, `resolve.ts` does one `productSearch(store, ingredient.name)` per aggregated
ingredient and hands all candidates to a single `generateObject` matcher in
`match.ts`. When the first query returns no useful candidates — wrong tokenization,
brand-prefixed name, English token at an es-AR store, regionalism the catalog doesn't
index — the matcher has nothing to pick from and the ingredient drops to `unmatched`.

Recall is the dominant failure. The user reports that an agent willing to refine the
query ("harina" → "harina 0000" → "harina trigo") would find products the current
single-shot search misses.

## Goal

Replace the single-shot search + match with an LLM agent loop that:

1. Sees the whole aggregated shopping list at once, plus per-recipe context
   (what dish each ingredient is for) and the user's preferences.
2. Calls `searchProducts` as a tool, refining queries when results are thin.
3. Submits picks one ingredient at a time so partial progress survives a step cap.
4. Maintains a search cache so cross-ingredient repeats are free.

Latency and cost increases are acceptable. Sonnet 4.6 stays as the model.

## Non-goals

- Per-ingredient parallel agents. The user wants whole-list context.
- Multi-store agents (deciding *which* store to use is out of scope).
- Streaming agent progress to the UI mid-resolve.
- Replacing `aggregate.ts`'s LLM call with an agent loop.
- New retry/backoff in store adapters. The agent sees `[]` and refines.

## Architecture

### Aggregate output gains a `recipeSummaries` field

`src/lib/checkout/aggregate.ts` already runs an LLM pass over the full recipe set.
Extend its output schema with one new field:

```ts
recipeSummaries: {
  recipeId: string;
  dish: string;        // e.g., "ñoquis con tuco"
  cuisine: string;     // e.g., "italo-argentino"
  notes: string;       // free-text gotchas: "needs Argentine 0000 flour"
}[]
```

The aggregate prompt is extended to also infer these per recipe. Output is small
(~3 short fields × N recipes), so context cost is negligible.

`AggregatedIngredient.sources[].recipeId` already links ingredients back to their
source recipes, so the matcher can join `aggregated → recipeSummaries` to know
*what dish* each ingredient is for.

### New file: `src/lib/llm/match-agent.ts`

Replaces `src/lib/llm/match.ts`. Uses Vercel AI SDK's `generateText` with tools
and `stopWhen` for the agent loop.

**Inputs:**
```ts
type MatchAgentInput = {
  store: Store;
  aggregated: AggregatedIngredient[];
  recipeSummaries: RecipeSummary[];
  preferences: string;
};
```

**Outputs:**
```ts
type MatchAgentOutput = {
  picks: Pick[];                          // submitted by agent, indexed by ingredientIndex
  skipped: { ingredientIndex: number; reason: string }[];
  candidatesById: Record<string, Product[]>;  // search cache, keyed by aggregated.id
};
```

**Tools exposed to the agent:**

- `searchProducts({ query, ingredientIndex })` — calls `productSearch(store, query)`,
  caches the result by `query`, and tags the result list with `ingredientIndex` so
  resolve.ts can rebuild `candidatesById`. Returns a trimmed product view (top 15:
  `skuId`, `name`, `brand`, `price`, `available`).
- `submitPick(Pick)` — writes one pick into a `Map<number, Pick>` in closure scope.
  `Pick` schema unchanged from today (`ingredientIndex`, `pickedSkuId`, `cartQty`,
  `confidence`, `reason`).
- `skipIngredient({ ingredientIndex, reason })` — marks an ingredient unmatchable.

All three tools `execute` synchronously (no LLM round trips inside the tool body),
so they don't pad step count.

**Termination (`stopWhen`):**

```ts
stopWhen: [
  stepCountIs(5 + 4 * aggregated.length),
  ({ steps }) => allResolved(picks, skipped, aggregated.length),
]
```

For 15 ingredients, max 65 steps. The agent self-terminates earlier via
`allResolved` when every ingredient has either a pick or a skip.

**Search cache:**

A `Map<string, Product[]>` keyed by query string, scoped to one agent invocation.
The agent often re-queries "harina" or "leche" across multiple ingredients; cache
hits are free.

**Candidate reconstruction for the UI:**

The resolution screen needs `candidates: Record<aggregatedId, Product[]>` for the
manual-replacement picker. We rebuild it from the agent's tool-call history: every
`searchProducts({ query, ingredientIndex })` call appends its result to
`candidatesById[aggregated[ingredientIndex].id]`, deduplicated by `skuId`. So the
manual picker sees everything the agent saw for that ingredient.

### System prompt outline

The agent's system prompt explains:

1. **Role:** match a weekly Argentine shopping list against a supermarket catalog.
2. **The shopping list:** `aggregated[]` with `ingredientIndex`, `name`, `qty`, `unit`,
   plus the dish/cuisine/notes context joined from `recipeSummaries`.
3. **The store:** name + platform quirks (catalog is es-AR, names usually include
   package size, brand often appears in the SKU name).
4. **Search strategy:**
   - Start with the obvious query (the ingredient name in es-AR).
   - If thin or empty: try synonyms (palta↔aguacate), strip qualifiers (integral,
     orgánico), drop brand if present, broaden ("tapas empanadas" → "tapas"),
     try the parent category.
   - Stop refining after ~3-4 attempts per ingredient and `skipIngredient` if
     nothing reasonable surfaced.
5. **`cartQty` math:** unchanged from current matcher — `(recipe need) ÷ (package
   size from SKU name)`, rounded up, minimum 1. Same worked examples as today.
6. **User preferences:** honored when applicable.
7. **Output rule:** call `submitPick` for every matchable ingredient,
   `skipIngredient` for unmatchable. Don't loop forever.

### resolve.ts changes

Drop the pre-search `Promise.all` loop. New flow:

```ts
const { aggregated, skipped, recipeSummaries } = await aggregate({ recipes, preferences });

const { picks, skipped: agentSkipped, candidatesById } = await matchAgent({
  store, aggregated, recipeSummaries, preferences,
});

// Same join as today: pick.pickedSkuId → product from candidatesById → MatchedItem
```

`agentSkipped` items become `unmatched` (they're aggregated ingredients with no
pick). Aggregate-level `skipped` (pantry staples) flows through unchanged.

## Testing

### Unit tests (`src/lib/llm/__tests__/match-agent.test.ts`)

Mock `productSearch` and `generateText`. Verify:

- Agent's `searchProducts` calls populate `candidatesById` correctly per
  `ingredientIndex`.
- Search cache: same query twice = one underlying `productSearch` call.
- Partial progress: when step cap hits with 3 of 5 ingredients submitted, output
  has 3 picks and the other 2 land in `unmatched` upstream.
- Skip path: `skipIngredient` produces no pick, no error.

### Aggregate test update

`src/lib/checkout/__tests__/aggregate.test.ts` updates to assert
`recipeSummaries[]` is populated with one entry per ready recipe.

### Live eval (`src/lib/checkout/__tests__/eval.live.test.ts`)

Existing 6 fixtures (es×2, en×2, fr×2). Add an assertion: `recall = matched.length /
aggregated.length ≥ baseline`. Run before merging to confirm the new pipeline doesn't
regress recall on the existing corpus.

## Cost & latency budget

Per resolve invocation, rough order-of-magnitude:

- **Today:** 1 aggregate call + N parallel HTTP searches + 1 match call ≈ 2 LLM
  calls, ~3-5s total.
- **After:** 1 aggregate call + 1 agent loop with up to `5 + 4N` steps. Each step
  is one LLM call + zero or one HTTP search. For 15 ingredients average ~3 steps
  each: ~50 LLM calls, ~30 HTTP searches, ~30-60s total. Roughly 25× the matcher
  cost.

The user has explicitly accepted this tradeoff for better recall.

## Migration

`src/lib/llm/match.ts` is deleted. `pickSkus` and its export are removed. No
callers outside `resolve.ts`. `MatchSchema` and `Pick` types stay in `types.ts`.

`Resolution` state shape in `~/types/plan.ts` is unchanged. No localStorage
migration needed.

## Load-bearing decisions

- **Whole-list agent, not per-ingredient.** User explicitly wants cross-ingredient
  context (knowing what dishes are being cooked informs picks). Per-ingredient
  parallel agents would be cheaper and faster but lose this signal.
- **Sonnet 4.6, not Opus 4.7.** Sonnet is strong at tool-use loops; the price
  delta to Opus isn't justified by a "search and pick" task profile. Revisit if
  eval shows recall is still poor.
- **Search cache scoped to one resolve.** No cross-resolve caching — store
  catalogs change, and the user runs resolves rarely. Adding cross-session
  caching is YAGNI.
- **`searchProducts` returns top 15.** Trimmed to keep agent context bounded
  across many tool calls. The store adapters can return more; the matcher just
  doesn't see them.
- **Tools mutate closure-scope `Map`s, not React state.** Agent tool execution
  runs server-side in the resolve API route; results are bundled into the
  return value at the end.
