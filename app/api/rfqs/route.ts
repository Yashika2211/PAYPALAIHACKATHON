import { handle } from "@/lib/http";
import { createRfq } from "@/lib/rfqs";

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json()) as { request?: string };
    return createRfq(body.request ?? "");
  });
}
