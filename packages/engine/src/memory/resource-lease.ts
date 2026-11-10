import { MEMORY_CATEGORIES, type MemoryCategory } from '../diagnostics/memory-ledger.js';

import { BufferResourceLease } from './buffer-resource-lease.js';
import type {
  Admission,
  HandoffMemoryPlan,
  ResourceAdmission,
  ResourceAdmissionOptions,
} from './resource-lease-types.js';

interface Reservation {
  readonly categories: readonly number[];
  readonly total: number;
}

/**
 * Creates GPU reservation accounting without activating optional preview rendering.
 * A backend's leases share one authority; unrelated ledger allocations remain charged.
 *
 * @param options - Backend, completion fence, ledger and existing device limits.
 * @returns The device-scoped reservation authority.
 */
export function createResourceAdmission(options: ResourceAdmissionOptions): ResourceAdmission {
  const reservations = new Set<Reservation>();
  const owned = new Map<MemoryCategory, number>();
  const fits = (extra?: Reservation): boolean => {
    let total = extra?.total ?? 0;
    for (const reservation of reservations) total += reservation.total;
    for (const [index, category] of MEMORY_CATEGORIES.entries()) {
      const external = options.ledger.bytesOf(category) - (owned.get(category) ?? 0);
      let bytes = external + (extra?.categories[index] ?? 0);
      for (const reservation of reservations) bytes += reservation.categories[index] ?? 0;
      if (!isBytes(bytes) || bytes > options.budget.bytesByCategory[category]) return false;
      total += external;
    }
    return isBytes(total) && total <= options.budget.totalBytes;
  };
  return {
    reserve: (plan): Admission => {
      const reservation = readReservation(plan);
      if (reservation === undefined || !fits(reservation)) {
        return {
          isAdmitted: false,
          reason: 'Preview/live memory reservation exceeds known limits.',
        };
      }
      reservations.add(reservation);
      const lease = new BufferResourceLease(options, reservation.categories, {
        canAllocate: () => fits(),
        charge: (category, bytes) => owned.set(category, (owned.get(category) ?? 0) + bytes),
        release: () => reservations.delete(reservation),
      });
      return { isAdmitted: true, lease };
    },
  };
}

function readReservation(plan: HandoffMemoryPlan): Reservation | undefined {
  if (!plan.attempt || !Number.isSafeInteger(plan.generation) || plan.generation < 0)
    return undefined;
  if (!isBytes(plan.uncategorizedReserve)) return undefined;
  const terms = [plan.shared, plan.previewOnly, plan.liveOnlyReserve, plan.transientReserve];
  if (
    terms.some((term) =>
      Object.keys(term).some((key) => !MEMORY_CATEGORIES.includes(key as MemoryCategory)),
    )
  )
    return undefined;
  const categories: number[] = [];
  let total = plan.uncategorizedReserve;
  for (const category of MEMORY_CATEGORIES) {
    let bytes = 0;
    for (const term of terms) {
      const value = term[category] ?? 0;
      if (!isBytes(value)) return undefined;
      bytes += value;
      if (!isBytes(bytes)) return undefined;
    }
    categories.push(bytes);
    total += bytes;
    if (!isBytes(total)) return undefined;
  }
  return { categories, total };
}

function isBytes(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}
