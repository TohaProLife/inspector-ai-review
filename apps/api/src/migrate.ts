import { runDatabaseMigrations } from "./database-migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run database migrations");
}

const summary = await runDatabaseMigrations(connectionString, {
  log: (event) => console.log(JSON.stringify({ event: "database.migration", ...event })),
});
console.log(JSON.stringify({ event: "database.migration.complete", ...summary }));
