import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base

# Получаем URL из переменной окружения DATABASE_URL (ее установит Render)
# Если переменной нет, используем локальный SQLite для тестов
DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    # Render дает URL в формате postgres://, но SQLAlchemy (asyncpg) требует postgresql+asyncpg://
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
else:
    # Фоллбек на локальный SQLite, если DATABASE_URL не задан
    DATABASE_URL = "sqlite+aiosqlite:///./messenger.db"

# Создаем движок
engine = create_async_engine(
    DATABASE_URL,
    # Параметры для PostgreSQL (игнорируются для SQLite)
    pool_pre_ping=True
)

AsyncSessionLocal = sessionmaker(
    bind=engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
