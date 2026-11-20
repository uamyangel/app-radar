import { createDb } from "@app-radar/shared/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("缺少环境变量 DATABASE_URL");
const { db, client } = createDb(url, { max: 1 });
await migrate(db, { migrationsFolder: "drizzle" });
await client.end();
console.log("迁移完成");
