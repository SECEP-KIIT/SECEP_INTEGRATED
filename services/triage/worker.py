"""M3 triage worker: emails.ingested -> student model -> triage_results -> emails.triaged.

Run from services/triage (model_v1 is resolved relative to cwd):
    $env:DATABASE_URL="postgres://..."; $env:REDIS_URL="redis://localhost:6379/0"
    .\\.venv\\Scripts\\python.exe worker.py
Feeds classify() subject + body_text (not emails.ml_text) so serving uses the training text recipe.
Never logs email content.
"""
import json
import logging
import os
import socket
import time

import psycopg
import redis

from secep_ml import triage

IN_STREAM, OUT_STREAM, DLQ = "emails.ingested", "emails.triaged", "emails.dlq"
GROUP = "triage"
CONSUMER = f"triage-{socket.gethostname()}-{os.getpid()}"

log = logging.getLogger("triage.worker")

UPSERT = """
INSERT INTO triage_results (email_id, email_type, type_conf, type_source, urgency, urgency_conf,
  sentiment, sentiment_score, sentiment_conf, needs_review, model_version, processed_at)
VALUES (%(email_id)s, %(email_type)s, %(type_conf)s, %(type_source)s, %(urgency)s, %(urgency_conf)s,
  %(sentiment)s, %(sentiment_score)s, %(sentiment_conf)s, %(needs_review)s, %(model_version)s, %(processed_at)s)
ON CONFLICT (email_id) DO UPDATE SET
  email_type = EXCLUDED.email_type, type_conf = EXCLUDED.type_conf, type_source = EXCLUDED.type_source,
  urgency = EXCLUDED.urgency, urgency_conf = EXCLUDED.urgency_conf, sentiment = EXCLUDED.sentiment,
  sentiment_score = EXCLUDED.sentiment_score, sentiment_conf = EXCLUDED.sentiment_conf,
  needs_review = EXCLUDED.needs_review, model_version = EXCLUDED.model_version,
  processed_at = EXCLUDED.processed_at
"""


def ensure_group(r: redis.Redis) -> None:
    try:
        r.xgroup_create(IN_STREAM, GROUP, id="0", mkstream=True)
    except redis.ResponseError as e:
        if "BUSYGROUP" not in str(e):
            raise


def row_for(t: triage.Triage, conn: psycopg.Connection, env: dict) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT e.subject, e.body_text, e.recipient_position, u.role_category
               FROM emails e JOIN mailboxes m ON m.id = e.mailbox_id JOIN users u ON u.id = m.user_id
               WHERE e.id = %s""",
            (env["email_id"],),
        )
        rec = cur.fetchone()
    if rec is None:
        return None
    subject, body, position, role = rec
    out = triage.to_triage_v1(
        t.classify({"subject": subject or "", "body": body or ""}, role or "Other", position or "to",
                   email_id=env["email_id"])
    )
    return {
        "email_id": out["email_id"],
        "email_type": out["email_type"]["label"],
        "type_conf": round(out["email_type"]["confidence"], 4),
        "type_source": out["email_type"]["source"],
        "urgency": out["urgency"]["label"],
        "urgency_conf": round(out["urgency"]["confidence"], 4),
        "sentiment": out["sentiment"]["label"],
        "sentiment_score": round(out["sentiment"]["score"], 2),
        "sentiment_conf": round(out["sentiment"]["confidence"], 4),
        "needs_review": out["needs_review"],
        "model_version": out["model_version"],
        "processed_at": out["processed_at"],
    }


def handle(t, conn, r, msg_id, fields) -> None:
    env = json.loads(fields["data"])
    try:
        row = row_for(t, conn, env)
        if row is None:
            raise LookupError("email row not found")
        with conn.transaction():
            conn.execute(UPSERT, row)
            conn.execute("UPDATE emails SET status = 'triaged' WHERE id = %s AND status = 'ingested'",
                         (env["email_id"],))
        r.xadd(OUT_STREAM, {"data": json.dumps({
            "schema": "triaged.v1", "email_id": env["email_id"], "tenant_id": env.get("tenant_id"),
            "mailbox_id": env.get("mailbox_id"), "user_id": env.get("user_id"), "status": "triaged",
            "email_type": row["email_type"], "urgency": row["urgency"], "sentiment": row["sentiment"],
            "needs_review": row["needs_review"], "model_version": row["model_version"],
        })}, maxlen=100_000, approximate=True)
        log.info("triaged email_id=%s type=%s urgency=%s", env["email_id"], row["email_type"], row["urgency"])
    except Exception as e:  # noqa: BLE001 - every failure goes to the DLQ, the loop keeps going
        log.warning("triage failed email_id=%s err=%s", env.get("email_id"), type(e).__name__)
        r.xadd(DLQ, {"data": json.dumps({
            "stage": "triage", "mailbox_id": env.get("mailbox_id"), "provider_message_id": None,
            "email_id": env.get("email_id"), "error": f"{type(e).__name__}: {e}"[:240],
        })})
    r.xack(IN_STREAM, GROUP, msg_id)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    r = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True,
                           socket_timeout=30, health_check_interval=30)
    conn = psycopg.connect(os.environ["DATABASE_URL"], autocommit=True)
    t0 = time.time()
    t = triage.load(os.environ.get("TRIAGE_MODEL_DIR", "model_v1"))
    log.info("model loaded in %.1fs, consumer=%s", time.time() - t0, CONSUMER)
    ensure_group(r)
    while True:
        try:
            # pending (unacked, e.g. after a crash) first, then new messages
            for start in ("0", ">"):
                resp = r.xreadgroup(GROUP, CONSUMER, {IN_STREAM: start}, count=16,
                                    block=None if start == "0" else 2000)
                for _stream, msgs in resp or []:
                    for msg_id, fields in msgs:
                        if fields:
                            handle(t, conn, r, msg_id, fields)
        except (redis.ConnectionError, redis.TimeoutError) as e:
            log.warning("redis unavailable (%s), retrying in 5s", type(e).__name__)
            time.sleep(5)


if __name__ == "__main__":
    main()
