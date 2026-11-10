// A stand-in for the cookie store of next/headers, for tests that call route handlers directly.
// Use with: vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));

const jar = new Map<string, string>();
const options = new Map<string, Record<string, unknown>>();

export const cookieJar = {
  get(name: string): { name: string; value: string } | undefined {
    const value = jar.get(name);
    return value === undefined ? undefined : { name, value };
  },
  getAll(): { name: string; value: string }[] {
    return [...jar].map(([name, value]) => ({ name, value }));
  },
  set(name: string, value: string, cookieOptions: Record<string, unknown> = {}): void {
    jar.set(name, value);
    options.set(name, cookieOptions);
  },
  delete(name: string): void {
    jar.delete(name);
    options.delete(name);
  },
};

/** The options the cookie was last set with. */
export function cookieOptions(name: string): Record<string, unknown> | undefined {
  return options.get(name);
}

export function clearCookies(): void {
  jar.clear();
  options.clear();
}
