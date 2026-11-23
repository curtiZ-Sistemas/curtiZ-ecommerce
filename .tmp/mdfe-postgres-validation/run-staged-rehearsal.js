async (page) => {
  const url = new URL(page.url());
  if (url.origin !== "https://supabase.com" || !url.pathname.startsWith("/dashboard/project/cfendaazxctjmzpimadn/sql/")) throw Error("Unexpected SQL editor");
  const editor = page.getByRole("textbox", { name: "Editor content", exact: true });
  await editor.focus();
  await page.keyboard.press("Control+Home");
  const editorLines = page.locator(".monaco-editor .view-lines");
  const first = await editorLines.innerText({ timeout: 5000 });
  if (!first.includes("begin;") || !first.includes("stage_guard")) throw Error("Rehearsal transaction guard is missing from the start");
  await page.keyboard.press("Control+End");
  const tail = await editorLines.innerText({ timeout: 5000 });
  if (!tail.includes("rollback;") || !tail.includes("staging rehearsal rollback completed")) throw Error("Rehearsal rollback is missing from the end");
  await page.getByRole("button", { name: "Run", exact: true }).click({ timeout: 5000 });
  return { requested: true };
}
