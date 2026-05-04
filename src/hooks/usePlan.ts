'use client';

import { useCallback, useEffect, useState } from 'react';
import { mutatePlan as mutateStorage, readPlan, writePlan } from '~/lib/storage/plan';
import { emptyPlan, type Plan } from '~/types/plan';

export function usePlan() {
  const [plan, setPlan] = useState<Plan>(emptyPlan());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPlan(readPlan());
    setHydrated(true);
  }, []);

  const update = useCallback((fn: (plan: Plan) => Plan) => {
    setPlan((current) => {
      const next = fn(current);
      writePlan(next);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    setPlan(readPlan());
  }, []);

  // Re-export mutateStorage so non-React code paths can use it too.
  return { plan, hydrated, update, refresh, mutateStorage };
}
