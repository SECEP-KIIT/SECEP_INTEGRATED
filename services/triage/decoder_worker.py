"""M4 decoder worker: emails.triaged -> Gemini enrichment -> summaries + actions -> emails.enriched.

Runs after the triage write, so student labels show first and enrichment lands later.
Env: DATABASE_URL, REDIS_URL, SECEP_DECODER_BACKEND=gemini, SECEP_DECODER_MODEL=gemini-3.5-flash-lite,
GEMINI_API_KEY (never logged), optional SECEP_DECODER_RPM. Never logs email content.
Run from services/triage:  .\\.venv\\Scripts\\python.exe decoder_worker.py
"""
import json
import logging
import os
import socket
import time

import psycopg
import redis
from psycopg.types.json import Jsonb

from secep_ml import triage
from secep_ml.decoder import Decoder, DecoderConfig

IN_STREAM, OUT_STREAM, DLQ = "emails.triaged", "emails.enriched", "emails.dlq"
GROUP = "decoder"
CONSUMER = f"decoder-{socket.gethostname()}-{os.getpid()}"
ACTION_FIELDS = ("title", "description", "priority", "due_date", "start", "end", "attendees")

log = logging.getLogger("decoder.worker")


def ensure_group(r: redis.Redis) -> None:
    try:
        r.xgroup_create(IN_STREAM, GROUP, id="0", mkstream=True)
    except redis.ResponseError as e:
        if "BUSYGROUP" not in str(e):
            raise


def handle(t, dec, conn, r, msg_id, fields) -> None:
    env = json.loads(fields["data"])
    eid = env.get("email_id")
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT e.subject, e.body_text, e.recipient_position, e.received_at, u.role_category,
                          e.tenant_id, m.user_id
                   FROM emails e JOIN mailboxes m ON m.id = e.mailbox_id JOIN users u ON u.id = m.user_id
                   WHERE e.id = %s""", (eid,))
            rec = cur.fetchone()
        if rec is None:
            raise LookupError("email row not found")
        subject, body, position, received, role, tenant_id, user_id = rec
        email = {"subject": subject or "", "body": body or "",
                 "date": received.date().isoformat() if received else ""}
        role, position = role or "Other", position or "to"
        tri = t.classify(email, role, position, email_id=eid)  # full v1.1 result (probs, flagged heads)
        e = dec.enrich(email, tri, role=role, position=position)
        status, en = e["status"], e.get("enrich") or {}
        with conn.transaction():
            if status == "enriched" and en:
                conn.execute(
                    """INSERT INTO summaries (email_id, one_line, short, model) VALUES (%s, %s, %s, %s)
                       ON CONFLICT (email_id) DO UPDATE SET one_line = EXCLUDED.one_line,
                         short = EXCLUDED.short, model = EXCLUDED.model, created_at = now()""",
                    (eid, en["summary_one_line"][:160], en["summary_short"][:600], dec.backend.model))
                # Re-runs replace only untouched decoder proposals (one set per email).
                conn.execute("DELETE FROM actions WHERE email_id = %s AND origin = 'decoder' AND status = 'proposed'",
                             (eid,))
                for a in (en.get("actions") or [])[:3]:
                    if a.get("type") in (None, "none"):
                        continue
                    conn.execute(
                        """INSERT INTO actions (tenant_id, email_id, user_id, type, payload, origin, status)
                           VALUES (%s, %s, %s, %s, %s, 'decoder', 'proposed')""",
                        (tenant_id, eid, user_id, a["type"], Jsonb({k: a.get(k) for k in ACTION_FIELDS})))
            conn.execute("UPDATE emails SET status = %s WHERE id = %s", (status, eid))
        r.xadd(OUT_STREAM, {"data": json.dumps({
            "schema": "enriched.v1", "email_id": eid, "tenant_id": env.get("tenant_id"),
            "mailbox_id": env.get("mailbox_id"), "user_id": env.get("user_id"), "status": status,
        })}, maxlen=100_000, approximate=True)
        log.info("decoded email_id=%s status=%s", eid, status)
    except Exception as ex:  # noqa: BLE001 - failures go to the DLQ; triage labels stay
        log.warning("decoder failed email_id=%s err=%s", eid, type(ex).__name__)
        r.xadd(DLQ, {"data": json.dumps({"stage": "decoder", "mailbox_id": env.get("mailbox_id"),
                                         "provider_message_id": None, "email_id": eid,
                                         "error": f"{type(ex).__name__}"[:240]})})
        try:
            conn.execute("UPDATE emails SET status = 'enrich_failed' WHERE id = %s", (eid,))
        except Exception:  # noqa: BLE001
            pass
    r.xack(IN_STREAM, GROUP, msg_id)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    r = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True,
                             socket_timeout=30, health_check_interval=30)
    conn = psycopg.connect(os.environ["DATABASE_URL"], autocommit=True)
    t0 = time.time()
    t = triage.load(os.environ.get("TRIAGE_MODEL_DIR", "model_v1"))
    dec = Decoder(DecoderConfig.from_env())
    log.info("ready in %.1fs (model %s), consumer=%s", time.time() - t0, dec.backend.model, CONSUMER)
    ensure_group(r)
    while True:
        try:
            for start in ("0", ">"):
                resp = r.xreadgroup(GROUP, CONSUMER, {IN_STREAM: start}, count=4,
                                    block=None if start == "0" else 2000)
                for _stream, msgs in resp or []:
                    for msg_id, fields in msgs:
                        if fields:
                            handle(t, dec, conn, r, msg_id, fields)
        except (redis.ConnectionError, redis.TimeoutError) as e:
            log.warning("redis unavailable (%s), retrying in 5s", type(e).__name__)
            time.sleep(5)


if __name__ == "__main__":
    main()
