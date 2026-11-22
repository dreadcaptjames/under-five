"""Short-term momentum ranking for UnderFive."""

import json
from dataclasses import asdict, dataclass
from datetime import date
from statistics import mean


MIN_DOLLAR_VOLUME = 250_000
MAX_DATA_AGE = 7


@dataclass(frozen=True)
class DailyBar:
    date: date
    close: float
    adjusted_close: float
    volume: int


@dataclass(frozen=True)
class Candidate:
    symbol: str
    price: float
    date: date
    return_5: float
    return_20: float
    avg_dollar_volume: float
    score: float


def rank_candidates(
    histories: dict[str, list[DailyBar]], *, as_of: date
) -> list[Candidate]:
    candidates = []
    for symbol, history in histories.items():
        bars = sorted(history, key=lambda bar: bar.date)
        if len(bars) < 21:
            continue

        latest = bars[-1]
        if not 0 < latest.close < 5 or not 0 <= (as_of - latest.date).days <= MAX_DATA_AGE:
            continue

        recent = bars[-21:]
        if any(bar.adjusted_close <= 0 for bar in recent):
            continue

        return_5 = latest.adjusted_close / bars[-6].adjusted_close - 1
        return_20 = latest.adjusted_close / recent[0].adjusted_close - 1
        average_close = mean(bar.adjusted_close for bar in recent[1:])
        dollar_volume = mean(bar.close * bar.volume for bar in recent[1:])
        if not (
            return_5 > 0
            and return_20 > 0
            and latest.adjusted_close > average_close
            and dollar_volume >= MIN_DOLLAR_VOLUME
        ):
            continue

        candidates.append(Candidate(
            symbol, latest.close, latest.date, return_5, return_20, dollar_volume,
            0.6 * return_5 + 0.4 * return_20,
        ))
    return sorted(candidates, key=lambda candidate: (-candidate.score, candidate.symbol))


def rank_for_web(payload: str) -> str:
    scan = json.loads(payload)
    histories = {
        symbol: [
            DailyBar(
                date.fromisoformat(bar["date"]),
                bar["close"],
                bar["adjusted_close"],
                bar["volume"],
            )
            for bar in bars
        ]
        for symbol, bars in scan["histories"].items()
    }
    ranked = rank_candidates(histories, as_of=date.fromisoformat(scan["as_of"]))
    result = []
    for candidate in ranked:
        item = asdict(candidate)
        item["date"] = candidate.date.isoformat()
        recent = sorted(histories[candidate.symbol], key=lambda bar: bar.date)[-21:]
        item["trend"] = [bar.adjusted_close for bar in recent]
        result.append(item)
    return json.dumps(result, allow_nan=False)
