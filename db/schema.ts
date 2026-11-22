import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const holdings = sqliteTable("holdings", {
    owner_id: text("owner_id").notNull(),
    symbol: text("symbol").notNull(),
    purchased_on: text("purchased_on").notNull(),
    price: text("price"),
}, (table) => [primaryKey({ columns: [table.owner_id, table.symbol] })]);
