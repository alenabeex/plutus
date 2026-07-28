import { describe, it, expect } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";

describe("test harness", () => {
  it("runs an in-memory sqlite db", () => {
    const d = new Database(":memory:");
    d.exec(`CREATE TABLE t (n INTEGER)`);
    d.prepare(`INSERT INTO t (n) VALUES (?)`).run(42);
    expect((d.prepare(`SELECT n FROM t`).get() as { n: number }).n).toBe(42);
    d.close();
  });
});
