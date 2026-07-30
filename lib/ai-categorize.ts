import Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3-multiple-ciphers";
import { db } from "./db";
import { keychainGet } from "./keychain";
import { categorizeTransactions } from "./derive";

// AI categorization fallback (plan §Phase 4, derivation contract).
// Precedence: category_rules (user corrections + defaults) → AI → queue.
//
// The AI never touches transactions directly. It maps MERCHANT STRINGS to
// category names; each mapping is written as a category_rules row, then the
// normal rule engine applies them. That makes every AI decision:
//   - durable (the rule persists, future syncs categorize deterministically)
//   - correctable (the user can edit/delete the rule like any other)
//   - private (merchant names only — no amounts, dates, or balances leave
//     the machine; plan §Decisions privacy rules)
//
// Optional feature: needs an Anthropic API key (env ANTHROPIC_API_KEY or
// Keychain service finance-anthropic-key). Absent key → graceful no-op.
// Self-hosted users bring their own key, same as Plaid.

const MODEL = process.env.FT_AI_MODEL ?? "claude-opus-5";
const BATCH_LIMIT = 50; // merchants per call — keeps output small

export interface AiCategorizeResult {
  skipped: "no-key" | "nothing-to-do" | "refusal" | null;
  merchantsSent: number;
  rulesAdded: number;
  categorized: number;
}

function apiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? keychainGet("finance-anthropic-key");
}

/** Distinct uncategorized expense merchants (settled only). */
function unknownMerchants(d: Database.Database): string[] {
  return (
    d.prepare(
      `SELECT DISTINCT COALESCE(NULLIF(TRIM(merchant), ''), name) who
       FROM transactions
       WHERE category_id IS NULL AND txn_class = 'expense' AND pending = 0
       ORDER BY who LIMIT ?`,
    ).all(BATCH_LIMIT) as { who: string | null }[]
  )
    .map((r) => r.who)
    .filter((w): w is string => !!w);
}

export async function aiCategorize(d: Database.Database = db()): Promise<AiCategorizeResult> {
  const key = apiKey();
  if (!key) return { skipped: "no-key", merchantsSent: 0, rulesAdded: 0, categorized: 0 };

  const merchants = unknownMerchants(d);
  if (merchants.length === 0)
    return { skipped: "nothing-to-do", merchantsSent: 0, rulesAdded: 0, categorized: 0 };

  const cats = d.prepare(`SELECT id, name, grp FROM categories ORDER BY sort ASC`).all() as
    { id: number; name: string; grp: string | null }[];
  const catByName = new Map(cats.map((c) => [c.name, c.id]));

  const client = new Anthropic({ apiKey: key });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system:
      "You categorize personal-finance merchant strings into spending categories. " +
      "Categories marked grp=need are recurring obligations (housing, utilities, insurance, subscriptions); " +
      "grp=want is discretionary. Assign each merchant the single best-fitting category from the list. " +
      "If a merchant is genuinely unrecognizable, omit it rather than guessing.",
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            assignments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  merchant: { type: "string" },
                  category: { type: "string", enum: cats.map((c) => c.name) },
                },
                required: ["merchant", "category"],
                additionalProperties: false,
              },
            },
          },
          required: ["assignments"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          categories: cats.map((c) => ({ name: c.name, grp: c.grp ?? "want" })),
          merchants,
        }),
      },
    ],
  });

  if (response.stop_reason === "refusal")
    return { skipped: "refusal", merchantsSent: merchants.length, rulesAdded: 0, categorized: 0 };

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const parsed = JSON.parse(text) as { assignments?: { merchant: string; category: string }[] };

  const have = new Set(
    (d.prepare(`SELECT pattern FROM category_rules`).all() as { pattern: string }[])
      .map((r) => r.pattern.toLowerCase()),
  );
  const ins = d.prepare(
    `INSERT INTO category_rules (pattern, field, category_id) VALUES (?, 'merchant', ?)`,
  );

  let rulesAdded = 0;
  for (const a of parsed.assignments ?? []) {
    const catId = catByName.get(a.category);
    const pattern = a.merchant.trim().toLowerCase();
    // only write rules for merchants we actually asked about — the pattern
    // must come from OUR list, never invented by the model
    if (!catId || !pattern || have.has(pattern)) continue;
    if (!merchants.some((m) => m.trim().toLowerCase() === pattern)) continue;
    ins.run(pattern, catId);
    have.add(pattern);
    rulesAdded++;
  }

  // the new rules apply through the normal engine — same path as manual rules
  const categorized = rulesAdded > 0 ? categorizeTransactions(d) : 0;
  return { skipped: null, merchantsSent: merchants.length, rulesAdded, categorized };
}
