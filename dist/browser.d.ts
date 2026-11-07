import { Browser, BrowserContext, Page } from "playwright";
export declare const SESSION_DIR: string;
export declare const SESSION_PATH: string;
export declare function getBrowser(): Promise<Browser>;
export declare function getContext(browser: Browser): Promise<BrowserContext>;
export declare function saveSession(context: BrowserContext): Promise<void>;
export declare function isLoggedIn(page: Page): Promise<boolean>;
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
export declare function gotoAndSettle(page: Page, url: string, options?: GotoOptions): Promise<void>;
export declare function getPage(context: BrowserContext): Promise<Page>;
export declare function closeBrowser(): Promise<void>;
//# sourceMappingURL=browser.d.ts.map