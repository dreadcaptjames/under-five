# under-five

UnderFive is a private web dashboard that screens U.S.-listed stocks under $5 and records one share per ticker in an account wallet. Python runs the momentum ranking in a browser worker through Pyodide. The server fetches market data and stores holdings in Cloudflare D1.

## Build

With Node.js 18 or newer, run:

```sh
npm ci
npm run build
```

The build bundles the dashboard and its API into a Cloudflare Worker at `dist/server/index.js`. The wallet migration is included in `dist/.openai/drizzle/`.

## Hosting

Set `project_id` in `.openai/hosting.json` for your own ChatGPT Sites project before building for deployment. The app expects the Sites gateway to authenticate users and supply the trusted `oai-authenticated-user-id` header. It uses the `DB` D1 binding for account holdings.
