"""
backtesting.py

Backtesting & Accuracy module — opt-in service that tracks individual
recommendation decisions over time and computes calm, beginner-friendly
accuracy metrics.

Industry-standard math, plain-English presentation:
  • Hit Rate                → "How often we were right"
  • Risk Protection Rate    → "How often the safety line saved you"
  • Realized R:R            → "Reward per dollar of risk"
  • Calibration             → "Trust score by setup quality bucket"
  • Expectancy              → "Expected return per decision"
  • Equity Curve            → "Simulated $1k journey if you tracked them all"

ZERO changes to existing recommendation_snapshots flow — this module reads
from snapshots but never mutates them. All new state lives in tracked_decisions.
"""

from __future__ import annotations

import math
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional

from .database import db, rows_to_dicts


# ── Color buckets shared with the frontend ────────────────────────────────────
# Green ≥ 75%, Orange 50-74%, Blue/Gray < 50% or insufficient data.

RELIABILITY_GREEN_THRESHOLD  = 75.0
RELIABILITY_ORANGE_THRESHOLD = 50.0
MIN_DECISIONS_FOR_RELIABILITY = 5


def reliability_bucket(rate_pct: Optional[float], sample_size: int) -> str:
    """Return 'green' | 'orange' | 'blue' (early data)."""
    if rate_pct is None or sample_size < MIN_DECISIONS_FOR_RELIABILITY:
        return "blue"
    if rate_pct >= RELIABILITY_GREEN_THRESHOLD:
        return "green"
    if rate_pct >= RELIABILITY_ORANGE_THRESHOLD:
        return "orange"
    return "orange"  # 0-49% still gets orange (solid data, just not great)


def _pct(part: int, whole: int) -> float:
    return round((part / whole) * 100, 1) if whole else 0.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Track a decision ──────────────────────────────────────────────────────────

