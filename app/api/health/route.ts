import { connection } from "next/server";
import { sql } from "@/lib/db/client";
import { describeModel } from "@/lib/llm/provider";

export async function GET() {
  await connection();
  let database = "ok";
  try {
    await sql`select 1`;
  } catch {
    database = "down";
  }
  return Response.json(
    { status: database === "ok" ? "ok" : "degraded", database, paypal: process.env.PAYPAL_ENV ?? "sandbox", ai: { fast: describeModel("fast"), smart: describeModel("smart") } },
    { status: database === "ok" ? 200 : 503 },
  );
}
