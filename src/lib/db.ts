import { neon } from '@neondatabase/serverless';

let sql: ReturnType<typeof neon> | null = null;
let initialized = false;

export function getDb() {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not configured');
    }
    sql = neon(url);
  }
  return sql;
}

export async function initDatabase() {
  if (initialized) return { success: true };
  const db = getDb();
  await db`
    CREATE TABLE IF NOT EXISTS parse_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      config JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      external_code TEXT DEFAULT '',
      store_name TEXT DEFAULT '',
      recipient_name TEXT DEFAULT '',
      recipient_phone TEXT DEFAULT '',
      recipient_address TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      sku_name TEXT NOT NULL,
      sku_quantity INTEGER NOT NULL,
      sku_spec TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Indexes
  await db`CREATE INDEX IF NOT EXISTS idx_orders_batch ON orders(batch_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_orders_external ON orders(external_code)`;
  await db`CREATE INDEX IF NOT EXISTS idx_orders_recipient ON orders(recipient_name)`;
  await db`CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)`;

  initialized = true;
  return { success: true };
}

async function ensureInit() {
  try {
    await initDatabase();
  } catch {
    // Silently fail if DB not available yet
  }
}

export const db = {
  // Rules CRUD
  async getAllRules() {
    await ensureInit();
    const db = getDb();
    const rows = await db`SELECT * FROM parse_rules ORDER BY updated_at DESC`;
    return rows.map(r => ({ ...r, config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config }));
  },

  async getRule(id: string) {
    await ensureInit();
    const db = getDb();
    const rows = await db`SELECT * FROM parse_rules WHERE id = ${id}`;
    if (rows.length === 0) return null;
    const r = rows[0];
    return { ...r, config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config };
  },

  async createRule(id: string, name: string, description: string, config: any) {
    await ensureInit();
    const db = getDb();
    await db`
      INSERT INTO parse_rules (id, name, description, config)
      VALUES (${id}, ${name}, ${description}, ${JSON.stringify(config)})
    `;
    return this.getRule(id);
  },

  async updateRule(id: string, name: string, description: string, config: any) {
    await ensureInit();
    const db = getDb();
    await db`
      UPDATE parse_rules SET name=${name}, description=${description}, config=${JSON.stringify(config)}, updated_at=NOW()
      WHERE id=${id}
    `;
    return this.getRule(id);
  },

  async deleteRule(id: string) {
    await ensureInit();
    const db = getDb();
    await db`DELETE FROM parse_rules WHERE id=${id}`;
  },

  // Orders
  async insertOrders(orders: any[]) {
    await ensureInit();
    const db = getDb();
    const results = [];
    for (const o of orders) {
      try {
        await db`
          INSERT INTO orders (id, batch_id, external_code, store_name, recipient_name, recipient_phone, recipient_address, sku_code, sku_name, sku_quantity, sku_spec, remark)
          VALUES (${o.id}, ${o.batchId}, ${o.externalCode}, ${o.storeName}, ${o.recipientName}, ${o.recipientPhone}, ${o.recipientAddress}, ${o.skuCode}, ${o.skuName}, ${o.skuQuantity}, ${o.skuSpec}, ${o.remark})
        `;
        results.push({ success: true, id: o.id });
      } catch (err: any) {
        results.push({ success: false, id: o.id, error: err.message });
      }
    }
    return results;
  },

  async getOrders(params: { page?: number; pageSize?: number; externalCode?: string; recipientName?: string; dateFrom?: string }) {
    await ensureInit();
    const db = getDb();
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const offset = (page - 1) * pageSize;

    const [rows, countResult] = await Promise.all([
      db`SELECT * FROM orders ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      db`SELECT COUNT(*) as total FROM orders`,
    ]);

    return {
      data: rows,
      total: Number(countResult[0]?.total || 0),
      page,
      pageSize,
      totalPages: Math.ceil(Number(countResult[0]?.total || 0) / pageSize),
    };
  },

  async checkDuplicateExternalCodes(codes: string[]) {
    if (codes.length === 0) return [];
    await ensureInit();
    const db = getDb();
    const rows = await db`SELECT external_code FROM orders WHERE external_code = ANY(${codes})`;
    return rows.map(r => r.external_code);
  },
};
