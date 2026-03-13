export type SchedulerPriority = "verify" | "finalize" | "evidence" | "draft" | "weave" | "final" | "default";

export type ProviderSchedulerPolicy = {
  maxConcurrency: number;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio?: number;
};

type ProviderSchedulerState = {
  active: number;
  queue: SchedulerTask<unknown>[];
};

type SchedulerTask<T> = {
  provider: string;
  priority: number;
  sequence: number;
  run: (attempt: number) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export class SchedulerHttpError extends Error {
  status: number;

  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = "SchedulerHttpError";
    this.status = status;
  }
}

function normalizePositiveInt(value: number | undefined, fallback: number, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.floor(value));
}

function normalizePositiveFloat(value: number | undefined, fallback: number, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, value);
}

function priorityWeight(priority: SchedulerPriority | string | undefined): number {
  switch ((priority ?? "default").toString().trim().toLowerCase()) {
    case "verify":
      return 600;
    case "finalize":
      return 500;
    case "evidence":
      return 400;
    case "draft":
      return 300;
    case "weave":
      return 200;
    case "final":
      return 100;
    default:
      return 0;
  }
}

function isRetryableError(error: unknown): boolean {
  const status =
    typeof error === "object" && error && "status" in error && Number.isFinite(Number((error as { status?: unknown }).status))
      ? Number((error as { status?: unknown }).status)
      : null;
  if (status === 429 || (status != null && status >= 500)) return true;

  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 429/.test(message) || /HTTP 5\d\d/.test(message);
}

function computeBackoffMs(params: {
  policy: ProviderSchedulerPolicy;
  retryIndex: number;
  random: () => number;
}): number {
  const base = Math.min(params.policy.maxDelayMs, params.policy.baseDelayMs * 2 ** params.retryIndex);
  const jitterRatio = normalizePositiveFloat(params.policy.jitterRatio, 0.25, 0);
  const jitter = jitterRatio > 0 ? Math.floor(base * jitterRatio * params.random()) : 0;
  return Math.max(0, base + jitter);
}

function sortQueue(queue: SchedulerTask<unknown>[]) {
  queue.sort((left, right) => {
    if (left.priority !== right.priority) return right.priority - left.priority;
    return left.sequence - right.sequence;
  });
}

export function createProviderScheduler(params: {
  providers: Record<string, ProviderSchedulerPolicy>;
  defaultProvider?: string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}) {
  const providerPolicies = new Map<string, ProviderSchedulerPolicy>();
  for (const [provider, rawPolicy] of Object.entries(params.providers)) {
    providerPolicies.set(provider, {
      maxConcurrency: normalizePositiveInt(rawPolicy.maxConcurrency, 1, 1),
      maxRetries: normalizePositiveInt(rawPolicy.maxRetries, 0, 0),
      baseDelayMs: normalizePositiveInt(rawPolicy.baseDelayMs, 300, 0),
      maxDelayMs: normalizePositiveInt(rawPolicy.maxDelayMs, 5_000, 0),
      jitterRatio: normalizePositiveFloat(rawPolicy.jitterRatio, 0.25, 0),
    });
  }

  const defaultProvider = params.defaultProvider ?? Object.keys(params.providers)[0] ?? "default";
  if (!providerPolicies.has(defaultProvider)) {
    providerPolicies.set(defaultProvider, {
      maxConcurrency: 1,
      maxRetries: 0,
      baseDelayMs: 300,
      maxDelayMs: 5_000,
      jitterRatio: 0.25,
    });
  }

  const sleep = params.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = params.random ?? Math.random;
  const providerStates = new Map<string, ProviderSchedulerState>();
  let sequence = 0;

  function readPolicy(provider: string): ProviderSchedulerPolicy {
    return providerPolicies.get(provider) ?? providerPolicies.get(defaultProvider)!;
  }

  function readState(provider: string): ProviderSchedulerState {
    let state = providerStates.get(provider);
    if (!state) {
      state = { active: 0, queue: [] };
      providerStates.set(provider, state);
    }
    return state;
  }

  async function runWithRetries<T>(task: SchedulerTask<T>, policy: ProviderSchedulerPolicy): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        return await task.run(attempt);
      } catch (error) {
        const retriesUsed = attempt - 1;
        if (!isRetryableError(error) || retriesUsed >= policy.maxRetries) throw error;
        const backoffMs = computeBackoffMs({ policy, retryIndex: retriesUsed, random });
        await sleep(backoffMs);
      }
    }
  }

  function pump(provider: string) {
    const state = readState(provider);
    const policy = readPolicy(provider);
    while (state.active < policy.maxConcurrency && state.queue.length > 0) {
      const next = state.queue.shift()!;
      state.active += 1;
      void runWithRetries(next, policy)
        .then((value) => next.resolve(value))
        .catch((error) => next.reject(error))
        .finally(() => {
          state.active -= 1;
          pump(provider);
        });
    }
  }

  return {
    schedule<T>(params: {
      provider?: string;
      priority?: SchedulerPriority | string;
      run: (attempt: number) => Promise<T>;
    }): Promise<T> {
      const provider = (params.provider ?? defaultProvider).trim() || defaultProvider;
      const state = readState(provider);
      return awaitable<T>((resolve, reject) => {
        state.queue.push({
          provider,
          priority: priorityWeight(params.priority),
          sequence,
          run: params.run,
          resolve,
          reject,
        });
        sequence += 1;
        sortQueue(state.queue);
        pump(provider);
      });
    },
  };
}

function awaitable<T>(executor: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
  return new Promise<T>(executor);
}
