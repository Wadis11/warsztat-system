// Minimalne typy środowiska Deno (Supabase Edge Functions), wyłącznie do sprawdzania typów w Node.
declare namespace Deno {
  const env: { get(k: string): string | undefined };
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
}
