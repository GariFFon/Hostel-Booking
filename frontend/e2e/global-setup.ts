import { request, type FullConfig } from "@playwright/test";
import { mkdir } from "node:fs/promises";

export const ACCOUNTS = { guest3: "guest3@hostel.dev", guest4: "guest4@hostel.dev", guest2: "guest2@hostel.dev", owner1: "owner1@hostel.dev", owner2: "owner2@hostel.dev", owner3: "owner3@hostel.dev", admin: "admin@hostel.dev" } as const;
export const authFile = (name: keyof typeof ACCOUNTS) => `e2e/.auth/${name}.json`;

/**
 * Signs each demo account in ONCE per run (through the website's own BFF, exactly like the login form does) and saves the
 * cookies. Tests reuse them, so a full run makes ~6 logins instead of dozens and never trips the login rate limiter.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL ?? "http://localhost:3000";
  await mkdir("e2e/.auth", { recursive: true });
  for (const [name, email] of Object.entries(ACCOUNTS)) {
    const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
    const res = await ctx.post("/api/bff/auth/login", { data: { email, password: "Password@123" } });
    if (!res.ok()) throw new Error(`global setup: could not sign in ${email}: HTTP ${res.status()} ${await res.text()}`);
    await ctx.storageState({ path: authFile(name as keyof typeof ACCOUNTS) });
    await ctx.dispose();
  }
}
