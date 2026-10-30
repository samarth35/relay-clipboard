import { handle } from "@/server/http";
import { getStore } from "@/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
async function route(request: Request, context: Context) {
  const { path = [] } = await context.params;
  return handle(request, path, getStore);
}
export { route as GET, route as POST, route as PUT, route as DELETE };
