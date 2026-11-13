// Read-only, anonymous public-page observation helper. No account login or jobs.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  if (process.argv.includes("--close")) {
    const connected = await chromium.connectOverCDP("http://127.0.0.1:9341");
    const session = await connected.newBrowserCDPSession();
    await session.send("Browser.close");
    console.log("Closed the owned anonymous observation browser");
    return;
  }
  if (process.argv.includes("--codex-tab")) {
    const connected = await chromium.connectOverCDP("http://127.0.0.1:9341");
    const page = connected
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url() === "https://www.autolab.ai/");
    if (!page) throw new Error("The owned public marketing page is unavailable");
    await page.getByRole("tab", { name: "Codex", exact: true }).click();
    console.log("Selected the public marketing Codex tab");
    await connected.close();
    return;
  }
  const raw = path.join(__dirname, "raw");
  fs.mkdirSync(raw, { recursive: true });
  const browser = await chromium.launchPersistentContext(
    path.join(__dirname, "local-browser"),
    {
      headless: true,
      args: ["--disable-extensions", "--remote-debugging-port=9341"],
    },
  );
  process.once("SIGINT", async () => {
    await browser.close();
    process.exit(0);
  });
  process.once("SIGTERM", async () => {
    await browser.close();
    process.exit(0);
  });
  fs.writeFileSync(
    path.join(raw, "endpoint.json"),
    JSON.stringify({
      endpoint: "http://127.0.0.1:9341",
    }),
  );
  for (const url of [
    "https://www.autolab.ai/",
    "https://docs.autolab.ai/",
    "https://app.autolab.ai/",
  ]) {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    } catch (error) {
      console.log(JSON.stringify({ url, navigationError: error.message }));
    }
    console.log(JSON.stringify({ url: page.url(), title: await page.title() }));
  }
  console.log("Anonymous public observation browser ready on 9341");
  await new Promise(() => {});
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
