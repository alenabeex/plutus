import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import {
  addCategory, renameCategory, deleteCategory, seedDefaultCategories, CategoryError,
} from "../category-ops";
import { categorizeTransactions, cashflowView } from "../derive";

const DEFAULTS = ["Rent / Housing", "Insurance", "Groceries"];
const NEEDS = ["Rent / Housing", "Insurance"];

function makeDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort INTEGER DEFAULT 0, grp TEXT DEFAULT 'want'
    );
    CREATE TABLE category_rules (
      id INTEGER PRIMARY KEY, pattern TEXT NOT NULL, field TEXT DEFAULT 'merchant', category_id INTEGER
    );
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY, nickname TEXT, name TEXT, mask TEXT,
      kind TEXT, institution TEXT, cashflow_role TEXT
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY, account_id INTEGER, date TEXT, name TEXT, merchant TEXT,
      amount REAL, category_id INTEGER, pending INTEGER DEFAULT 0,
      txn_class TEXT, date_override TEXT
    );
  `);
  seedDefaultCategories(d, DEFAULTS, NEEDS);
  return d;
}

const names = (d: Database.Database) =>
  (d.prepare(`SELECT name FROM categories ORDER BY sort, id`).all() as { name: string }[]).map((r) => r.name);
const idOf = (d: Database.Database, name: string) =>
  (d.prepare(`SELECT id FROM categories WHERE name = ?`).get(name) as { id: number }).id;
const grpOf = (d: Database.Database, name: string) =>
  (d.prepare(`SELECT grp FROM categories WHERE name = ?`).get(name) as { grp: string }).grp;

describe("seedDefaultCategories", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("seeds every default with its need/want group", () => {
    expect(names(d)).toEqual(DEFAULTS);
    expect(grpOf(d, "Insurance")).toBe("need");
    expect(grpOf(d, "Groceries")).toBe("want");
  });

  // The bug this replaces: startup re-inserted the whole default list.
  it("never brings back a default the user deleted", () => {
    deleteCategory(d, idOf(d, "Insurance"));
    seedDefaultCategories(d, DEFAULTS, NEEDS);
    seedDefaultCategories(d, DEFAULTS, NEEDS);
    expect(names(d)).toEqual(["Rent / Housing", "Groceries"]);
  });

  it("never re-creates a default beside its renamed self", () => {
    renameCategory(d, idOf(d, "Insurance"), "Car + Renters Ins.");
    seedDefaultCategories(d, DEFAULTS, NEEDS);
    expect(names(d)).toEqual(["Rent / Housing", "Car + Renters Ins.", "Groceries"]);
  });

  it("still delivers a default that is new to the app", () => {
    seedDefaultCategories(d, [...DEFAULTS, "Business Expense"], [...NEEDS, "Business Expense"]);
    expect(names(d)).toContain("Business Expense");
    expect(grpOf(d, "Business Expense")).toBe("need");
  });

  it("keeps the user's own categories across restarts", () => {
    addCategory(d, { name: "Therapy", grp: "need" });
    seedDefaultCategories(d, DEFAULTS, NEEDS);
    expect(names(d)).toEqual([...DEFAULTS, "Therapy"]);
    expect(grpOf(d, "Therapy")).toBe("need");
  });

  // A database from before this record existed: one pass adopts what is
  // there without duplicating, and deletions stick from then on.
  it("adopts a pre-existing database once, then leaves it alone", () => {
    d.exec(`DROP TABLE seeded_default_categories`);
    seedDefaultCategories(d, DEFAULTS, NEEDS);
    expect(names(d)).toEqual(DEFAULTS);
    deleteCategory(d, idOf(d, "Groceries"));
    seedDefaultCategories(d, DEFAULTS, NEEDS);
    expect(names(d)).toEqual(["Rent / Housing", "Insurance"]);
  });
});

describe("addCategory", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("adds a trimmed category at the end, in the chosen group", () => {
    const id = addCategory(d, { name: "  Childcare ", grp: "need" });
    expect(names(d)).toEqual([...DEFAULTS, "Childcare"]);
    expect(grpOf(d, "Childcare")).toBe("need");
    expect(idOf(d, "Childcare")).toBe(id);
  });

  it("rejects an empty or over-long name, a bad group, a duplicate, and a built-in label", () => {
    expect(() => addCategory(d, { name: "  ", grp: "want" })).toThrow(CategoryError);
    expect(() => addCategory(d, { name: "x".repeat(41), grp: "want" })).toThrow(CategoryError);
    expect(() => addCategory(d, { name: "Coffee", grp: "luxury" })).toThrow(CategoryError);
    expect(() => addCategory(d, { name: "insurance", grp: "need" })).toThrow(/already exists/);
    expect(() => addCategory(d, { name: "Uncategorized", grp: "want" })).toThrow(CategoryError);
    expect(() => addCategory(d, { name: "Transfer", grp: "want" })).toThrow(CategoryError);
    expect(names(d)).toEqual(DEFAULTS);
  });

  it("is usable at once: a rule can file transactions under it", () => {
    const id = addCategory(d, { name: "Coffee", grp: "want" });
    d.prepare(`INSERT INTO transactions (date, name, merchant, amount, txn_class) VALUES ('2026-07-03', 'BLUE BOTTLE', 'Blue Bottle', 6.5, 'expense')`).run();
    d.prepare(`INSERT INTO category_rules (pattern, category_id) VALUES ('blue bottle', ?)`).run(id);
    categorizeTransactions(d);
    const v = cashflowView("2026-07", d);
    expect(v.expenses.map((e) => [e.label, e.value, e.grp])).toEqual([["Coffee", 6.5, "want"]]);
  });
});

describe("renameCategory", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("renames in place and allows a case-only change", () => {
    renameCategory(d, idOf(d, "Groceries"), "groceries");
    expect(names(d)).toEqual(["Rent / Housing", "Insurance", "groceries"]);
  });

  it("rejects a clash with another category and an unknown id", () => {
    expect(() => renameCategory(d, idOf(d, "Groceries"), "Insurance")).toThrow(/already exists/);
    expect(() => renameCategory(d, 999, "Nope")).toThrow(CategoryError);
  });
});

describe("deleteCategory", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("releases its transactions to Uncategorized and removes its rules — the money stays counted", () => {
    const id = idOf(d, "Groceries");
    d.prepare(`INSERT INTO transactions (date, name, merchant, amount, category_id, txn_class) VALUES ('2026-07-03', 'SAFEWAY', 'Safeway', 80, ?, 'expense')`).run(id);
    d.prepare(`INSERT INTO category_rules (pattern, category_id) VALUES ('safeway', ?)`).run(id);
    d.prepare(`INSERT INTO category_rules (pattern, category_id) VALUES ('geico', ?)`).run(idOf(d, "Insurance"));

    expect(deleteCategory(d, id)).toBe(1);
    expect(names(d)).toEqual(["Rent / Housing", "Insurance"]);
    expect((d.prepare(`SELECT pattern FROM category_rules`).all() as { pattern: string }[]).map((r) => r.pattern)).toEqual(["geico"]);
    const v = cashflowView("2026-07", d);
    expect(v.expenses.map((e) => [e.label, e.value])).toEqual([["Uncategorized", 80]]);
    expect(v.totalExpenses).toBe(80);
  });

  it("rejects an unknown id", () => {
    expect(() => deleteCategory(d, 999)).toThrow(CategoryError);
  });
});
