import uuid
from datetime import datetime
from typing import List, Optional
from sqlalchemy import String, ForeignKey, DateTime, Text, Column, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

# Association table for Group members
group_members = Table(
    "group_members",
    Base.metadata,
    Column("user_id", String, ForeignKey("users.id"), primary_key=True),
    Column("group_id", String, ForeignKey("groups.id"), primary_key=True),
)

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)  # Commander or Operative
    sector: Mapped[str] = mapped_column(String)

    # Relationships
    groups: Mapped[List["Group"]] = relationship(
        "Group", secondary=group_members, back_populates="members"
    )
    sent_messages: Mapped[List["Message"]] = relationship(
        "Message", foreign_keys="[Message.sender_id]", back_populates="sender"
    )
    received_messages: Mapped[List["Message"]] = relationship(
        "Message", foreign_keys="[Message.receiver_id]", back_populates="receiver"
    )

class Group(Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String)
    parent_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("groups.id"), nullable=True)

    # Self-referential relationship for subgroups
    subgroups: Mapped[List["Group"]] = relationship(
        "Group", 
        backref="parent", 
        remote_side=[id],
        primaryjoin=id==parent_id,
        uselist=True
    )
    
    # Relationships
    members: Mapped[List["User"]] = relationship(
        "User", secondary=group_members, back_populates="groups"
    )
    messages: Mapped[List["Message"]] = relationship("Message", back_populates="group")

class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    sender_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    receiver_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("users.id"), nullable=True)
    group_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("groups.id"), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    sender: Mapped["User"] = relationship("User", foreign_keys=[sender_id], back_populates="sent_messages")
    receiver: Mapped[Optional["User"]] = relationship("User", foreign_keys=[receiver_id], back_populates="received_messages")
    group: Mapped[Optional["Group"]] = relationship("Group", back_populates="messages")
