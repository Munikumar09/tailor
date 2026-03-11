"""
utils/logger.py
===============
Singleton queue-based logging service.

Every module gets a logger via:

    from utils.logger import get_logger
    logger = get_logger(__name__)

Architecture
------------
Importing this module (or calling get_logger for the first time) initialises
the service exactly once, regardless of how many modules import it:

    Caller thread        QueueHandler          Background thread
    ─────────────        ────────────          ─────────────────
    logger.info(msg) ──▶ enqueue record ──▶  QueueListener
                                                 ├─ RotatingFileHandler ──▶ logs/YYYY-MM-DD.log
                                                 └─ StreamHandler       ──▶ stdout

The queue is unbounded so the calling thread is never blocked by file I/O.

Log format (same for both handlers)
------------------------------------
    2026-03-04 10:30:45 [INFO    ] nodes.py:87 — Gap analysis complete

File rotation
-------------
    • Rotates at midnight every day (regardless of file size)
    • Keeps up to 30 daily backup files
    • Backup files are suffixed with the date:  app.log.2026-03-04
    • The active file is always  logs/app.log
"""

import atexit
import logging
import logging.handlers
import queue
import sys

from pathlib import Path
from threading import Lock

# ── Paths ─────────────────────────────────────────────────────────────────────
# Resolves to  backend/logs/  regardless of the process working directory.
_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"

# ── Log record format ─────────────────────────────────────────────────────────
# Columns: Date+Time  Level(padded)  FileName:LineNo  Message
_FORMAT = "%(asctime)s [%(levelname)-8s] %(filename)s:%(lineno)d — %(message)s"
_DATE_FMT = "%Y-%m-%d %H:%M:%S"

# ── Noisy third-party loggers to silence ──────────────────────────────────────
_QUIET: list[tuple[str, int]] = [
    ("httpx",                       logging.WARNING),
    ("httpcore",                    logging.WARNING),
    ("transformers",                logging.ERROR),
    ("transformers.modeling_utils", logging.ERROR),
    ("sentence_transformers",       logging.WARNING),
    ("urllib3",                     logging.WARNING),
    ("filelock",                    logging.WARNING),
    ("langchain",                   logging.WARNING),
    ("langchain_core",              logging.WARNING),
    ("langchain_google_genai",      logging.WARNING),
    ("langchain_groq",              logging.WARNING),
    ("google.api_core",             logging.WARNING),
    ("multipart",                   logging.WARNING),
]


class _LoggingService:
    """
    Thread-safe singleton.  Initialised exactly once across the entire process.
    """

    _instance: "_LoggingService | None" = None
    _lock: Lock = Lock()

    def __new__(cls) -> "_LoggingService":
        with cls._lock:
            if cls._instance is None:
                obj = super().__new__(cls)
                obj._ready = False
                cls._instance = obj
        return cls._instance

    def _init(self) -> None:
        """Wire the root logger to a queue-backed file + console handler pair."""
        if self._ready:
            return

        _LOG_DIR.mkdir(parents=True, exist_ok=True)

        formatter = logging.Formatter(_FORMAT, datefmt=_DATE_FMT)

        # ── File handler: rotates at midnight, keeps 30 daily backups ────
        # Active file: logs/app.log
        # Rolled files: logs/app.log.2026-03-04, logs/app.log.2026-03-05 …
        log_file = _LOG_DIR / "app.log"
        file_handler = logging.handlers.TimedRotatingFileHandler(
            log_file,
            when="midnight",      # roll over at 00:00:00 local time
            interval=1,          # every 1 day
            backupCount=30,      # keep ~1 month of daily logs
            encoding="utf-8",
            delay=False,
            utc=False,           # use local time for rollover
        )
        # Make backup files look like  app.log.2026-03-04  (not .20260304)
        file_handler.suffix = "%Y-%m-%d"
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)

        # ── Console handler ────────────────────────────────────────────────
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(formatter)

        # ── Non-blocking queue ─────────────────────────────────────────────
        log_queue: queue.Queue = queue.Queue(maxsize=0)  # 0 = unlimited

        queue_handler = logging.handlers.QueueHandler(log_queue)
        queue_handler.setLevel(logging.DEBUG)

        # ── Background listener thread drains the queue ────────────────────
        self._listener = logging.handlers.QueueListener(
            log_queue,
            file_handler,
            console_handler,
            respect_handler_level=True,
        )
        self._listener.start()
        # Flush + stop cleanly when the process exits
        atexit.register(self._listener.stop)

        # ── Root logger: capture everything, let handlers filter ───────────
        root = logging.getLogger()
        root.setLevel(logging.DEBUG)
        # Clear any handlers added by uvicorn/third-party code before us.
        root.handlers.clear()
        root.addHandler(queue_handler)

        # ── Silence verbose third-party loggers ────────────────────────────
        for name, level in _QUIET:
            logging.getLogger(name).setLevel(level)

        self._ready = True


# ── Module-level initialisation ───────────────────────────────────────────────
# Runs the first time *any* module does `from utils.logger import get_logger`.
# Subsequent imports are no-ops (singleton guard).
_service = _LoggingService()
_service._init()


def get_logger(name: str) -> logging.Logger:
    """
    Return a named logger backed by the singleton service.

    Call once at module level:

        from utils.logger import get_logger
        logger = get_logger(__name__)
    """
    return logging.getLogger(name)
