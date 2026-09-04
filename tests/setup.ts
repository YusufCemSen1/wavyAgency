import { sql } from "drizzle-orm";
import { beforeEach } from "vitest";

import { db } from "@/db";

beforeEach(async () => {
  await db.execute(
    sql`truncate table submission_metric, submission, campaign, "user" restart identity cascade`,
  );
});
