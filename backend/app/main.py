import os
import uuid
from datetime import datetime
from typing import List, Dict, Optional

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, status, Body
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload, joinedload

try:
    from . import models, schemas, auth
    from .database import engine, Base, get_db
except ImportError:
    import models, schemas, auth
    from database import engine, Base, get_db

app = FastAPI(title="Aura Messenger API")

# НАСТРОЙКА CORS ДЛЯ ВАШИХ ДОМЕНОВ
origins = [
    "http://localhost:5173",
    "https://aura-messenger-tnuw.vercel.app", # Ваш актуальный адрес на Vercel
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]

    async def broadcast_to_users(self, message: dict, user_ids: List[str]):
        for user_id in user_ids:
            if user_id in self.active_connections:
                try:
                    await self.active_connections[user_id].send_json(message)
                except:
                    pass

manager = ConnectionManager()

# --- Auth ---
@app.post("/api/auth/register", response_model=schemas.User)
async def register(user_in: schemas.UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.User).where(models.User.username == user_in.username))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Username already registered")
    
    db_user = models.User(
        username=user_in.username,
        hashed_password=auth.get_password_hash(user_in.password),
        role=user_in.role,
        sector=user_in.sector
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

@app.post("/api/auth/login", response_model=schemas.Token)
async def login(user_in: schemas.UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.User).where(models.User.username == user_in.username))
    user = result.scalars().first()
    if not user or not auth.verify_password(user_in.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    
    access_token = auth.create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer", "user": user}

# --- Chats ---
@app.get("/api/chats", response_model=schemas.ChatStructure)
async def get_chats(current_user: models.User = Depends(auth.get_current_user), db: AsyncSession = Depends(get_db)):
    res_users = await db.execute(select(models.User).where(models.User.id != current_user.id))
    p2p_list = [
        schemas.P2PSimple(id=u.id, name=u.username, online=(u.id in manager.active_connections)) 
        for u in res_users.scalars().all()
    ]
    
    res_groups = await db.execute(select(models.Group).where(models.Group.parent_id == None).options(selectinload(models.Group.subgroups)))
    groups_list = [
        schemas.GroupSimple(id=g.id, name=g.name, subgroups=[schemas.SubgroupSimple(id=s.id, name=s.name) for s in g.subgroups])
        for g in res_groups.scalars().all()
    ]
    return {"p2p": p2p_list, "groups": groups_list}

@app.get("/api/chats/{target_type}/{target_id}/messages", response_model=List[schemas.Message])
async def get_messages(target_type: str, target_id: str, current_user: models.User = Depends(auth.get_current_user), db: AsyncSession = Depends(get_db)):
    query = select(models.Message).options(joinedload(models.Message.sender))
    if target_type == "p2p":
        query = query.where(((models.Message.sender_id == current_user.id) & (models.Message.receiver_id == target_id)) | ((models.Message.sender_id == target_id) & (models.Message.receiver_id == current_user.id)))
    else:
        query = query.where(models.Message.group_id == target_id)
    
    result = await db.execute(query.order_by(models.Message.timestamp.asc()))
    return [
        schemas.Message(
            id=m.id, sender_id=m.sender_id, sender_name=m.sender.username,
            receiver_id=m.receiver_id, group_id=m.group_id,
            content=m.content, timestamp=m.timestamp, targetType=target_type
        ) for m in result.scalars().all()
    ]

# --- Admin ---
class GroupCreate(BaseModel):
    name: str

@app.post("/api/groups")
async def create_group(data: GroupCreate, user=Depends(auth.get_current_user), db=Depends(get_db)):
    if user.role != "Commander" and user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Clearance required")
    new_group = models.Group(name=data.name)
    db.add(new_group)
    await db.commit()
    return {"status": "ok"}

# --- WebSocket ---
@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str, db: AsyncSession = Depends(get_db)):
    await manager.connect(user_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            if msg_type == "message":
                target_id = data.get("targetId")
                target_type = data.get("targetType")
                content = data.get("content")
                
                db_msg = models.Message(sender_id=user_id, content=content)
                recipients = [user_id]
                
                if target_type == "p2p":
                    db_msg.receiver_id = target_id
                    recipients.append(target_id)
                else:
                    db_msg.group_id = target_id
                    res = await db.execute(select(models.User.id).join(models.group_members).where(models.group_members.c.group_id == target_id))
                    recipients.extend(res.scalars().all())
                
                db.add(db_msg)
                await db.commit()
                await db.refresh(db_msg)
                
                res_sender = await db.execute(select(models.User.username).where(models.User.id == user_id))
                sender_name = res_sender.scalars().first()
                
                payload = {
                    "type": "message", "id": db_msg.id, "senderId": user_id,
                    "senderName": sender_name, "content": content, "targetId": target_id,
                    "timestamp": db_msg.timestamp.isoformat()
                }
                await manager.broadcast_to_users(payload, list(set(recipients)))

            elif msg_type in ["call_signal", "call_offer", "call_answer", "ice_candidate"]:
                target_id = data.get("targetId")
                data["senderId"] = user_id
                res = await db.execute(select(models.User.username).where(models.User.id == user_id))
                data["senderName"] = res.scalars().first() or "Unknown"
                await manager.broadcast_to_users(data, [target_id])

    except WebSocketDisconnect:
        manager.disconnect(user_id)
    except Exception as e:
        manager.disconnect(user_id)
