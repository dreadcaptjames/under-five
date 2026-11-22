const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";

let runtimePromise;

function runtime() {
    if (!runtimePromise) {
        runtimePromise = (async () => {
            importScripts(`${PYODIDE_URL}pyodide.js`);
            const [python, source] = await Promise.all([
                loadPyodide({indexURL: PYODIDE_URL}),
                fetch("/assets/ranking.py"),
            ]);
            if (!source.ok) throw new Error("Ranking source unavailable");
            python.runPython(await source.text());
            return python;
        })().catch((error) => {
            runtimePromise = undefined;
            throw error;
        });
    }
    return runtimePromise;
}

self.addEventListener("message", async ({data}) => {
    const {id, payload} = data;
    let python;
    try {
        python = await runtime();
    } catch {
        self.postMessage({id, error: "Could not start Python in this browser. Run the scan again to retry."});
        return;
    }

    let rank;
    try {
        rank = python.globals.get("rank_for_web");
        const candidates = JSON.parse(rank(payload));
        if (!Array.isArray(candidates)) throw new Error("Unexpected ranking response");
        self.postMessage({id, candidates});
    } catch (error) {
        console.error("UnderFive ranking failed", error);
        self.postMessage({id, error: "The Python stock ranker could not process the market data."});
    } finally {
        rank?.destroy?.();
    }
});
