import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${fromRoot("./src")}/` },
      // "server-only" throws when imported outside a server bundle. Tests load server modules directly.
      { find: /^server-only$/, replacement: fromRoot("./tests/stubs/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Tests run in demo mode with AI off, whatever the developer's shell has set. An empty value reads as "not set".
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      ANTHROPIC_API_KEY: "",
      DEMO_COOKIE_SECRET: "",
      MCP_TOKEN: "",
      APP_ORIGIN: "",
      RATE_LIMIT_MUTATIONS_PER_MINUTE: "",
      RATE_LIMIT_AI_PER_MINUTE: "",
      TRUSTED_PROXY_HOPS: "",
      DEMO_RESET_CLEARS_LIMITS: "",
    },
  },
});
