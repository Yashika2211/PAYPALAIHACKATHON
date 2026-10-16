import { handle } from "@/lib/http";
import { limit } from "@/lib/rate-limit";
import { createRfq } from "@/lib/rfqs";

export async function POST(req: Request) {
  return handle(async () => {
    limit(req, "plan");
    const body = (await req.json()) as { request?: string };
    return createRfq(body.request ?? "");
  });
}
