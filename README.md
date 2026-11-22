# under-five

UnderFive screens U.S.-listed stocks under $5 and tracks one share per ticker. Python ranks the results in a browser worker through Pyodide. The wallet saves holdings in the browser. [Open UnderFive](https://dreadcaptjames.github.io/under-five/)

## GitHub Pages

Pages serves the root `index.html` and the `frontend/` directory from `main`. The `data-market-origin` attribute on the root page points to the market-data API. Wallet records live in browser storage.

To build the market-data Worker with Node.js 18 or newer:

```sh
npm ci
npm run build:market
```

The output is `dist/market/server/index.js`. The API allows cross-origin browser requests from `https://dreadcaptjames.github.io`.

## Private dashboard build

`npm run build` packages the account-based dashboard and wallet migration for a private ChatGPT Sites deployment. Its `DB` binding stores holdings and the Sites gateway supplies the authenticated user ID. Configure that deployment's `project_id` in `.openai/hosting.json`.
