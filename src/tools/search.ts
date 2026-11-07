import { BrowserContext, Page } from "playwright";
import { getPage, gotoAndSettle } from "../browser.js";

export type SearchCategory =
  | "spells"
  | "monsters"
  | "items"
  | "magic-items"
  | "equipment"
  | "races"
  | "classes"
  | "feats"
  | "all";

/** A single search hit. Extra fields are only present for some categories. */
interface SearchResult {
  name: string;
  type: string;
  url: string;
  /** Which D&D Beyond list the result came from (only set when "items" searches several). */
  source?: string;
  cost?: string;
  weight?: string;
  damage?: string;
  notes?: string;
  /** True when D&D Beyond marks the entry as Legacy (older 5e/2014 rules). */
  legacy?: boolean;
}

/** Category listing pages that use the div.info[data-slug] layout. */
const INFO_LISTING_PATHS: Partial<Record<SearchCategory, string>> = {
  spells: "spells",
  monsters: "monsters",
  "magic-items": "magic-items",
  races: "races",
  classes: "classes",
  feats: "feats",
};

const LEGACY_TEXT = "doesn't reflect the latest rules";

export async function search(
  context: BrowserContext,
  query: string,
  category: SearchCategory = "all"
): Promise<string> {
  const page = await getPage(context);
  const encodedQuery = encodeURIComponent(query);

  if (category === "all") {
    const url = `https://www.dndbeyond.com/search?q=${encodedQuery}`;
    return format(query, category, [url], await searchAll(page, url));
  }

  if (category === "equipment") {
    const url = `https://www.dndbeyond.com/equipment?filter-search=${encodedQuery}`;
    return format(query, category, [url], await searchEquipment(page, url));
  }

  if (category === "items") {
    // Magic items and mundane equipment live on separate D&D Beyond lists; search both.
    const magicUrl = `https://www.dndbeyond.com/magic-items?filter-search=${encodedQuery}`;
    const equipmentUrl = `https://www.dndbeyond.com/equipment?filter-search=${encodedQuery}`;
    const magic = (await searchInfoListing(page, magicUrl)).map((r) => ({ ...r, source: "magic-items" }));
    const equipment = (await searchEquipment(page, equipmentUrl)).map((r) => ({ ...r, source: "equipment" }));
    return format(query, category, [magicUrl, equipmentUrl], [...magic, ...equipment]);
  }

  const path = INFO_LISTING_PATHS[category] ?? category;
  const url = `https://www.dndbeyond.com/${path}?filter-search=${encodedQuery}`;
  return format(query, category, [url], await searchInfoListing(page, url));
}

function format(query: string, category: SearchCategory, urls: string[], results: SearchResult[]): string {
  if (results.length === 0) {
    return `No results found for "${query}" in category "${category}". Searched: ${urls.join(", ")}`;
  }
  const url = urls.length === 1 ? urls[0] : urls;
  return JSON.stringify({ query, category, url, count: results.length, results }, null, 2);
}

async function searchAll(page: Page, url: string): Promise<SearchResult[]> {
  await gotoAndSettle(page, url, { selector: ".search-result, .results-item, .no-results", settleMs: 1500 });

  return page.evaluate(() => {
    const items: Array<{ name: string; type: string; url: string }> = [];
    document.querySelectorAll(".search-result, .results-item").forEach((el) => {
      const nameLink = el.querySelector("a.result-title, a.listing-name, h2 a, h3 a") as HTMLAnchorElement | null;
      const name = nameLink?.textContent?.trim() ?? el.querySelector("h2, h3")?.textContent?.trim() ?? "";
      const type = el.querySelector(".result-category, .result-type, .listing-tag")?.textContent?.trim() ?? "";
      const link = (nameLink ?? (el.querySelector("a") as HTMLAnchorElement | null))?.href ?? "";
      if (name) items.push({ name, type, url: link });
    });
    return items;
  });
}

/** Spells, monsters, magic items, races, classes, feats: items are in div.info[data-slug] containers. */
async function searchInfoListing(page: Page, url: string): Promise<SearchResult[]> {
  await gotoAndSettle(page, url, {
    selector: ".listing-body div.info[data-slug], .no-results, .listing-empty",
    settleMs: 1500,
  });

  return page.evaluate((legacyText: string) => {
    const items: Array<{ name: string; type: string; url: string; legacy?: boolean }> = [];
    document.querySelectorAll(".listing-body div.info[data-slug]").forEach((el) => {
      // Use a.link for the name — avoids picking up child tags like <i class="i-concentration">
      const nameLink = el.querySelector("a.link") as HTMLAnchorElement | null;
      const name = nameLink?.textContent?.trim() ?? "";
      const url = nameLink?.href ?? "";
      // Pull level/CR/rarity from typed rows (avoids the noisy name row)
      const levelEl = el.querySelector(
        ".row.spell-level span, .row.monster-challenge span, .row.item-rarity span, .row.class-level span, .row.feat-prerequisite span"
      );
      const schoolEl = el.querySelector(".row.spell-school .school");
      const schoolName = schoolEl ? schoolEl.className.replace("school", "").trim() || "" : "";
      const extras = [levelEl?.textContent?.trim(), schoolName].filter(Boolean).join(" | ");
      const legacy = (el.textContent ?? "").includes(legacyText);
      if (name) items.push({ name, type: extras, url, ...(legacy ? { legacy } : {}) });
    });
    return items;
  }, LEGACY_TEXT);
}

/** Mundane equipment (weapons, armor, gear, tools): rows are div.list-row in .ddb-listing-equipment. */
async function searchEquipment(page: Page, url: string): Promise<SearchResult[]> {
  await gotoAndSettle(page, url, { selector: ".ddb-listing-equipment .list-row, .no-results", settleMs: 1500 });

  return page.evaluate((legacyText: string) => {
    const text = (row: Element, selector: string) =>
      row.querySelector(selector)?.textContent?.trim().replace(/\s+/g, " ") ?? "";
    const items: Array<{
      name: string;
      type: string;
      url: string;
      cost: string;
      weight: string;
      damage: string;
      notes: string;
      legacy?: boolean;
    }> = [];

    document.querySelectorAll(".ddb-listing-equipment .list-row").forEach((row) => {
      const nameLink = row.querySelector(".list-row-name-primary-text a.link") as HTMLAnchorElement | null;
      const name = nameLink?.textContent?.trim() ?? "";
      if (!name) return;
      const legacy = (row.textContent ?? "").includes(legacyText);
      items.push({
        name,
        type: text(row, ".list-row-name-secondary-text"),
        url: nameLink?.href ?? "",
        cost: text(row, ".list-row-col-cost"),
        weight: text(row, ".list-row-col-weight"),
        damage: text(row, ".list-row-col-damage"),
        notes: text(row, ".list-row-col-notes"),
        ...(legacy ? { legacy } : {}),
      });
    });
    return items;
  }, LEGACY_TEXT);
}
