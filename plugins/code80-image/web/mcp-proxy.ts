export type RetryOptions = {
  delays?: readonly number[];
  wait?: (milliseconds: number) => Promise<void>;
};

const DEFAULT_DELAYS = [200, 500, 1_000] as const;

export function errorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

export function isTransientMcpProxyError(failure: unknown): boolean {
  const text = errorMessage(failure);
  return /MCP proxy request failed|MCP error\s+-32000/i.test(text);
}

export async function retryTransientMcpOperation<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const delays = options.delays ?? DEFAULT_DELAYS;
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)));

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (failure) {
      const delay = delays[attempt];
      if (!isTransientMcpProxyError(failure) || delay === undefined) throw failure;
      await wait(delay);
    }
  }
}
