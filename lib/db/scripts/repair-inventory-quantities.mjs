import pg from "pg";

const { Pool } = pg;
const CONFIRMATION = "repair_inventory_quantities_v1";

if (process.env.DB_REPAIR_CONFIRM !== CONFIRMATION) {
  throw new Error(
    `Refusing to repair inventory quantities. Set DB_REPAIR_CONFIRM=${CONFIRMATION} explicitly.`,
  );
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running a repair script.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('oxygen_gym_inventory_quantity_repair_v1'))");

  const result = await client.query(`
    WITH computed AS (
      SELECT p.id,
        COALESCE((SELECT SUM(sp.quantity_added) FROM stock_purchases sp WHERE sp.product_id = p.id), 0) AS purchased,
        COALESCE((
          SELECT SUM((item->>'quantity')::int)
          FROM sales s, jsonb_array_elements(s.items) AS item
          WHERE (item->>'productId')::int = p.id AND s.status = 'completed'
        ), 0) AS sold,
        COALESCE((
          SELECT SUM((item->>'quantity')::int)
          FROM sales s, jsonb_array_elements(s.items) AS item
          WHERE (item->>'productId')::int = p.id AND s.status = 'voided'
        ), 0) AS restored
      FROM products p
      WHERE p.status != 'deleted'
    )
    UPDATE products
    SET quantity = c.purchased - c.sold + c.restored
    FROM computed c
    WHERE products.id = c.id
      AND products.quantity IS DISTINCT FROM (c.purchased - c.sold + c.restored)
    RETURNING products.id, products.name, products.quantity
  `);

  await client.query("COMMIT");
  console.log("Inventory quantity repair completed.", {
    productsChanged: result.rowCount ?? 0,
  });
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Inventory quantity repair failed; transaction rolled back.", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
