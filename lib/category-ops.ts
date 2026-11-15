import type Database from "better-sqlite3-multiple-ciphers";
import type { CategoryGroup } from "./types";

// Category list edits (Alena 2026-11-14): the Expenses card's Edit opens a
// list of every category, where categories are added, renamed and deleted
// on the fly. This file is the tested seam for those writes and for the
// default-category seeding they must coexist with. No `db` import: every
// function takes the connection, so lib/db can call seedDefaultCategories
// during its own migrate() without a cycle.

export type { CategoryGroup };
const GROUPS: readonly CategoryGroup[] = ["need", "want", "business"];

/** Input the caller got wrong — the route answers these with a 400. */
export class CategoryError extends Error {}

// Labels Cash Flow renders that are not categories — a category with one of
// these names would merge into, or be mistaken for, that row.
const RESERVED = ["uncategorized", "income", "savings", "disputed", "transfer"];

function cleanName(d: Database.Database, raw: unknown, exceptId?: number): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > 40) throw new CategoryError("Name must be 1–40 characters");
  if (RESERVED.includes(name.toLowerCase())) throw new CategoryError(`"${name}" is a built-in section, pick another name`);
  const clash = d.prepare(`SELECT id FROM categories WHERE lower(name) = lower(?) AND id IS NOT ?`)
    .get(name, exceptId ?? null);
  if (clash) throw new CategoryError("A category with that name already exists");
  return name;
}

/** Add a category at the end of the list. Returns its id. */
export function addCategory(d: Database.Database, input: { name: unknown; grp: unknown }): number {
  if (!GROUPS.includes(input.grp as CategoryGroup)) throw new CategoryError("Pick Needs, Wants or Business");
  const name = cleanName(d, input.name);
  const { next } = d.prepare(`SELECT COALESCE(MAX(sort), -1) + 1 next FROM categories`).get() as { next: number };
  const r = d.prepare(`INSERT INTO categories (name, sort, grp) VALUES (?, ?, ?)`).run(name, next, input.grp);
  return Number(r.lastInsertRowid);
}

/** Rename. Rules and transactions reference category_id, so a rename is
 *  label-only — nothing recategorizes. */
export function renameCategory(d: Database.Database, id: number, rawName: unknown): void {
  if (!d.prepare(`SELECT id FROM categories WHERE id = ?`).get(id)) throw new CategoryError("category not found");
  d.prepare(`UPDATE categories SET name = ? WHERE id = ?`).run(cleanName(d, rawName, id), id);
}

/** Delete. Non-destructive to the ledger — the category's transactions fall
 *  back to Uncategorized (category_id NULL, still visible, still
 *  re-categorizable) and its learned rules go with it, so nothing can file
 *  a transaction under a label that no longer exists. Returns how many
 *  transactions were released. */
export function deleteCategory(d: Database.Database, id: number): number {
  if (!d.prepare(`SELECT id FROM categories WHERE id = ?`).get(id)) throw new CategoryError("category not found");
  return d.transaction(() => {
    const released = d.prepare(`UPDATE transactions SET category_id = NULL WHERE category_id = ?`).run(id).changes;
    d.prepare(`DELETE FROM category_rules WHERE category_id = ?`).run(id);
    d.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
    return released;
  })();
}

/** Seed the default categories — each default exactly once per database.
 *  This runs on every start, and it used to INSERT OR IGNORE the whole
 *  default list every time: a default the user deleted came back on the
 *  next start, and a renamed one reappeared beside its new name. Now every
 *  default that has been offered is recorded in seeded_default_categories
 *  and never offered again, so the user's list is theirs. A default added
 *  to the app later is not in the record yet and still reaches existing
 *  databases. The group is set at seeding only — a later change by the user
 *  is not undone.
 *
 *  One exception, also once per database: a default listed in `business`
 *  that an older version seeded under Needs is moved to the Business group
 *  (the section did not exist then). Recorded under a `regroup:` marker. */
export function seedDefaultCategories(
  d: Database.Database,
  defaults: readonly string[],
  needs: readonly string[],
  business: readonly string[] = [],
): void {
  d.exec(`CREATE TABLE IF NOT EXISTS seeded_default_categories (name TEXT PRIMARY KEY)`);
  const seeded = new Set(
    (d.prepare(`SELECT name FROM seeded_default_categories`).all() as { name: string }[]).map((r) => r.name),
  );
  const insCat = d.prepare(`INSERT OR IGNORE INTO categories (name, sort, grp) VALUES (?, ?, ?)`);
  const setGrp = d.prepare(`UPDATE categories SET grp = ? WHERE name = ?`);
  const mark = d.prepare(`INSERT OR IGNORE INTO seeded_default_categories (name) VALUES (?)`);
  defaults.forEach((name, i) => {
    if (seeded.has(name)) return;
    const grp: CategoryGroup = business.includes(name) ? "business" : needs.includes(name) ? "need" : "want";
    insCat.run(name, i, grp);
    setGrp.run(grp, name);
    mark.run(name);
  });
  for (const name of business) {
    const marker = `regroup:business:${name}`;
    if (seeded.has(marker)) continue;
    setGrp.run("business", name);
    mark.run(marker);
  }
  d.prepare(`UPDATE categories SET grp = 'want' WHERE grp IS NULL`).run();
}

/** File a transaction under Uncategorized on purpose (the picker's
 *  Uncategorized chip, Alena 2026-11-14): an expense with no category, and
 *  flagged so categorizeTransactions and the AI pass leave it alone —
 *  otherwise the very next derive would match its merchant to a rule and
 *  put it back. Giving it a category again clears the flag (the routes'
 *  category writes do that). */
export function uncategorizeTxn(d: Database.Database, id: number): void {
  const r = d.prepare(
    `UPDATE transactions SET txn_class = 'expense', category_id = NULL, no_auto_category = 1 WHERE id = ?`,
  ).run(id);
  if (r.changes === 0) throw new CategoryError("transaction not found");
}
