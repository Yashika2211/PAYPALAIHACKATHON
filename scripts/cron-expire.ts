import { sql } from "../lib/db/client";
import { expireAndRelease } from "../lib/maintenance";

// Scheduled job: Render cron (paid plans) or `pnpm cron:expire`. On the free plan the
// web service runs the same sweep in-process (instrumentation.ts).
expireAndRelease()
  .then((r) => console.log(`expired ${r.expiredMandates} mandate(s); released ${r.released}/${r.staleHolds} stale hold(s); retried ${r.payoutsRetried} payout(s)`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
