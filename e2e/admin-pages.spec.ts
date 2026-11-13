/**
 * Admin Users and Settings pages, driven through the real UI. Written
 * before PR 8 split these pages into components and moved them onto the
 * shared data hook, so the refactor is checked against today's behavior.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("Username").fill("e2e-admin");
  await page.getByPlaceholder("Password").fill("admin-pass-123");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/");
}

/**
 * A user/channel name, even when badges share its element: "carol" must
 * match "carolADMIN" but not "carolyn". (Names in these tests are lowercase.)
 */
const named = (name: string) => new RegExp(`^\\s*${name}(?![a-z0-9_-])`);

/** The innermost element holding both this name and this button: one row. */
function row(page: Page, text: string, button: string): Locator {
  return page
    .locator("div")
    .filter({ has: page.getByText(named(text)) })
    .filter({ has: page.getByRole("button", { name: button, exact: true }) })
    .last();
}

test("admin manages users: create, promote, reset password, delete", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
  await expect(page.getByText("alice", { exact: true })).toBeVisible();

  // You can't demote or delete yourself.
  const me = row(page, "e2e-admin", "Demote");
  await expect(me.getByRole("button", { name: "Demote" })).toBeDisabled();
  await expect(me.getByRole("button", { name: "Delete" })).toBeDisabled();

  // Create
  await page.getByRole("button", { name: "Add User" }).click();
  await page.getByPlaceholder("e.g. Jane Smith").fill("carol");
  await page.getByPlaceholder("At least 8 characters").fill("carol-pass-123");
  await page.getByRole("button", { name: "Create User" }).click();
  await expect(page.getByText(named("carol"))).toBeVisible();

  // Promote
  await row(page, "carol", "Promote").getByRole("button", { name: "Promote" }).click();
  await expect(row(page, "carol", "Demote").getByText("ADMIN")).toBeVisible();

  // Reset password
  await row(page, "carol", "Reset").getByRole("button", { name: "Reset" }).click();
  await page.getByPlaceholder("At least 8 characters").fill("carol-new-pass");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(row(page, "carol", "Reset ✓").getByRole("button", { name: "Reset ✓" })).toBeVisible();

  // Delete (two clicks)
  const carol = row(page, "carol", "Delete");
  await carol.getByRole("button", { name: "Delete" }).click();
  await carol.getByRole("button", { name: "Confirm?" }).click();
  await expect(page.getByText(named("carol"))).toHaveCount(0);
});

test("admin settings: save music regions; add, test, toggle and delete a channel", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

  // Music regions
  await page.getByRole("button", { name: /^US\s*United States/ }).click();
  await expect(page.getByText("1 region selected")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("1 region selected")).toBeVisible();

  // Notification channel (the stub server accepts the test post)
  await page.getByRole("button", { name: "Add Channel" }).first().click();
  await page.getByPlaceholder("Discord #requests").fill("E2E hook");
  await page.getByRole("combobox").first().selectOption("webhook");
  await page.getByPlaceholder("https://discord.com/api/webhooks/...").fill("http://127.0.0.1:9100/hook");
  await page.getByRole("button", { name: "Add Channel" }).last().click();
  const channel = row(page, "E2E hook", "Test");
  await expect(channel).toBeVisible();

  await channel.getByRole("button", { name: "Test" }).click();
  await expect(channel.getByText("Test sent")).toBeVisible();

  await channel.getByRole("button", { name: "ON" }).click();
  await expect(channel.getByRole("button", { name: "OFF" })).toBeVisible();

  await channel.getByRole("button", { name: "Delete" }).click();
  await channel.getByRole("button", { name: "Confirm?" }).click();
  await expect(page.getByText(named("E2E hook"))).toHaveCount(0);
});
