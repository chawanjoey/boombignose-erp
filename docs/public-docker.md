# Public Docker demo

This deployment runs the Community ERP3D build against its own synthetic Supabase database. Its Cloudflare Quick Tunnel URL is temporary and is intended for a demo, not a stable production endpoint. The host exposes only the gateway and the new Supabase API and database on loopback. The tunnel routes public requests through the gateway; it does not publish Studio, mail, storage, or the database.

The private deployment files live in `.local-stack/` and are ignored by Git and Docker builds. Keep `.local-stack/backend/.env`, `.local-stack/runtime.env`, and `.local-stack/credentials.json` mode 600. The backend uses project `erp3d-public-20261023`, API port 55501, DB port 55502, and Docker network `erp3d-public-backend`. Only the gateway binds port 3105. This local Supabase CLI uses its fixed `postgres` database password, so ports 55501 and 55502 must remain bound to `127.0.0.1`. The JWT signing secret, anon and service keys, and seeded user passwords are unique to this demo.

On this machine, Docker restarts the existing containers with `unless-stopped`. To restore the backend after its containers have been removed, use the Supabase CLI v2.120.0 with this project's private workdir and dedicated loopback network. Do not use `supabase stop --all` or run the CLI from another ERP checkout.

If the backend network is missing, create it with `docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 erp3d-public-backend` before starting Supabase.

```sh
docker network inspect erp3d-public-backend
set -a
. .local-stack/backend/.env
set +a
pnpm exec supabase start --workdir .local-stack/backend --network-id erp3d-public-backend \
  --exclude realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit
```

The first setup applied the repository's 26 migrations and a private copy of the synthetic seed with fresh passwords. Keep its named volume `supabase_db_erp3d-public-20261023`. The backend is not a copy of another ERP database. Once the backend is healthy, build and start the app, gateway, and tunnel:

```sh
docker compose -f compose.public.yaml build app
docker compose -f compose.public.yaml up -d app gateway tunnel
docker compose -f compose.public.yaml ps
docker compose -f compose.public.yaml logs --tail=50 app gateway tunnel
```

For a fresh Quick Tunnel, start `gateway` and `tunnel` first and read the generated `https://*.trycloudflare.com` URL from `docker compose -f compose.public.yaml logs tunnel`. Set `NEXT_PUBLIC_APP_URL` to that origin and `NEXT_PUBLIC_SUPABASE_URL` to that origin plus `/supabase` in the private runtime env. Recreate only the app with `docker compose -f compose.public.yaml up -d --no-deps --force-recreate app`. Browser and server must use the same Supabase URL so their auth cookies match. The server reaches Supabase through the public tunnel. A tunnel restart may change the hostname; update the private env and ask users to sign in again. Keep the tunnel running during ordinary app or gateway restarts.

Check `lsof -nP -iTCP:3105 -iTCP:55501 -iTCP:55502 -sTCP:LISTEN` for loopback bindings. The public login should show a runtime `erp-public-env` script with the public `/supabase` URL. Requests for `/supabase/auth/v1/*` and `/supabase/rest/v1/*` reach only the new backend. Requests for other `/supabase/*` paths return 404. An unauthenticated REST query should contain no ERP rows; the private owner login should show eight deals, four projects, six invoices, and five tasks.
