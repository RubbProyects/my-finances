// Public demo: the same app, deployed a second time with its own Supabase and fake data.
// It's switched on with NEXT_PUBLIC_DEMO=1 (only in the demo's Vercel project). Then:
// - the sign-in screen has a "Try the demo" button that signs in with the demo user;
// - the app starts in English and is called "My Finances";
// - there's no real bank connection (the bank data in the demo is fake);
// - every night the cron puts the fake data back (reset_demo() in Supabase).

export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

// The demo user's email and password. They aren't secret: the button uses them for everyone
export const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "";
export const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "";

// The server error when something needs the real bank (lib/enable-banking.ts)
export const NOT_IN_DEMO = "Not available in the demo";

// Name and description of the app (browser tab and phone). They're read on the server, which
// has no language: Spanish in the personal app and English in the demo
export const APP_NAME = DEMO ? "My Finances" : "Mi cartera";
export const APP_DESCRIPTION = DEMO
  ? "My money: accounts, investments, spending and projections"
  : "Mi dinero: cuentas, inversiones, gastos y proyección";
