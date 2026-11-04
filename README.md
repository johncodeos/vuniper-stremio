<p align="center">
  <img src="https://vuniper.com/icons/icon-192x192.png" alt="Vuniper logo" width="88" height="88">
</p>

<h1 align="center">Vuniper for Stremio</h1>

<p align="center">
  New movies, hidden gems, upcoming streaming releases, and returning TV seasons.<br>
  Four catalogs, right inside Stremio.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white" alt="Node.js 22 or newer">
  <img src="https://img.shields.io/badge/Stremio-Catalog_Add--on-8e5ee8" alt="Stremio catalog add-on">
  <img src="https://img.shields.io/badge/Catalogs-4-a855f7" alt="Four catalogs">
</p>

<p align="center">
  <a href="#catalogs">Catalogs</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#install-in-stremio">Installation</a> ·
  <a href="#personalize-your-add-on">Personalization</a> ·
  <a href="#run-locally">Run locally</a> ·
  <a href="#hosting">Hosting</a> ·
  <a href="#development">Development</a>
</p>

An **unofficial Stremio add-on** powered by [Vuniper](https://vuniper.com). Browse the latest releases and upcoming streaming movies from your Board or Discover screen.

Browse all four catalogs without a Vuniper login or API key. You can personalize the add-on with optional metadata providers for richer title previews. Playback comes from your installed streaming add-ons.

## Catalogs

The catalogs appear in this order within Vuniper:

| Catalog | Order | Posters |
| --- | --- | --- |
| **Now Streaming** | Newest streaming release first | Original artwork |
| **Streaming Soon** | Nearest streaming release first | **STREAMING** ribbon with the release date |
| **Hidden Gems** | Newest streaming release first, using Vuniper's selections | Original artwork |
| **New Shows & Seasons** | Most recent show or season start first | Original artwork |

Release dates appear on **Streaming Soon** poster ribbons. Title descriptions show the synopsis. **New Shows & Seasons** sorts by the latest season's start date and opens titles as series in Stremio.

### Catalog freshness

- Hosted catalogs reuse a shared snapshot for five minutes. During a source outage, a saved snapshot can serve requests for up to 24 hours after it was fetched, even after a restart.
- Catalog responses disable caching. Stremio controls when it requests a reload; resuming an already open app can temporarily preserve the existing view.
- Streaming Soon posters include the date in their image URL, so a changed release date produces a new poster URL.
- IMDb IDs preserve compatibility with Cinemeta and other add-ons.

Release dates and catalog membership come from Vuniper and may change.

## Screenshots

Captured in Stremio Web. Titles and dates reflect the catalog at the time of capture.

### Board

Now Streaming appears first, followed by Streaming Soon with its release-date ribbons.

![Vuniper on the Stremio Board, with the first movie catalog above Streaming Soon](docs/screenshots/board.jpg)

<details>
<summary><strong>Explore the Discover views</strong></summary>

### Streaming Soon

Browse upcoming streaming releases with the date visible on each poster.

![Streaming Soon in Stremio Discover, showing streaming release dates on the posters](docs/screenshots/streaming-soon.jpg)

### New Shows & Seasons

Browse new and returning series with their original posters, without date ribbons.

![New Shows and Seasons in Stremio Discover, showing original series posters without ribbons](docs/screenshots/new-shows-seasons.jpg)

</details>

## Install in Stremio

1. Start the add-on using [Run locally](#run-locally) or [Hosting](#hosting). Copy your manifest URL, such as `https://your-addon.example.com/manifest.json`, or generate a personal link from your deployment’s **Configure** page.
2. Open **Add-ons** in Stremio. In [Stremio Web](https://web.stremio.com/#/addons), choose **Add addon**. In the desktop app, use the add-on search field.
3. Paste the manifest URL and complete the installation. Find the catalogs on the **Board** or in **Discover**.

### Updates and catalog order

Reopen or refresh the catalog in Stremio to pick up updated lists and posters. If Stremio keeps an old catalog name or add-on branding, reinstall from your existing manifest URL.

**Now Streaming** is Vuniper's first catalog. To place Vuniper above other providers on the Board, reorder your installed add-ons in Stremio. An unofficial utility such as [Stremio Addon Manager](https://stremio-addon-manager.vercel.app/) can do this, including moving Vuniper above Cinemeta; it requires access to your Stremio account.

With Vuniper first, Now Streaming is the first movie catalog for a fresh Discover selection. A previously selected catalog URL can still preserve another choice. For direct access to a local installation in Stremio Web, bookmark [Now Streaming](https://web.stremio.com/#/discover/http%3A%2F%2F127.0.0.1%3A7000%2Fmanifest.json/movie/movies-now-online).

## Personalize your add-on

Enable persistent settings as described under [Hosting](#hosting), then open `/configure` on your deployment to choose which providers enrich your Stremio previews.

| Provider | What it adds |
| --- | --- |
| **TMDB** | Movie synopses and credits. Use a TMDB Read Access Token. |
| **TheTVDB** | Series synopses and credits. Use a TheTVDB API key and, if your key requires one, a subscriber PIN. |
| **Cinemeta** | IMDb ratings, fallback credits, runtime, and release year. Enable it with the checkbox. |

Use **Test TMDB key** or **Test TheTVDB key** to check credentials before saving. Choose a settings password of at least 12 characters, then select **Generate install link**. Install directly from the result page or copy its manifest URL into Stremio.

To edit your settings, open **Configure** from your installed add-on or use the **Manage settings** link. Your password unlocks the settings page. Saved provider credentials are encrypted on the server and displayed as **Saved**. Leave a saved field blank to keep it, enter a new value to replace it, or select **Remove** to clear it.

Keep your personal install link private. If you need to revoke it, choose **Replace install link** in Configure and install the new link in Stremio. Ordinary settings changes take effect through your existing link.

## Run locally

Requires **Node.js 22 or newer** and npm.

```sh
git clone https://github.com/johncodeos/vuniper-stremio.git
cd vuniper-stremio
npm ci
npm start
```

Install `http://127.0.0.1:7000/manifest.json` in Stremio on the same computer and keep the process running. Use a reachable HTTPS deployment for a TV, phone, or another computer.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface the add-on listens on |
| `PORT` | `7000` | HTTP port |
| `PUBLIC_URL` | Request origin for poster URLs | Public HTTP(S) origin for poster URLs and personalized setup links |
| `STATE_DIRECTORY` | Unset | Private writable directory for catalog snapshots and saved settings |
| `SETTINGS_KEY_FILE` | systemd credential, if present | Path to the binary encryption key required with persistent state |

Use a different local port:

```sh
PORT=7001 npm start
```

The application reads environment variables from the process. It does not automatically load a `.env` file.

## Hosting

Deploy the Node.js process behind **HTTPS** to use the add-on across devices. Set the host-provided port, bind to `0.0.0.0`, and supply your public origin:

```sh
HOST=0.0.0.0 PORT=7000 PUBLIC_URL=https://your-addon.example.com npm start
```

Then install:

```text
https://your-addon.example.com/manifest.json
```

`PUBLIC_URL` must contain the origin only, without a path, query, or credentials. Set it when using an HTTPS reverse proxy so generated poster URLs use the correct public address.

The poster renderer uses [Sharp](https://sharp.pixelplumbing.com/) and an installed sans-serif font. Arial is available on macOS; Linux deployments should provide a font such as **DejaVu Sans**.

GitHub hosts this project's source code. Running the add-on on a public HTTPS host is a separate step.

For personalized setup and persistent catalog snapshots, configure a writable systemd
`StateDirectory=vuniper-stremio` and supply a 32-byte binary key as
`LoadCredential=settings-encryption-key:/path/to/settings-encryption-key`.
Generate it once with `openssl rand -out /path/to/settings-encryption-key 32` in a
root-only directory, then restrict the file to mode `0600`. Keep the key with your
protected backups so you can restore the encrypted settings. Outside systemd, set
`STATE_DIRECTORY` to an existing private directory and `SETTINGS_KEY_FILE` to the key file.

Optional systemd credentials are listed below.

| Credential name | Contents |
| --- | --- |
| `settings-password` | Password for the legacy loopback-only admin page on port 7001 |
| `catalog-proxy` | One authenticated proxy URL per line for Vuniper catalog requests |
| `webshare-api-token` | Webshare API key for fetching replacement proxy endpoints on failure |

Proxy failover applies to Vuniper catalog API requests. A rate-limited proxy cools down according to `Retry-After`, with a five-minute default. If a proxy fails, the add-on tries the other known endpoints. With a Webshare API key, it checks for replacement endpoints on failure at most once every five minutes and keeps the current list if the refresh fails.

Deploy from a specific Git commit in a clean release directory. Run `npm ci` and
`npm test` there, then point the service's `WorkingDirectory` at that release.
Keep the state directory and credentials outside the checkout. Back up both before
deploying a version that migrates settings. Restart the service and check
`/health`, all four catalog URLs, and `/health/catalogs` before retiring the
previous release. Rolling back across the credential encryption migration
requires restoring the matching pre-migration settings backup.

## Development

```sh
npm run dev        # Restart automatically when source files change
npm test           # Run the offline test suite
npm run check:live # Check the real feeds, ordering, pagination, posters, and logo
```

The offline tests cover catalog order and pagination, snapshot recovery, proxy failover, poster rendering, metadata fallbacks, and personal settings and install links. The live check requires internet access and contacts Vuniper and the poster sources.

```text
src/
  index.js          Process startup and environment configuration
  server.js         Stremio HTTP endpoints
  catalog.js        Catalog definitions, ordering, and persistent snapshots
  catalog-proxy.js  Proxy failover and Webshare refresh
  accounts.js       Personalized setup and install links
  metadata.js       Optional title preview enrichment
  vuniper.js        Source requests and pagination
  posters.js        Streaming Soon date ribbons and image caching
scripts/
  check-live.js     Live integration checks
test/              Offline tests
```

<details>
<summary><strong>Endpoints and integration details</strong></summary>

### Endpoints

| Path | Purpose |
| --- | --- |
| `/manifest.json` | Add-on identity and catalog definitions |
| `/configure` | Create and manage a personalized installation when persistent settings are enabled |
| `/catalog/movie/movies-now-online.json` | Now Streaming |
| `/catalog/movie/streaming-soon.json` | Streaming Soon |
| `/catalog/movie/hidden-gems.json` | Hidden Gems |
| `/catalog/series/new-shows-seasons.json` | New Shows & Seasons |
| `/poster/v3/{date}/{source-id}.jpg` | Poster with a streaming date ribbon |
| `/health` | Process health without an upstream request |
| `/health/catalogs` | Snapshot timestamps and freshness for each catalog. Returns 503 if any snapshot is stale or unavailable. |

Catalogs return up to 100 entries per page. Append `/skip=100.json`, `/skip=200.json`, and subsequent offsets to the catalog path for additional pages—for example, `/catalog/movie/movies-now-online/skip=100.json`.

### Source behavior

The integration uses Vuniper's internal website API. Now Streaming, Hidden Gems, and New Shows & Seasons start from the same curated initial feeds as the website, then paginate with their original date cursors. Streaming Soon is read in full; the other feeds load the prefix needed for the requested Stremio page.

Movie streaming catalogs use the `web` date. The series catalog uses `last_season_date`. Streaming Soon ribbons display calendar dates. Incomplete records are omitted and counted in the server log, and duplicate IMDb IDs are removed within each catalog.

Source requests have a 20-second overall timeout, a 2.5-second proxy attempt timeout,
and guarded pagination. Persistent deployments share one in-flight refresh per catalog,
reuse a fresh snapshot for five minutes, and serve the last successful snapshot for up
to 24 hours if the source fails. The `X-Catalog-Fetched-At` and `X-Catalog-Stale`
headers report which snapshot was served. A missing or expired snapshot still returns
HTTP 502 during an outage. The snapshots refresh when users request the catalogs.

Rendered posters use a bounded in-memory cache of 128 images for up to six hours. This image cache is separate from catalog freshness. Original posters are used directly for the other three rows. Legacy labeled poster URLs remain supported for cached clients.

</details>

## Attribution and data access

Catalog data and branding come from [Vuniper](https://vuniper.com). Artwork and metadata belong to their respective owners. This project is independent of Vuniper and Stremio.

Vuniper's [terms](https://vuniper.com/terms) restrict automated API access without written consent. Obtain Vuniper's permission before operating this integration. The internal API can change or become unavailable.

Built using the [Stremio add-on protocol](https://stremio.github.io/stremio-addon-sdk/protocol.html), [Sharp](https://sharp.pixelplumbing.com/), and [he](https://github.com/mathiasbynens/he).

---

Created by [**John Codeos**](https://github.com/johncodeos).
