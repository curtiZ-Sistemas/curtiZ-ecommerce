import { chromium } from "@playwright/test";

const urls = [
  "https://dash.cloudflare.com/login",
  "https://github.com/login",
  "https://supabase.com/dashboard",
  "https://resend.com/login",
];

const browser = await chromium.launch({ headless: false });
for (const url of urls) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
}
console.log("4 abas abertas: Cloudflare, GitHub, Supabase, Resend. Feche o navegador para encerrar.");
await new Promise(() => {});
