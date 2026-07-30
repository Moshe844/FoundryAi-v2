type Fetcher = {
  fetch(input: Request): Promise<Response>;
};

// The Cloudflare runtime supplies the concrete binding; vinext forwards it opaquely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type D1Database = any;

declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
  };
}
