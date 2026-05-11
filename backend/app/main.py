import os
from datetime import datetime
from typing import List, Dict

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, status, Body
from pydantic import BaseModel

from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload, joinedload

from . import models, schemas, auth
from .database import engine, Base, get_db

app = FastAPI(title="Aura Messenger API")

# CORS Setup for Vite (localhost:5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Initialization ---
@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        # В реальном проекте используйте Alembic
        await conn.run_sync(Base.metadata.create_all)

# --- WebSocket Connection Manager ---
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
                await self.active_connections[user_id].send_json(message)

manager = ConnectionManager()

# --- Auth Routes ---
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

# --- Chat Routes ---
@app.get("/api/chats", response_model=schemas.ChatStructure)
async def get_chats(current_user: models.User = Depends(auth.get_current_user), db: AsyncSession = Depends(get_db)):
    # P2P: All other users
    result = await db.execute(select(models.User).where(models.User.id != current_user.id))
    p2p_users = result.scalars().all()
    p2p_list = [
        schemas.P2PSimple(
            id=u.id, 
            name=u.username, 
            online=(u.id in manager.active_connections)
        ) for u in p2p_users
    ]
    
    # Groups: Parent groups with subgroups
    result = await db.execute(
        select(models.Group)
        .where(models.Group.parent_id == None)
        .options(selectinload(models.Group.subgroups))
    )
    top_groups = result.scalars().all()
    
    groups_list = []
    for g in top_groups:
        subgroups = [schemas.SubgroupSimple(id=s.id, name=s.name) for s in g.subgroups]
        groups_list.append(schemas.GroupSimple(id=g.id, name=g.name, subgroups=subgroups))
        
    return {"p2p": p2p_list, "groups": groups_list}

