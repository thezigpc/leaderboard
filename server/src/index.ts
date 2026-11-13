import { createServer } from "node:http";
import { log } from "@bargames/gamekit/server";
import { DEFAULT_NAME } from "@leaderboard/shared";
import { createApp } from "./app.js";
import { makeBarGames } from "./bargames.js";
import { ADMIN_PASSWORD, CLIENT_DIST_PATH, DATA_DIR, GAME_NAME, PORT } from "./config.js";

const bg = makeBarGames({ defaultName: GAME_NAME || DEFAULT_NAME });
const lb = await createApp({
  dataDir: DATA_DIR,
  bg,
  adminPassword: ADMIN_PASSWORD,
  gameName: GAME_NAME,
  clientDist: CLIENT_DIST_PATH,
});

const server = createServer(lb.app);
lb.attach(server);
server.listen(PORT, () => log.info("boot", "listening", { port: PORT, dataDir: DATA_DIR, box: bg.connected }));

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("boot", "shutting down", { signal });
  void lb
    .close()
    .then(() => bg.flush())
    .finally(() => {
      server.close(() => process.exit(0));
      // TVs hold connections open; don't wait on them.
      setTimeout(() => process.exit(0), 1500).unref();
    });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
