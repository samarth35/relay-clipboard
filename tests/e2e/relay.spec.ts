import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const artifactDir = process.env.RELAY_ARTIFACT_DIR;
async function screenshot(page: Page, name: string) {
  if (artifactDir) { await mkdir(artifactDir, { recursive: true }); await page.screenshot({ path: path.join(artifactDir, name), fullPage: true }); }
}
async function createRoom(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "10 min", exact: true }).click();
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await expect(page).toHaveURL(/\/r\/[a-f0-9]{32}#key=/);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  return page.url();
}

test("homepage, responsive layout, and native dialog keyboard behavior", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/");
  await expect(page).toHaveTitle(/Relay/);
  await expect(page.getByRole("heading", { name: "Your clipboard. Everywhere." })).toBeVisible();
  expect(response?.headers()["content-security-policy"]).toContain("'nonce-");
  expect(response?.headers()["content-security-policy"]).not.toContain("'unsafe-eval'");
  await screenshot(page, "relay-home-desktop.png");
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Create room", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, "relay-home-mobile.png");
  expect(errors).toEqual([]);
});

test("two isolated devices exchange encrypted snippets, code, and pad updates", async ({ browser, page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const calls: { url: string; data: string; auth: string }[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/rooms")) calls.push({ url: request.url(), data: request.postData() ?? "", auth: request.headers().authorization ?? "" }); });
  const url = await createRoom(page);
  const second = await browser.newContext({ baseURL, viewport: { width: 1536, height: 1024 } });
  const other = await second.newPage();
  await other.goto(url);
  await expect(other.getByText("Connected", { exact: true })).toBeVisible();
  const text = '<script>window.__relay_xss = true</script>\nHello from device one 👋';
  await page.getByRole("textbox", { name: "Snippet text", exact: true }).fill(text);
  await page.getByRole("button", { name: "Send snippet" }).click();
  await expect(page.getByRole("textbox", { name: "Snippet text", exact: true })).toHaveValue("");
  await expect(other.locator(".snippet-body pre")).toContainText(text);
  expect(await other.evaluate(() => "__relay_xss" in window)).toBe(false);
  await other.getByRole("textbox", { name: "Snippet text", exact: true }).fill("const message = 'See you there.';");
  await other.getByRole("textbox", { name: "Snippet text", exact: true }).press("Control+Enter");
  await expect(page.locator(".snippet-body pre").first()).toContainText("const message");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy snippet", exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("const message = 'See you there.';");
  await page.getByRole("button", { name: "Copy room link", exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.getByRole("tab", { name: "Shared pad" }).click();
  await other.getByRole("tab", { name: "Shared pad" }).click();
  await page.getByRole("textbox", { name: "Shared pad", exact: true }).fill("Shared note from device one");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await expect(other.getByRole("textbox", { name: "Shared pad", exact: true })).toHaveValue("Shared note from device one");
  await page.getByRole("tab", { name: "Snippets" }).click();
  await screenshot(page, "relay-room-desktop.png");
  const key = new URLSearchParams(new URL(url).hash.slice(1)).get("key")!;
  for (const call of calls) { expect(call.url + call.data + call.auth).not.toContain(key); expect(call.data).not.toContain("Hello from device one"); expect(call.data).not.toContain("Shared note from device one"); }
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Share room", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Copy room link" })).toBeVisible();
  await expect(page.getByRole("dialog").locator(".qr-frame svg")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await screenshot(page, "relay-room-mobile.png");
  expect(errors).toEqual([]);
  await second.close();
});

test("competing pad edits preserve both versions and can save the local version as a snippet", async ({ browser, page, baseURL }) => {
  const url = await createRoom(page);
  const second = await browser.newContext({ baseURL });
  const other = await second.newPage(); await other.goto(url);
  await expect(other.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Shared pad" }).click();
  await other.getByRole("tab", { name: "Shared pad" }).click();
  await second.setOffline(true);
  await other.getByRole("textbox", { name: "Shared pad", exact: true }).fill("Device B offline draft");
  await page.getByRole("textbox", { name: "Shared pad", exact: true }).fill("Device A saved version");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await second.setOffline(false);
  await expect(other.getByRole("heading", { name: "Another device edited the pad." })).toBeVisible();
  await expect(other.locator(".conflict-versions")).toContainText("Device B offline draft");
  await expect(other.locator(".conflict-versions")).toContainText("Device A saved version");
  await other.getByRole("button", { name: "Save mine as snippet" }).click();
  await expect(other.getByRole("textbox", { name: "Shared pad", exact: true })).toHaveValue("Device A saved version");
  await expect(page.locator(".snippet-body pre")).toContainText("Device B offline draft");
  await second.close();
});

test("incomplete room links fail safely; deletion revokes the room on another device", async ({ browser, page, baseURL }) => {
  const url = await createRoom(page);
  const second = await browser.newContext({ baseURL });
  const other = await second.newPage();
  await other.goto(url.split("#")[0]);
  await expect(other.getByRole("heading", { name: "Room unavailable." })).toBeVisible();
  await expect(other.getByRole("textbox", { name: "Snippet text", exact: true })).toBeDisabled();
  await other.goto(url);
  await expect(other.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Room options" }).click();
  await page.getByRole("button", { name: "Delete room", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete room", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Room deleted." })).toBeVisible();
  await expect(other.getByRole("heading", { name: "Room unavailable." })).toBeVisible();
  await second.close();
});
