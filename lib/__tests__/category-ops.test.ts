import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import {
  addCategory, renameCategory, setCategoryIcon, updateCategory, deleteCategory, seedDefaultCategories, uncategorizeTxn, CategoryError,
} from "../category-ops";
import { categorizeTransactions, cashflowView } from "../derive";
import { guessCategoryIcon, isCategoryIconKey, CATEGORY_ICON_KEYS, CATEGORY_ICON_LABELS } from "../category-icons";

const DEFAULTS = ["Rent / Housing", "Insurance", "Groceries"];
const NEEDS = ["Rent / Housing", "Insurance"];

function makeDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort INTEGER DEFAULT 0, grp TEXT DEFAULT 'want',
      icon TEXT
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
      txn_class TEXT, date_override TEXT, no_auto_category INTEGER DEFAULT 0
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

  // Business became its own section on 2026-11-14; before that the default
  // "Business Expense" was seeded under Needs.
  it("seeds a business default in the Business group", () => {
    seedDefaultCategories(d, [...DEFAULTS, "Business Expense"], NEEDS, ["Business Expense"]);
    expect(grpOf(d, "Business Expense")).toBe("business");
  });

  it("moves an already-seeded Needs default to Business once, then respects the user", () => {
    seedDefaultCategories(d, [...DEFAULTS, "Business Expense"], [...NEEDS, "Business Expense"]);
    expect(grpOf(d, "Business Expense")).toBe("need");
    seedDefaultCategories(d, [...DEFAULTS, "Business Expense"], NEEDS, ["Business Expense"]);
    expect(grpOf(d, "Business Expense")).toBe("business");
    d.prepare(`UPDATE categories SET grp = 'need' WHERE name = 'Business Expense'`).run();
    seedDefaultCategories(d, [...DEFAULTS, "Business Expense"], NEEDS, ["Business Expense"]);
    expect(grpOf(d, "Business Expense")).toBe("need");
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
    expect(addCategory(d, { name: "Software", grp: "business" })).toBeGreaterThan(0);
    deleteCategory(d, idOf(d, "Software"));
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

// Business is its own Cash Flow section: counted in Expenses, in neither the
// Needs nor the Wants total.
describe("business group in cashflowView", () => {
  it("totals business apart from needs and wants", () => {
    const d = makeDb();
    const biz = addCategory(d, { name: "Software", grp: "business" });
    const ins = d.prepare(`INSERT INTO transactions (date, name, amount, category_id, txn_class) VALUES (?, ?, ?, ?, 'expense')`);
    ins.run("2026-07-02", "RENT", 1000, idOf(d, "Rent / Housing"));
    ins.run("2026-07-03", "SAFEWAY", 80, idOf(d, "Groceries"));
    ins.run("2026-07-04", "FIGMA", 15, biz);
    const v = cashflowView("2026-07", d);
    expect(v.totalExpenses).toBe(1095);
    expect(v.totalNeeds).toBe(1000);
    expect(v.totalBusiness).toBe(15);
    expect(v.totalWants).toBe(80);
    expect(v.expenses.find((e) => e.label === "Software")?.grp).toBe("business");
  });
});

describe("uncategorizeTxn", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });

  it("files the transaction under Uncategorized and the rule engine leaves it there", () => {
    const groceries = idOf(d, "Groceries");
    d.prepare(`INSERT INTO category_rules (pattern, category_id) VALUES ('safeway', ?)`).run(groceries);
    d.prepare(`INSERT INTO transactions (id, date, name, merchant, amount, category_id, txn_class) VALUES (1, '2026-07-03', 'SAFEWAY', 'Safeway', 80, ?, 'expense')`).run(groceries);
    d.prepare(`INSERT INTO transactions (id, date, name, merchant, amount, txn_class) VALUES (2, '2026-07-05', 'SAFEWAY', 'Safeway', 20, 'expense')`).run();

    uncategorizeTxn(d, 1);
    categorizeTransactions(d);

    const v = cashflowView("2026-07", d);
    // txn 1 stays Uncategorized; txn 2, never touched by the user, still gets its rule
    expect(v.expenses.map((e) => [e.label, e.value])).toEqual([["Uncategorized", 80], ["Groceries", 20]]);
    expect(v.totalExpenses).toBe(100);
  });

  it("turns an income row into an uncategorized expense", () => {
    d.prepare(`INSERT INTO transactions (id, date, name, amount, txn_class) VALUES (1, '2026-07-03', 'REFUND?', 40, 'income')`).run();
    uncategorizeTxn(d, 1);
    expect(cashflowView("2026-07", d).expenses.map((e) => e.label)).toEqual(["Uncategorized"]);
  });

  it("rejects an unknown transaction", () => {
    expect(() => uncategorizeTxn(d, 99)).toThrow(CategoryError);
  });
});

