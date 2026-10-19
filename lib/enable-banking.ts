// Calls to Enable Banking (reading bank accounts). ONLY on the server:
// it uses the application's private key, which lives in Vercel and never reaches the browser.
import { createSign } from "node:crypto";
import { DEMO, NOT_IN_DEMO } from "@/lib/demo";

const API_URL = process.env.ENABLE_BANKING_URL ?? "https://api.enablebanking.com";

export type Aspsp = {
  name: string;
  country: string;
  beta?: boolean;
  maximum_consent_validity?: number | null; // in seconds
};

export type SessionAccount = {
  uid: string;
  identification_hash?: string | null;
  name?: string | null;
  currency?: string | null;
  account_id?: { iban?: string | null } | null;
};

export type Session = {
  session_id: string;
  accounts: SessionAccount[];
  access: { valid_until: string };
};

// Error with the HTTP code, to tell "the permission expired" apart from other failures
export class BankError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const base64url = (x: string | Buffer) => Buffer.from(x).toString("base64url");

// Token signed with the private key (lasts one hour)
function token(): string {
  const appId = process.env.ENABLE_BANKING_APP_ID;
  const key = process.env.ENABLE_BANKING_KEY;
  if (!appId || !key) {
    throw new Error(
      "The server is missing the ENABLE_BANKING_APP_ID and ENABLE_BANKING_KEY variables",
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const body = base64url(
    JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: now,
      exp: now + 3600,
    }),
  );
  // The key may come with real line breaks or written as \n
  const pem = key.replace(/\\n/g, "\n");
  const signature = createSign("RSA-SHA256").update(`${header}.${body}`).sign(pem);
  return `${header}.${body}.${base64url(signature)}`;
}

export async function callBank<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  // The demo has no real bank: every bank route stops here
  if (DEMO) throw new Error(NOT_IN_DEMO);
  const r = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {}
  if (!r.ok) {
    const detail = json.message ?? json.detail ?? json.error ?? text.slice(0, 200);
    throw new BankError(r.status, `Enable Banking ${r.status}: ${String(detail)}`);
  }
  return json as T;
}

// Headers with the user's IP and browser: this way the bank knows you're there
// (some banks limit downloads without the user present to 4 a day)
export function userHeaders(request: Request): Record<string, string> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const browser = request.headers.get("user-agent");
  return {
    ...(ip ? { "Psu-Ip-Address": ip } : {}),
    ...(browser ? { "Psu-User-Agent": browser } : {}),
  };
}
