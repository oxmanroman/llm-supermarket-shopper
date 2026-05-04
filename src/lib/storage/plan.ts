import { emptyPlan, PlanSchema, type Plan } from '~/types/plan';

export const KEY = 'plan:v3';

const V2_KEYS = ['cart:jumbo', 'cart:carrefour', 'store', 'preferences'];

function migrate(): Plan {
  // Port v2 preferences if present, then wipe v2 keys.
  const portedPreferences = localStorage.getItem('preferences') ?? '';
  for (const k of V2_KEYS) localStorage.removeItem(k);
  const plan = emptyPlan(portedPreferences);
  localStorage.setItem(KEY, JSON.stringify(plan));
  return plan;
}

export function readPlan(): Plan {
  if (typeof localStorage === 'undefined') return emptyPlan();
  const raw = localStorage.getItem(KEY);
  if (!raw) return migrate();
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = PlanSchema.safeParse(parsed);
    if (!result.success) return emptyPlan();
    return result.data;
  } catch {
    return emptyPlan();
  }
}

export function writePlan(plan: Plan): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(plan));
}

export function mutatePlan(fn: (plan: Plan) => Plan): Plan {
  const next = fn(readPlan());
  writePlan(next);
  return next;
}
