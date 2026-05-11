from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from datetime import datetime

# --- User Schemas ---
class UserBase(BaseModel):
    username: str
    role: str
    sector: str

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: str
    
    model_config = ConfigDict(from_attributes=True)

# --- Auth Schemas ---
class Token(BaseModel):
    access_token: str
    token_type: str
    user: User

class TokenData(BaseModel):
    username: Optional[str] = None

# --- Message Schemas ---
class MessageBase(BaseModel):
    content: str
    targetType: str # p2p, group, subgroup
    targetId: str

class MessageCreate(MessageBase):
    sender_id: str
    receiver_id: Optional[str] = None
    group_id: Optional[str] = None

class Message(BaseModel):
    id: str
    sender_id: str
    sender_name: Optional[str] = None
    receiver_id: Optional[str] = None
    group_id: Optional[str] = None
    content: str
    timestamp: datetime
    targetType: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

# --- Group Schemas ---
class SubgroupSimple(BaseModel):
    id: str
    name: str

    model_config = ConfigDict(from_attributes=True)

class GroupSimple(BaseModel):
    id: str
    name: str
    subgroups: List[SubgroupSimple] = []

    model_config = ConfigDict(from_attributes=True)

class P2PSimple(BaseModel):
    id: str
    name: str
    online: bool = False

# --- Chat List Schema ---
class ChatStructure(BaseModel):
    p2p: List[P2PSimple]
    groups: List[GroupSimple]
