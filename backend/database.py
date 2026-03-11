from sqlmodel import create_engine, SQLModel, Session
import os
from sqlalchemy import event
from utils.logger import get_logger

logger = get_logger(__name__)

sqlite_file_name = "jobs.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    logger.debug("Setting SQLite PRAGMAs (WAL, NORMAL)")
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


def create_db_and_tables():
    logger.info("Creating database tables if they don't exist...")
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