def track_decision(snapshot_id: int, notes: Optional[str] = None) -> dict:
    """
    Create a tracked_decisions row from an existing recommendation snapshot.
    Idempotent: returns the existing row if this snapshot is already tracked.
    """
    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM tracked_decisions WHERE snapshot_id = ?",
            (snapshot_id,),
        ).fetchone()
        if existing:
            return get_decision(existing["id"])

        snap = conn.execute(
            """
            SELECT id, ticker, current_price, setup_quality, recommended_action,
                   buy_zone_low, buy_zone_high, risk_line,
                   review_target1, review_target2, snapshot_date
            FROM recommendation_snapshots
            WHERE id = ?
            """,
            (snapshot_id,),
        ).fetchone()
        if not snap:
            raise ValueError(f"Snapshot {snapshot_id} not found")

        cursor = conn.execute(
            """
            INSERT INTO tracked_decisions
              (snapshot_id, ticker, entry_price, buy_zone_low, buy_zone_high,
               risk_line, review_target1, review_target2, setup_quality,
               recommended_action, notes, tracked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                snapshot_id,
                snap["ticker"],
                float(snap["current_price"]),
                snap["buy_zone_low"],
                snap["buy_zone_high"],
                snap["risk_line"],
                snap["review_target1"],
                snap["review_target2"],
                int(snap["setup_quality"]),
                snap["recommended_action"],
                notes,
                _now_iso(),
            ),
        )
        new_id = cursor.lastrowid

    # Run the evaluator immediately so the freshly tracked decision is up to date
    evaluate_decision(new_id)
    return get_decision(new_id)


# ── Read helpers ──────────────────────────────────────────────────────────────

def get_decision(decision_id: int) -> Optional[dict]:
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM tracked_decisions WHERE id = ?",
            (decision_id,),
        ).fetchone()
    return dict(row) if row else None


def list_decisions(status: Optional[str] = None) -> list[dict]:
    """List all tracked decisions, newest first. Optionally filter by status."""
    with db() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM tracked_decisions WHERE status = ? ORDER BY tracked_at DESC",
                (status,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM tracked_decisions ORDER BY tracked_at DESC"
            ).fetchall()
    decisions = rows_to_dicts(rows)

    # Augment each with live evaluator output (buy-zone hit, current return, etc.)
    with db() as conn:
        return [_augment_decision(conn, d) for d in decisions]


def untrack_decision(decision_id: int) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM tracked_decisions WHERE id = ?", (decision_id,))
        return cur.rowcount > 0


def close_decision_manually(
    decision_id: int,
    close_price: float,
    notes: Optional[str] = None,
) -> Optional[dict]:
    decision = get_decision(decision_id)
    if not decision:
        return None
    entry = float(decision["entry_price"])
    realized_return = round(((close_price - entry) / entry) * 100, 2)
    tracked_at = decision["tracked_at"]
    hold_days = _days_between(tracked_at, _now_iso())

    with db() as conn:
        conn.execute(
            """
            UPDATE tracked_decisions
            SET status = 'closed',
                close_reason = 'manual_close',
                close_price = ?,
                closed_at = ?,
                realized_return_pct = ?,
                hold_days = ?,
                notes = COALESCE(?, notes)
            WHERE id = ?
            """,
            (close_price, _now_iso(), realized_return, hold_days, notes, decision_id),
        )
    return get_decision(decision_id)


# ── Price path helpers ────────────────────────────────────────────────────────

def _get_price_path(conn: sqlite3.Connection, ticker: str, since_date: str) -> list[dict]:
    """All OHLC rows for this ticker AFTER (or on) since_date (date-only compare)."""
    rows = conn.execute(
        """
        SELECT p.date, p.open, p.high, p.low, p.close, p.volume
        FROM prices p
        JOIN tickers t ON t.id = p.ticker_id
        WHERE t.symbol = ? AND date(p.date) >= date(?)
        ORDER BY p.date ASC
        """,
        (ticker, since_date),
    ).fetchall()
    return [dict(r) for r in rows]


def _days_between(iso_start: str, iso_end: str) -> int:
    try:
        start = datetime.fromisoformat(iso_start.replace("Z", "+00:00"))
        end   = datetime.fromisoformat(iso_end.replace("Z", "+00:00"))
        return max(0, (end.date() - start.date()).days)
    except Exception:
        return 0


# ── The evaluator: the heart of the module ───────────────────────────────────

def evaluate_decision(decision_id: int) -> Optional[dict]:
    """
    Walk the price history forward from tracked_at and determine:
      • Did the buy zone get hit? When?
      • Did target1 hit? Target2?
      • Did the risk line get breached?
      • What is the current return % vs entry_price?

    Auto-closes the decision when target1 hits OR risk breaks (whichever first).
    Decisions stay 'active' otherwise. Returns the updated decision dict.
    """
    decision = get_decision(decision_id)
    if not decision:
        return None
    if decision["status"] != "active":
        return decision  # already closed; nothing to do

    ticker = decision["ticker"]
    tracked_at = decision["tracked_at"]
    entry = float(decision["entry_price"])

    with db() as conn:
        path = _get_price_path(conn, ticker, tracked_at[:10])

    if not path:
        return decision  # no prices yet — leave as-is

    buy_low  = decision["buy_zone_low"]
    buy_high = decision["buy_zone_high"]
    risk     = decision["risk_line"]
    target1  = decision["review_target1"]
    target2  = decision["review_target2"]

    close_reason: Optional[str] = None
    close_price: Optional[float] = None
    closed_on: Optional[str] = None

    # Earliest-event-wins: walk forward, first risk_breach or target1_hit closes
    for row in path:
        date = row["date"]
        hi   = row["high"]
        lo   = row["low"]

        if risk is not None and lo is not None and lo <= risk:
            close_reason = "risk_breached"
            close_price  = float(risk)  # assume executed at the risk line
            closed_on    = date
            break
        if target1 is not None and hi is not None and hi >= target1:
            # Did target2 also fire on the same bar? If so use target2.
            if target2 is not None and hi >= target2:
                close_reason = "target2_hit"
                close_price  = float(target2)
            else:
                close_reason = "target1_hit"
                close_price  = float(target1)
            closed_on = date
            break

    if close_reason and close_price is not None and closed_on is not None:
        realized = round(((close_price - entry) / entry) * 100, 2)
        hold_days = _days_between(tracked_at, closed_on)
        with db() as conn:
            conn.execute(
                """
                UPDATE tracked_decisions
                SET status = 'closed',
                    close_reason = ?,
                    close_price = ?,
                    closed_at = ?,
                    realized_return_pct = ?,
                    hold_days = ?
                WHERE id = ?
                """,
                (close_reason, close_price, closed_on, realized, hold_days, decision_id),
            )

    return get_decision(decision_id)


def evaluate_all_active() -> int:
    """Run the evaluator on every active decision. Returns count of decisions closed."""
    with db() as conn:
        ids = [r["id"] for r in conn.execute(
            "SELECT id FROM tracked_decisions WHERE status = 'active'"
        ).fetchall()]
    closed_count = 0
    for did in ids:
        before = get_decision(did)
        after  = evaluate_decision(did)
        if before and after and before["status"] == "active" and after["status"] == "closed":
            closed_count += 1
    return closed_count


# ── Augment decisions with live evaluator state for the frontend ──────────────

def _augment_decision(conn: sqlite3.Connection, d: dict) -> dict:
    """Add live state fields: latest_price, current_return_pct, buy_zone_hit, etc."""
    ticker     = d["ticker"]
    tracked_at = d["tracked_at"]
    entry      = float(d["entry_price"])

    path = _get_price_path(conn, ticker, tracked_at[:10])

    latest_close: Optional[float] = None
    buy_zone_hit_date: Optional[str] = None
    target1_hit_date: Optional[str] = None
    target2_hit_date: Optional[str] = None
    risk_breached_date: Optional[str] = None
    max_high_to_date: Optional[float] = None
    min_low_to_date:  Optional[float] = None

    buy_low  = d.get("buy_zone_low")
    buy_high = d.get("buy_zone_high")
    risk     = d.get("risk_line")
    t1       = d.get("review_target1")
    t2       = d.get("review_target2")

    for row in path:
        hi, lo, cl = row.get("high"), row.get("low"), row.get("close")
        if cl is not None:
            latest_close = cl
        if hi is not None:
            max_high_to_date = hi if max_high_to_date is None else max(max_high_to_date, hi)
        if lo is not None:
            min_low_to_date  = lo if min_low_to_date  is None else min(min_low_to_date,  lo)
        if buy_zone_hit_date is None and buy_low is not None and buy_high is not None:
            if (lo is not None and lo <= buy_high) and (hi is not None and hi >= buy_low):
                buy_zone_hit_date = row["date"]
        if t1 is not None and target1_hit_date is None and hi is not None and hi >= t1:
            target1_hit_date = row["date"]
        if t2 is not None and target2_hit_date is None and hi is not None and hi >= t2:
            target2_hit_date = row["date"]
        if risk is not None and risk_breached_date is None and lo is not None and lo <= risk:
            risk_breached_date = row["date"]

    current_return_pct = None
    if latest_close is not None and entry > 0:
        current_return_pct = round(((latest_close - entry) / entry) * 100, 2)

    # Days since tracked
    days_since = _days_between(tracked_at, _now_iso())

    return {
        **d,
        "latest_close":         latest_close,
        "current_return_pct":   current_return_pct,
        "days_since_tracked":   days_since,
        "buy_zone_hit_date":    buy_zone_hit_date,
        "target1_hit_date":     target1_hit_date,
        "target2_hit_date":     target2_hit_date,
        "risk_breached_date":   risk_breached_date,
        "max_high_to_date":     max_high_to_date,
        "min_low_to_date":      min_low_to_date,
    }


# ── Decision detail (for the per-decision chart page) ─────────────────────────

def get_decision_detail(decision_id: int) -> Optional[dict]:
    """Return full decision + daily OHLC path since tracked_at + signal context."""
    decision = get_decision(decision_id)
    if not decision:
        return None

    with db() as conn:
        augmented = _augment_decision(conn, decision)
        path = _get_price_path(conn, decision["ticker"], decision["tracked_at"][:10])

        # Grab the snapshot's signal summary so the detail page can show
        # the original "why was this recommended" context.
        snap_row = conn.execute(
            "SELECT signal_summary, full_signals, snapshot_date FROM recommendation_snapshots WHERE id = ?",
            (decision["snapshot_id"],),
        ).fetchone()

    snapshot_context: dict[str, Any] = {}
    if snap_row:
        import json
        try:
            snapshot_context["signal_summary"] = json.loads(snap_row["signal_summary"] or "{}")
        except Exception:
            snapshot_context["signal_summary"] = {}
        snapshot_context["snapshot_date"] = snap_row["snapshot_date"]

    return {
        "decision": augmented,
        "price_path": [
            {
                "date":   row["date"],
                "open":   row["open"],
                "high":   row["high"],
                "low":    row["low"],
                "close":  row["close"],
                "volume": row["volume"],
            }
            for row in path
        ],
        "snapshot_context": snapshot_context,
    }


# ── Aggregate dashboard metrics ───────────────────────────────────────────────

def get_dashboard_metrics() -> dict:
    """
    The hero numbers shown on the Backtesting tab. Everything is computed from
    live evaluator output so this stays consistent with the per-decision pages.

    Industry-standard formulas:
      • win_rate          = wins / closed
      • avg_win, avg_loss = mean of positive / negative realized returns
      • realized_rr       = avg_win / abs(avg_loss)   (reward-to-risk)
      • expectancy        = win_rate * avg_win - loss_rate * abs(avg_loss)
      • risk_protection   = closed with target1_hit / (target1_hit + risk_breached)
    """
    # First make sure all active decisions reflect the latest prices
    evaluate_all_active()

    decisions = list_decisions()
    total = len(decisions)

    active  = [d for d in decisions if d["status"] == "active"]
    closed  = [d for d in decisions if d["status"] == "closed"]

    # ── Hit rate: did target1 hit for closed decisions? ───────────────────────
    target_hits = [d for d in closed if d["close_reason"] in ("target1_hit", "target2_hit")]
    risk_breaks = [d for d in closed if d["close_reason"] == "risk_breached"]
    target_vs_risk_total = len(target_hits) + len(risk_breaks)
    hit_rate = _pct(len(target_hits), target_vs_risk_total) if target_vs_risk_total else None

    # ── Buy-zone hit rate across all decisions (active + closed) ──────────────
    bz_eligible = [d for d in decisions if d.get("buy_zone_low") is not None and d.get("buy_zone_high") is not None]
    bz_hits = [d for d in bz_eligible if d.get("buy_zone_hit_date")]
    buy_zone_hit_rate = _pct(len(bz_hits), len(bz_eligible)) if bz_eligible else None

    # ── Risk protection: how often closes were target rather than risk ────────
    risk_protection_rate = hit_rate  # alias — same denominator

    # ── Win rate (any positive realized return) ───────────────────────────────
    realized = [float(d["realized_return_pct"]) for d in closed if d.get("realized_return_pct") is not None]
    wins   = [r for r in realized if r > 0]
    losses = [r for r in realized if r <= 0]
    win_rate = _pct(len(wins), len(realized)) if realized else None

    avg_win  = round(sum(wins) / len(wins), 2)     if wins   else 0.0
    avg_loss = round(sum(losses) / len(losses), 2) if losses else 0.0
    avg_return = round(sum(realized) / len(realized), 2) if realized else 0.0

    realized_rr = round(avg_win / abs(avg_loss), 2) if avg_loss < 0 else None

    expectancy = None
    if win_rate is not None and realized:
        loss_rate = 1 - (win_rate / 100)
        expectancy = round((win_rate / 100) * avg_win + loss_rate * avg_loss, 2)

    # ── Best ticker (most reliable by win rate, min 3 closed) ─────────────────
    per_ticker: dict[str, dict] = {}
    for d in closed:
        sym = d["ticker"]
        per_ticker.setdefault(sym, {"closed": 0, "wins": 0, "returns": []})
        per_ticker[sym]["closed"] += 1
        if d.get("realized_return_pct") is not None:
            ret = float(d["realized_return_pct"])
            per_ticker[sym]["returns"].append(ret)
            if ret > 0:
                per_ticker[sym]["wins"] += 1
    per_ticker_list: list[dict] = []
    for sym, stats in per_ticker.items():
        n = stats["closed"]
        if n < 1:
            continue
        wr = _pct(stats["wins"], n)
        avg = round(sum(stats["returns"]) / len(stats["returns"]), 2) if stats["returns"] else 0.0
        per_ticker_list.append({
            "ticker":   sym,
            "closed":   n,
            "winRate":  wr,
            "avgReturn": avg,
            "reliability": reliability_bucket(wr, n),
        })
    per_ticker_list.sort(key=lambda r: (r["winRate"], r["closed"]), reverse=True)

    return {
        "totalTracked":         total,
        "active":               len(active),
        "closed":               len(closed),
        "hitRate":              hit_rate,
        "hitRateReliability":   reliability_bucket(hit_rate, target_vs_risk_total),
        "buyZoneHitRate":       buy_zone_hit_rate,
        "buyZoneReliability":   reliability_bucket(buy_zone_hit_rate, len(bz_eligible)),
        "riskProtectionRate":   risk_protection_rate,
        "winRate":              win_rate,
        "winRateReliability":   reliability_bucket(win_rate, len(realized)),
        "avgWin":               avg_win,
        "avgLoss":              avg_loss,
        "avgReturn":            avg_return,
        "realizedRR":           realized_rr,
        "expectancy":           expectancy,
        "targetHits":           len(target_hits),
        "riskBreaches":         len(risk_breaks),
        "perTicker":            per_ticker_list,
    }


# ── Calibration curve ─────────────────────────────────────────────────────────

def get_calibration_curve() -> dict:
    """
    Bucket all closed decisions by their original setup_quality score, then
    show the realized win rate per bucket. The closer the realized rate is to
    the predicted score, the better-calibrated the engine.
    """
    decisions = list_decisions(status="closed")
    decisions = [d for d in decisions if d.get("realized_return_pct") is not None]

    buckets = [
        ("0–49",  0,  49,  "Low confidence setups"),
        ("50–64", 50, 64,  "Modest setups"),
        ("65–74", 65, 74,  "Solid setups"),
        ("75–84", 75, 84,  "Strong setups"),
        ("85–100",85, 100, "Exceptional setups"),
    ]
    out = []
    for label, lo, hi, description in buckets:
        rows = [d for d in decisions if lo <= int(d.get("setup_quality") or 0) <= hi]
        wins = [d for d in rows if float(d["realized_return_pct"]) > 0]
        n = len(rows)
        wr = _pct(len(wins), n) if n else None
        # The "predicted" success rate is the midpoint of the bucket
        predicted = (lo + hi) / 2
        out.append({
            "bucket":         label,
            "description":    description,
            "predictedRate":  predicted,
            "actualRate":     wr,
            "sampleSize":     n,
            "reliability":    reliability_bucket(wr, n),
        })

    # Overall calibration "score" — how tightly actual tracks predicted
    diffs = [abs((b["actualRate"] or 0) - b["predictedRate"]) for b in out if b["sampleSize"] >= 1]
    avg_drift = round(sum(diffs) / len(diffs), 1) if diffs else None
    calibration_score = round(max(0, 100 - (avg_drift or 0)), 1) if avg_drift is not None else None

    return {
        "buckets":          out,
        "avgDriftPct":      avg_drift,
        "calibrationScore": calibration_score,
        "reliability":      reliability_bucket(calibration_score, sum(b["sampleSize"] for b in out)),
    }


# ── Equity curve ──────────────────────────────────────────────────────────────

def get_equity_curve(starting_capital: float = 1000.0) -> dict:
    """
    Simulate "if you allocated $X to every tracked decision (equal-weight) at
    entry_price and exited at close_price (or current latest_close), what would
    your cumulative $ look like over calendar time?"

    Returns a daily-equity-by-decision-close timeseries. We sort closed decisions
    by closed_at and accumulate. Active decisions contribute mark-to-market at
    the latest known close.
    """
    decisions = list_decisions()
    if not decisions:
        return {
            "points": [{"date": _now_iso()[:10], "equity": starting_capital, "cumReturnPct": 0.0}],
            "startingCapital": starting_capital,
            "finalEquity": starting_capital,
            "totalReturnPct": 0.0,
        }

    closed = [d for d in decisions if d["status"] == "closed" and d.get("realized_return_pct") is not None]
    closed.sort(key=lambda d: d.get("closed_at") or d.get("tracked_at") or "")

    # Equity grows multiplicatively per closed decision treated as an independent
    # round-trip. We pretend each closed decision was a sequential trade.
    equity_points = [{"date": closed[0]["tracked_at"][:10] if closed else _now_iso()[:10],
                       "equity": starting_capital,
                       "cumReturnPct": 0.0}]
    equity = starting_capital
    for d in closed:
        ret = float(d["realized_return_pct"]) / 100.0
        equity = equity * (1 + ret)
        equity_points.append({
            "date": (d.get("closed_at") or d.get("tracked_at") or "")[:10],
            "equity": round(equity, 2),
            "cumReturnPct": round((equity / starting_capital - 1) * 100, 2),
            "ticker": d["ticker"],
            "closeReason": d.get("close_reason"),
            "tradeReturn": round(ret * 100, 2),
        })

    # Mark-to-market for any active decisions at the latest known close
    active = [d for d in decisions if d["status"] == "active" and d.get("current_return_pct") is not None]
    if active:
        active_return = sum(float(d["current_return_pct"]) for d in active) / len(active) / 100.0
        equity_mtm = equity * (1 + active_return * len(active) / max(1, len(active)))  # simple sum
        equity_points.append({
            "date": _now_iso()[:10],
            "equity": round(equity_mtm, 2),
            "cumReturnPct": round((equity_mtm / starting_capital - 1) * 100, 2),
            "mark_to_market": True,
        })

    final_equity = equity_points[-1]["equity"]
    return {
        "points":          equity_points,
        "startingCapital": starting_capital,
        "finalEquity":     final_equity,
        "totalReturnPct":  round((final_equity / starting_capital - 1) * 100, 2),
        "tradeCount":      len(closed),
    }


# ── Plain-English coach lines used on the dashboard ───────────────────────────

def get_coach_insights() -> list[str]:
    """
    Short, beginner-friendly observations the dashboard can render as
    "what this means for you" notes. Always positive in tone, never alarming.
    """
    decisions = list_decisions()
    closed = [d for d in decisions if d["status"] == "closed"]
    metrics = get_dashboard_metrics()
    lines: list[str] = []

    if metrics["totalTracked"] == 0:
        lines.append(
            "You haven't tracked any decisions yet. Click 'Track this Decision' "
            "on any recommendation card to start building your accuracy history."
        )
        return lines

    if metrics["totalTracked"] < MIN_DECISIONS_FOR_RELIABILITY:
        lines.append(
            f"You've tracked {metrics['totalTracked']} decision"
            f"{'s' if metrics['totalTracked'] != 1 else ''} so far. "
            f"Track {MIN_DECISIONS_FOR_RELIABILITY - metrics['totalTracked']} more to unlock reliable accuracy scores."
        )

    if metrics["hitRate"] is not None:
        if metrics["hitRate"] >= 75:
            lines.append(
                f"When the engine flagged a target, it was reached {metrics['hitRate']:.0f}% of the time. "
                "That's a strongly reliable track record."
            )
        elif metrics["hitRate"] >= 50:
            lines.append(
                f"Targets were reached {metrics['hitRate']:.0f}% of the time — solid, "
                "but keep tracking more to refine the signal."
            )

    if metrics["realizedRR"] is not None and metrics["realizedRR"] >= 1.5:
        lines.append(
            f"Your average winning trade returned about {metrics['realizedRR']}× as much "
            "as your average loser — that's a healthy reward-to-risk balance."
        )

    if metrics["expectancy"] is not None and metrics["expectancy"] > 0:
        lines.append(
            f"On average, every tracked decision earns about {metrics['expectancy']:+.2f}% — "
            "the math works in your favour over time."
        )

    if metrics["buyZoneHitRate"] is not None and metrics["buyZoneHitRate"] >= 70:
        lines.append(
            f"Buy zones were reached on {metrics['buyZoneHitRate']:.0f}% of tracked setups — "
            "the engine is good at identifying realistic entry levels."
        )

    if metrics["active"] > 0:
        lines.append(
            f"You currently have {metrics['active']} active decision"
            f"{'s' if metrics['active'] != 1 else ''} still playing out. Check them on the decisions list."
        )

    return lines or ["Keep tracking decisions — patterns will emerge after about 5–10 closed setups."]