@app.get("/api/chats/{target_type}/{target_id}/messages", response_model=List[schemas.Message])
async def get_messages(
    target_type: str, 
    target_id: str, 
    current_user: models.User = Depends(auth.get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    query = select(models.Message).options(joinedload(models.Message.sender))
    
    if target_type == "p2p":
        query = query.where(
            ((models.Message.sender_id == current_user.id) & (models.Message.receiver_id == target_id)) |
            ((models.Message.sender_id == target_id) & (models.Message.receiver_id == current_user.id))
        )
    elif target_type in ["group", "subgroup"]:
        query = query.where(models.Message.group_id == target_id)
    
    query = query.order_by(models.Message.timestamp.asc())
    result = await db.execute(query)
    messages = result.scalars().all()
    
    return [
        schemas.Message(
            id=m.id,
            sender_id=m.sender_id,
            sender_name=m.sender.username,
            receiver_id=m.receiver_id,
            group_id=m.group_id,
            content=m.content,
            timestamp=m.timestamp,
            targetType=target_type
        ) for m in messages
    ]

# --- Admin/Commander Routes ---

class GroupCreate(BaseModel):
    name: str

class MemberAdd(BaseModel):
    user_id: str

# Функция-зависимость для проверки прав Командира
def verify_commander(current_user: models.User = Depends(auth.get_current_user)):
    if current_user.role != "Commander":
        raise HTTPException(status_code=403, detail="Доступ запрещен. Требуется роль Commander.")
    return current_user

@app.post("/api/groups", response_model=schemas.GroupSimple)
async def create_group(
    group_data: GroupCreate, 
    current_user: models.User = Depends(verify_commander), 
    db: AsyncSession = Depends(get_db)
):
    """Создание главной группы"""
    new_group = models.Group(name=group_data.name)
    db.add(new_group)
    
    # Автоматически добавляем создателя (Командира) в эту группу
    # Примечание: Убедитесь, что связь members инициализирована
    new_group.members.append(current_user)
    
    await db.commit()
    await db.refresh(new_group)
    
    return schemas.GroupSimple(id=new_group.id, name=new_group.name, subgroups=[])

@app.post("/api/groups/{group_id}/subgroups", response_model=schemas.SubgroupSimple)
async def create_subgroup(
    group_id: str,
    subgroup_data: GroupCreate,
    current_user: models.User = Depends(verify_commander),
    db: AsyncSession = Depends(get_db)
):
    """Создание подгруппы внутри существующей группы"""
    # Проверяем, существует ли родительская группа
    result = await db.execute(select(models.Group).where(models.Group.id == group_id))
    parent_group = result.scalars().first()
    
    if not parent_group:
        raise HTTPException(status_code=404, detail="Родительская группа не найдена")
        
    new_subgroup = models.Group(name=subgroup_data.name, parent_id=group_id)
    db.add(new_subgroup)
    await db.commit()
    await db.refresh(new_subgroup)
    
    return schemas.SubgroupSimple(id=new_subgroup.id, name=new_subgroup.name)

@app.post("/api/groups/{group_id}/members")
async def add_member_to_group(
    group_id: str,
    member_data: MemberAdd,
    current_user: models.User = Depends(verify_commander),
    db: AsyncSession = Depends(get_db)
):
    """Добавление оперативника (или другого командира) в группу"""
    # Находим группу и сразу подгружаем список ее участников
    result = await db.execute(
        select(models.Group)
        .options(selectinload(models.Group.members))
        .where(models.Group.id == group_id)
    )
    group = result.scalars().first()
    
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
        
    # Находим пользователя, которого хотим добавить
    result_user = await db.execute(select(models.User).where(models.User.id == member_data.user_id))
    user_to_add = result_user.scalars().first()
    
    if not user_to_add:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
        
    # Проверяем, не состоит ли он уже в группе
    if user_to_add in group.members:
        raise HTTPException(status_code=400, detail="Пользователь уже находится в этой группе")
        
    group.members.append(user_to_add)
    await db.commit()
    
    return {"status": "success", "message": f"Пользователь {user_to_add.username} добавлен в {group.name}"}

# --- WebSocket Endpoint ---
@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str, db: AsyncSession = Depends(get_db)):
    await manager.connect(user_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "message":
                target_type = data.get("targetType")
                target_id = data.get("targetId")
                content = data.get("content")
                
                # Fetch sender
                result = await db.execute(select(models.User).where(models.User.id == user_id))
                sender = result.scalars().first()
                
                # Create message
                db_msg = models.Message(
                    sender_id=user_id,
                    content=content,
                    timestamp=datetime.utcnow()
                )
                
                recipients = []
                if target_type == "p2p":
                    db_msg.receiver_id = target_id
                    recipients = [user_id, target_id]
                else:
                    db_msg.group_id = target_id
                    # Get members (simplified: broadcast to all members of group)
                    # Note: Group members should be loaded or fetched
                    res_members = await db.execute(
                        select(models.User.id).join(models.group_members).where(models.group_members.c.group_id == target_id)
                    )
                    recipients = list(res_members.scalars().all())
                    # Always include sender if they sent to a group
                    if user_id not in recipients:
                        recipients.append(user_id)
                
                db.add(db_msg)
                await db.commit()
                await db.refresh(db_msg)
                
                # Broadcast
                out_msg = {
                    "type": "message",
                    "id": db_msg.id,
                    "senderId": user_id,
                    "senderName": sender.username if sender else "Unknown",
                    "targetType": target_type,
                    "content": content,
                    "timestamp": db_msg.timestamp.isoformat()
                }
                
                await manager.broadcast_to_users(out_msg, recipients)
            
            elif data.get("type") in ["call_signal", "call_offer", "call_answer", "ice_candidate"]:
                target_id = data.get("targetId")
                # Forward signaling message to the target user
                data["senderId"] = user_id
                
                # Fetch sender name for the recipient's UI
                res = await db.execute(select(models.User.username).where(models.User.id == user_id))
                data["senderName"] = res.scalars().first() or "Unknown"
                
                await manager.broadcast_to_users(data, [target_id])
                
    except WebSocketDisconnect:
        manager.disconnect(user_id)
    except Exception as e:
        print(f"WS Error: {e}")
        manager.disconnect(user_id)
