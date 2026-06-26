const {expect, test} = require("@playwright/test");

const e2eToken = process.env.E2E_TEST_TOKEN;

test("renders the built-in site editor through the real backend", async ({page}) => {
  expect(e2eToken).toBeTruthy();

  await page.addInitScript(() => {
    localStorage.setItem("language", "en");
  });

  const signin = await page.context().request.post("/api/e2e/signin", {
    headers: {
      "X-Casos-E2E-Token": e2eToken,
    },
  });
  await expect(signin).toBeOK();
  await expect(signin.json()).resolves.toMatchObject({
    status: "ok",
    data: {
      name: "ci-user",
      displayName: "CI User",
    },
  });

  await page.goto("/sites/site-built-in");
  await page.waitForLoadState("networkidle");

  await expect(page).toHaveURL(/\/sites\/site-built-in$/);
  await expect(page.locator("#parent-area")).toBeVisible();
  await expect(page.getByText("CI User")).toBeVisible();
  await expect(page.getByText("Edit Site")).toBeVisible();
  await expect(page.locator("input[disabled]").first()).toHaveValue("site-built-in");
  await expect(page.getByRole("button", {name: "Save"}).first()).toBeVisible();
});
