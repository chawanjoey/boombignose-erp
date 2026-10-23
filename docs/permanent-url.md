# Give the Docker ERP a permanent hostname

Use this overlay with the existing `erp3d-public` Docker deployment. It adds a remotely managed Cloudflare named tunnel beside the current Quick Tunnel. It does not rebuild the app or replace the database.

## Current deployment

The Mac-hosted demo uses [erp.chawan.ai](https://erp.chawan.ai/erp-3d). Its Cloudflare tunnel is named `erp3d-public` and routes to `http://gateway:80`. The previous Quick Tunnel is stopped. The hostname remains assigned across connector restarts, while availability still depends on this Mac, Docker, and its internet connection.

On 23 October 2026, HTTPS sign-in loaded 23 ERP records and 11 saved relationships. Selecting a project mesh opened its stored details. Restarting only the named tunnel preserved both the hostname and the browser session. Anonymous project reads returned no rows, and private backend paths remained unavailable. This is an isolated synthetic demo, not a production readiness certification.

The runtime uses `NEXT_PUBLIC_APP_URL=https://erp.chawan.ai` and `NEXT_PUBLIC_SUPABASE_URL=https://erp.chawan.ai/supabase`. The demo Auth site URL is `https://erp.chawan.ai`, with redirects limited to `https://erp.chawan.ai/**`. Global signup stays disabled and email/password sign-in stays enabled. SMTP, storage, and external integrations remain outside this deployment.

## Prepare the route

1. Sign in to Cloudflare and select a domain whose DNS you manage.
2. Create a remotely managed tunnel named `erp3d-public`.
3. Add an unused public hostname under that domain. Set its service to `http://gateway:80`.
4. Save only `TUNNEL_TOKEN=<the connector token>` in `.local-stack/named-tunnel.env` in the existing deployment directory. Set the directory to mode 700 and the file to mode 600. Keep the token out of Git, screenshots, shell history, and chat. Docker administrators can inspect container environment variables.

The hostname stays assigned when its connector restarts. The Mac, Docker, and internet connection must remain available. Do not add a Cloudflare Access challenge without adapting server requests, because the app also reaches Supabase through this public hostname.

## Start the second tunnel

Run these commands from the existing deployment directory that contains `.local-stack/runtime.env`. Set `ERP3D_NAMED_OVERLAY` to the absolute path of `compose.named-tunnel.yaml` from this worktree. Compose resolves private file paths relative to the first Compose file.

```sh
docker compose -f compose.public.yaml -f "$ERP3D_NAMED_OVERLAY" config --quiet
docker compose -f compose.public.yaml -f "$ERP3D_NAMED_OVERLAY" up -d --no-deps tunnel-named
docker compose -f compose.public.yaml -f "$ERP3D_NAMED_OVERLAY" ps tunnel-named
```

Wait until the new tunnel is healthy. Verify that `https://<hostname>/healthz` returns 200, and that `/supabase/storage/v1/` returns 404. Keep the Quick Tunnel running until the new hostname passes sign-in checks.

## Change the application origin

1. Make a mode 600 backup of `.local-stack/runtime.env`.
2. Set `NEXT_PUBLIC_APP_URL=https://<hostname>` and `NEXT_PUBLIC_SUPABASE_URL=https://<hostname>/supabase` in that file. Browser and server must use the same Supabase URL.
3. Check the public demo's Auth `site_url` and redirect allowlist. If they contain the old origin, update only that backend's settings. Do not restart another Supabase project.
4. Recreate only the app.

```sh
docker compose -f compose.public.yaml up -d --no-deps --force-recreate app
```

Sign in again at the new hostname. The old hostname's cookies do not transfer. Confirm that `/erp-3d` loads protected records and that clicking a 3D record opens its details. Confirm that browser runtime configuration uses the new `/supabase` URL, anonymous requests cannot read ERP records, and ports 3105, 55501, and 55502 remain on loopback.

Restart only `tunnel-named`, then verify the same HTTPS hostname and protected route again. Update the private access instructions with the verified hostname. After these checks pass, stop only the old Quick Tunnel.

```sh
docker compose -f compose.public.yaml -f "$ERP3D_NAMED_OVERLAY" restart tunnel-named
docker compose -f compose.public.yaml stop tunnel
```

Include both Compose files when managing the named tunnel. Do not use `down`, remove backend volumes, or stop all Supabase projects.

## Return to the previous hostname

Before stopping the old Quick Tunnel, restore the private runtime backup and recreate only the app. Stop only `tunnel-named` if necessary. Leave DNS and the named tunnel intact while diagnosing the failure.

If the old Quick Tunnel has already stopped, restarting it may issue a different URL. Read its current URL, update both runtime origins to match it, and recreate only the app. Preserve `supabase_db_erp3d-public-20261023` throughout recovery.