// Editable icons (Alena 2026-11-14). NULL icon = the keyword guess.
describe("category icons", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });
  const iconOf = (name: string) =>
    (d.prepare(`SELECT icon FROM categories WHERE name = ?`).get(name) as { icon: string | null }).icon;

  it("stores a chosen icon, and the Cash Flow row carries it", () => {
    const id = idOf(d, "Groceries");
    setCategoryIcon(d, id, "coffee");
    expect(iconOf("Groceries")).toBe("coffee");
    d.prepare(`INSERT INTO transactions (date, name, amount, category_id, txn_class) VALUES ('2026-07-03', 'SAFEWAY', 80, ?, 'expense')`).run(id);
    expect(cashflowView("2026-07", d).expenses[0].icon).toBe("coffee");
  });

  it("clears back to the keyword guess with null — the row then carries no icon", () => {
    const id = idOf(d, "Groceries");
    setCategoryIcon(d, id, "coffee");
    setCategoryIcon(d, id, null);
    expect(iconOf("Groceries")).toBeNull();
    d.prepare(`INSERT INTO transactions (date, name, amount, category_id, txn_class) VALUES ('2026-07-03', 'SAFEWAY', 80, ?, 'expense')`).run(id);
    expect(cashflowView("2026-07", d).expenses[0]).not.toHaveProperty("icon");
  });

  it("rejects an icon that is not in the list, and an unknown category", () => {
    expect(() => setCategoryIcon(d, idOf(d, "Groceries"), "rocket")).toThrow(CategoryError);
    expect(() => setCategoryIcon(d, idOf(d, "Groceries"), 7)).toThrow(CategoryError);
    expect(() => setCategoryIcon(d, 999, "coffee")).toThrow(CategoryError);
    expect(iconOf("Groceries")).toBeNull();
  });

  it("survives a rename and a restart's default seeding", () => {
    const id = idOf(d, "Insurance");
    setCategoryIcon(d, id, "car");
    renameCategory(d, id, "Car Insurance");
    seedDefaultCategories(d, DEFAULTS, NEEDS);
    expect(iconOf("Car Insurance")).toBe("car");
  });

  // Parity: every default except Business Expense draws the icon it drew
  // before icons were editable.
  it("guesses the long-standing icon for each default category", () => {
    const expected: Record<string, string> = {
      "Rent / Housing": "housing", "Utilities": "utilities", "Phone / Internet": "internet",
      "Insurance": "insurance", "Medical / Health": "health", "Apps / Subs": "apps",
      "Groceries": "groceries", "Eat Out": "dining", "Events / Ent.": "events",
      "Car Mainten.": "repair", "Misc. / Maint / Home": "home", "Pets": "pets",
      "Gifts": "gifts", "Car Gas": "fuel", "Travel / Parking": "travel",
      "Shopping / Personal": "shopping", "Education / Training": "education",
      "Interest Fees / Violations": "fees",
    };
    for (const [name, icon] of Object.entries(expected)) expect([name, guessCategoryIcon(name)]).toEqual([name, icon]);
  });

  it("guesses the icons added with editable icons, without a longer word hijacking them", () => {
    expect(guessCategoryIcon("Business Expense")).toBe("business");
    expect(guessCategoryIcon("Car Payment")).toBe("car");       // was the events ticket: "paymENT"
    expect(guessCategoryIcon("Car Rental")).toBe("car");        // not housing: "RENTal"
    expect(guessCategoryIcon("Coffee")).toBe("coffee");         // not fees: "cofFEE"
    expect(guessCategoryIcon("Coffee Shops")).toBe("coffee");
    expect(guessCategoryIcon("Gym")).toBe("fitness");
    expect(guessCategoryIcon("Kids")).toBe("kids");
    expect(guessCategoryIcon("AUTOMATIC SAVINGS TRANSFER")).toBeNull(); // a savings label, not a car
    expect(guessCategoryIcon("Bank Fees")).toBe("fees");
    expect(guessCategoryIcon("Zzz")).toBeNull();
  });

  it("has a label for every key", () => {
    for (const k of CATEGORY_ICON_KEYS) expect(CATEGORY_ICON_LABELS[k]).toBeTruthy();
    expect(isCategoryIconKey("tag")).toBe(true);
    expect(isCategoryIconKey("uncategorized")).toBe(false);
  });
});

describe("updateCategory", () => {
  let d: Database.Database;
  beforeEach(() => { d = makeDb(); });
  const rowOf = (id: number) =>
    d.prepare(`SELECT name, icon FROM categories WHERE id = ?`).get(id) as { name: string; icon: string | null };

  it("applies a name and an icon together", () => {
    const id = idOf(d, "Groceries");
    updateCategory(d, id, { name: "Food Shop", icon: "coffee" });
    expect(rowOf(id)).toEqual({ name: "Food Shop", icon: "coffee" });
  });

  it("applies an icon alone, and a name alone", () => {
    const id = idOf(d, "Groceries");
    updateCategory(d, id, { icon: "heart" });
    updateCategory(d, id, { name: "Food" });
    expect(rowOf(id)).toEqual({ name: "Food", icon: "heart" });
  });

  it("rolls the rename back when the icon is refused", () => {
    const id = idOf(d, "Groceries");
    expect(() => updateCategory(d, id, { name: "Nope", icon: "rocket" })).toThrow(CategoryError);
    expect(rowOf(id)).toEqual({ name: "Groceries", icon: null });
  });

  it("rolls the icon back when the name is refused, and rejects an empty patch", () => {
    const id = idOf(d, "Groceries");
    expect(() => updateCategory(d, id, { name: "Insurance", icon: "heart" })).toThrow(/already exists/);
    expect(() => updateCategory(d, id, {})).toThrow(/nothing to change/);
    expect(rowOf(id)).toEqual({ name: "Groceries", icon: null });
  });
});
