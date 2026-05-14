import type { CommandModule } from "yargs";
import { getGlobalDataDir } from "../utils/paths.js";

export const dbCommand: CommandModule = {
  command: "db",
  describe: "Database operations",
  builder: (yargs) => yargs
    .command({
      command: "path",
      describe: "Show database path",
      handler: () => {
        const dataDir = getGlobalDataDir();
        console.log(`${dataDir}/spectra.db`);
      },
    })
    .command({
      command: "$0 [query]",
      describe: "Run a SQL query or open interactive shell",
      handler: (argv: Record<string, unknown>) => {
        if (argv.query) {
          console.log(`Running SQL query: ${argv.query}`);
          try {
            const { runQuery } = require("../services/session-store.js");
            const dataDir = getGlobalDataDir();
            const { execSync } = require("child_process");
            const result = execSync(`bun -e "
              const db = new (require('bun:sqlite').Database)('${dataDir}/spectra.db');
              const rows = db.query('${String(argv.query).replace(/'/g, "\\'")}').all();
              console.log(JSON.stringify(rows, null, 2));
            "`, { encoding: "utf-8", timeout: 10000 });
            console.log(result);
          } catch (err: unknown) {
            const error = err as { message?: string };
            console.error(`Query failed: ${error.message}`);
            process.exit(1);
          }
        } else {
          const dataDir = getGlobalDataDir();
          console.log(`Open interactive SQLite shell:
  sqlite3 ${dataDir}/spectra.db`);
        }
      },
    })
    .demandCommand(1, "Please specify a subcommand"),
  handler: () => { },
};
