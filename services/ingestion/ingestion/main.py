"""Service entrypoint: poll loop + /health HTTP server on port 8004 (NFR-OPS-002)."""
from __future__ import annotations

import json
import logging
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import psycopg
import redis

from ingestion import __version__
from ingestion.config import Config
from ingestion.crypto import load_master_key
from ingestion.gmail_client import GmailClient
from ingestion.logging_ import configure_logging, log_event
from ingestion.providers.fixtures import FixtureProvider
from ingestion.providers.gmail import GmailProvider
from ingestion.publisher import StreamPublisher
from ingestion.scheduler import IngestionScheduler
from ingestion.store import IngestionStore

logger = logging.getLogger(__name__)


def make_health_handler(store: IngestionStore, publisher: StreamPublisher) -> type[BaseHTTPRequestHandler]:
    class HealthHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != "/health":
                self.send_response(404)
                self.end_headers()
                return
            pg_ok = store.ping()
            redis_ok = publisher.ping()
            healthy = pg_ok and redis_ok
            status_code = 200 if healthy else 503
            body = json.dumps(
                {
                    "status": "ok" if healthy else "degraded",
                    "version": __version__,
                },
                separators=(",", ":"),
            ).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

    return HealthHandler


def main() -> None:
    cfg = Config.from_env()
    configure_logging(cfg.log_level)

    def conn_factory() -> psycopg.Connection[Any]:
        return psycopg.connect(cfg.database_url)

    redis_client = redis.Redis.from_url(cfg.redis_url, decode_responses=True)
    store = IngestionStore(conn_factory)
    publisher = StreamPublisher(redis_client)

    master_key: bytes | None = None
    gmail_client: GmailClient | None = None
    if cfg.ingest_source == "gmail":
        master_key = load_master_key(cfg.master_key_file)
        gmail_client = GmailClient(cfg.google_client_id, cfg.google_client_secret)
        provider: Any = GmailProvider(gmail_client)
    else:
        provider = FixtureProvider(cfg.fixtures_dir)

    scheduler = IngestionScheduler(
        config=cfg,
        store=store,
        publisher=publisher,
        provider=provider,
        master_key=master_key,
        conn_factory=conn_factory,
    )

    server = ThreadingHTTPServer(("0.0.0.0", cfg.health_port), make_health_handler(store, publisher))
    health_thread = threading.Thread(target=server.serve_forever, daemon=True)
    health_thread.start()
    log_event(logger, logging.INFO, "health_server_started", status="listening")

    def _handle_signal(_signum: int, _frame: Any) -> None:
        scheduler.stop()

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    try:
        scheduler.run_forever()
    finally:
        server.shutdown()
        server.server_close()
        if gmail_client is not None:
            gmail_client.close()
        redis_client.close()


if __name__ == "__main__":
    main()
