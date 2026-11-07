import { chromium, Browser, BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const SESSION_DIR = join(homedir(), ".config", "ddb-mcp");
export const SESSION_PATH = join(SESSION_DIR, "session.json");

let browserInstance: Browser | null = null;
let contextInstance: BrowserContext | null = null;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const LAUNCH_ARGS = ["--no-sandbox", "--disable-blink-features=AutomationControlled"];

/**
 * The shared browser runs headless (no visible window) by default. Set
 * DDB_HEADLESS=false to watch it work. Login always uses its own visible
 * window, because the user has to sign in by hand (see launchVisibleBrowser).
 */
const HEADLESS = process.env.DDB_HEADLESS !== "false";

export async function getBrowser(): Promise<Browser> {
  if (browserInstance) return browserInstance;
  browserInstance = await chromium.launch({ headless: HEADLESS, args: LAUNCH_ARGS });
  return browserInstance;
}

/** Launch a separate, visible browser for interactive sign-in. The caller must close it. */
export async function launchVisibleBrowser(): Promise<Browser> {
  return chromium.launch({ headless: false, args: LAUNCH_ARGS });
}

/** Create a context with the shared user agent and viewport, restoring the saved session if present. */
export async function newSessionContext(browser: Browser): Promise<BrowserContext> {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
  return browser.newContext({
    ...(existsSync(SESSION_PATH) ? { storageState: SESSION_PATH } : {}),
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
  });
}

export async function getContext(browser: Browser): Promise<BrowserContext> {
  if (contextInstance) return contextInstance;
  contextInstance = await newSessionContext(browser);
  return contextInstance;
}

/** Drop the shared context so the next getContext() reloads the session from disk. */
export async function resetContext(): Promise<void> {
  if (contextInstance) {
    await contextInstance.close();
    contextInstance = null;
  }
}

export async function saveSession(context: BrowserContext): Promise<void> {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
  await context.storageState({ path: SESSION_PATH });
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto("https://www.dndbeyond.com", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2000);

    // If we got redirected off dndbeyond.com (e.g. to Wizards login), we're not logged in
    const currentUrl = page.url();
    if (!currentUrl.includes("dndbeyond.com") || currentUrl.includes("/login") || currentUrl.includes("/sign-in")) {
      return false;
    }

    // Check for visible "Sign In" / "Log In" text — these only appear when NOT logged in
    return await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll("a, button"));
      const signInEl = allElements.find((el) => {
        const text = (el.textContent || "").trim().toLowerCase();
        return text === "sign in" || text === "log in";
      });
      return !signInEl;
    });
  } catch {
    return false;
  }
}

export interface GotoOptions {
  /** CSS selector for the content the caller needs; waited for (best effort) after the DOM loads. */
  selector?: string;
  /** Timeout for the initial navigation, in ms. */
  timeout?: number;
  /** Timeout for the selector wait, in ms. */
  selectorTimeout?: number;
  /** Fixed pause after loading, to let client-side rendering finish, in ms. */
  settleMs?: number;
}

/**
 * Navigate without waiting for "networkidle". D&D Beyond pages keep ads and
 * analytics requests running indefinitely, so networkidle often never fires
 * and page.goto times out even though the page has loaded. Instead, wait for
 * the DOM, then for the specific content we need, then give the network a
 * short, best-effort chance to quiet down.
 */
export async function gotoAndSettle(page: Page, url: string, options: GotoOptions = {}): Promise<void> {
  const { selector, timeout = 30000, selectorTimeout = 15000, settleMs = 1000 } = options;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout });

  if (selector) {
    await page.waitForSelector(selector, { timeout: selectorTimeout }).catch(() => {});
  }

  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(settleMs);
}

export async function getPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  if (pages.length > 0) return pages[0];
  return context.newPage();
}

export async function closeBrowser(): Promise<void> {
  if (contextInstance) {
    await contextInstance.close();
    contextInstance = null;
  }
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
