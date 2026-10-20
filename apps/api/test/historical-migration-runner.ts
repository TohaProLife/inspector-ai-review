/** Run the real migration runner against an immutable historical SQL prefix.
 * Later migrations must not invalidate an earlier migration's rollback boundary.
 * The production runner and canonical-json module are copied without semantic edits;
 * Node's built-in TypeScript stripper only removes types from those copies.
 */
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

type MigrationRunner = typeof import("../src/database-migrations.js").runDatabaseMigrations;

export async function createHistoricalMigrationRunner(lastMigration: string): Promise<{
  runDatabaseMigrations: MigrationRunner;
  migrationNames: string[];
  dispose(): Promise<void>;
}> {
  if (!/^\d{3}_.+\.sql$/.test(lastMigration) || basename(lastMigration) !== lastMigration) {
    throw new Error("Historical migration boundary must be an exact SQL filename");
  }
  const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const available = (await readdir(join(projectRoot, "migrations")))
    .filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
  if (!available.includes(lastMigration)) throw new Error(`Unknown migration boundary: ${lastMigration}`);
  const migrationNames = available.filter(name => name <= lastMigration);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "inspector-historical-migrations-"));
  const dispose = async () => {
    const localPath = relative(resolve(tmpdir()), resolve(temporaryRoot));
    if (localPath.startsWith(`..${sep}`) || localPath === ".." || dirname(localPath) !== "."
        || !basename(localPath).startsWith("inspector-historical-migrations-")) {
      throw new Error("Refusing to remove a path outside the historical migration fixture");
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  };
  try {
    const runnerDirectory = join(temporaryRoot, "apps", "api", "src");
    await mkdir(runnerDirectory, { recursive: true });
    await mkdir(join(temporaryRoot, "migrations"));
    await writeFile(join(temporaryRoot, "package.json"), '{"type":"module"}\n');
    await symlink(join(projectRoot, "node_modules"), join(temporaryRoot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir");
    for (const name of migrationNames) {
      await copyFile(join(projectRoot, "migrations", name), join(temporaryRoot, "migrations", name));
    }
    for (const moduleName of ["database-migrations", "canonical-json"]) {
      const source = await readFile(join(projectRoot, "apps", "api", "src", `${moduleName}.ts`), "utf8");
      await writeFile(join(runnerDirectory, `${moduleName}.js`), stripTypeScriptTypes(source, { mode: "strip" }));
    }
    const runner = await import(/* @vite-ignore */ pathToFileURL(join(runnerDirectory, "database-migrations.js")).href);
    return { runDatabaseMigrations: runner.runDatabaseMigrations as MigrationRunner, migrationNames, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
