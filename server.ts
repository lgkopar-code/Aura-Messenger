import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import multer from "multer";
import axios from "axios";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "aura-academic-secret-9988";

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: "./uploads/",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// Database setup
async function initDb() {
  const db = await open({
    filename: "./database.sqlite",
    driver: sqlite3.Database,
  });

  await db.exec("PRAGMA foreign_keys = ON;");

  // Comprehensive Hierarchical Schema
  await db.exec(`
    CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY,
        login TEXT UNIQUE,
        hashed_password TEXT,
        role TEXT CHECK(role IN ('ADMIN', 'PLAYER')) DEFAULT 'PLAYER',
        full_name TEXT,
        group_dept TEXT,
        avatar TEXT,
        status TEXT DEFAULT 'Available',
        createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        creator_id INTEGER REFERENCES players(id),
        createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subgroups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS group_members (
        player_id INTEGER REFERENCES players(id),
        group_id INTEGER REFERENCES groups(id),
        PRIMARY KEY (player_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS subgroup_members (
        player_id INTEGER REFERENCES players(id),
        subgroup_id INTEGER REFERENCES subgroups(id),
        PRIMARY KEY (player_id, subgroup_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER REFERENCES players(id),
        receiver_id INTEGER REFERENCES players(id),
        group_id INTEGER REFERENCES groups(id),
        subgroup_id INTEGER REFERENCES subgroups(id),
        content TEXT,
        file_url TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: Add missing columns if they don't exist
  const tableInfo = await db.all("PRAGMA table_info(messages)");
  const columnNames = tableInfo.map(c => c.name);
  if (!columnNames.includes("receiver_id")) {
    await db.exec("ALTER TABLE messages ADD COLUMN receiver_id INTEGER REFERENCES players(id)");
  }
  if (!columnNames.includes("subgroup_id")) {
    await db.exec("ALTER TABLE messages ADD COLUMN subgroup_id INTEGER REFERENCES subgroups(id)");
  }
  if (!columnNames.includes("group_id")) {
    await db.exec("ALTER TABLE messages ADD COLUMN group_id INTEGER REFERENCES groups(id)");
  }

  return db;
}

const db = await initDb();
const activeConnections = new Map<string, WebSocket>();

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use("/uploads", express.static("uploads"));

  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.status(403).json({ error: "Forbidden" });
      req.user = user;
      next();
    });
  };

  // Seed Global Admin and Groups
  const adminHashedPassword = await bcrypt.hash("admin123", 10);
  await db.run("INSERT OR IGNORE INTO players (id, login, hashed_password, role, full_name, group_dept) VALUES (?, ?, ?, ?, ?, ?)", 
    [100, 'admin', adminHashedPassword, 'ADMIN', 'Master Administrator', 'HQ']);
  
  await db.run("INSERT OR IGNORE INTO groups (id, name, creator_id) VALUES (?, ?, ?)", [1, 'Main Citadel', 100]);
  await db.run("INSERT OR IGNORE INTO subgroups (id, name, parent_group_id) VALUES (?, ?, ?)", [1, 'Tactical HQ', 1]);
  await db.run("INSERT OR IGNORE INTO group_members (player_id, group_id) VALUES (?, ?)", [100, 1]);
  await db.run("INSERT OR IGNORE INTO subgroup_members (player_id, subgroup_id) VALUES (?, ?)", [100, 1]);

  // Auth: Register/Login
  app.post("/api/auth/register", async (req, res) => {
    const { login, password, full_name, role, group_dept } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const numericId = Math.floor(Math.random() * 1000000000);
      await db.run(
        "INSERT INTO players (id, login, hashed_password, role, full_name, group_dept) VALUES (?, ?, ?, ?, ?, ?)",
        [numericId, login, hashedPassword, role || 'PLAYER', full_name, group_dept]
      );
      // Auto-join main command
      await db.run("INSERT OR IGNORE INTO group_members (player_id, group_id) VALUES (?, 1)", [numericId]);
      await db.run("INSERT OR IGNORE INTO subgroup_members (player_id, subgroup_id) VALUES (?, 1)", [numericId]);
      
      res.json({ id: numericId, login });
    } catch (error: any) {
      res.status(400).json({ error: "Player registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { login, password } = req.body;
    const player = await db.get("SELECT * FROM players WHERE login = ?", [login]);
    if (!player || !(await bcrypt.compare(password, player.hashed_password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: player.id, login: player.login, role: player.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ access_token: token, user: { id: player.id, login: player.login, role: player.role, full_name: player.full_name, group_dept: player.group_dept } });
  });

  app.get("/api/users/me", authenticateToken, async (req: any, res) => {
    const player = await db.get("SELECT id, login, role, full_name, group_dept, avatar, status FROM players WHERE id = ?", [req.user.id]);
    res.json(player);
  });

  // Admin Logic
  const isAdmin = (req: any, res: any, next: any) => {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: "Admin access required" });
    next();
  };

  app.post("/api/admin/groups", authenticateToken, isAdmin, async (req: any, res) => {
    const { name } = req.body;
    const result = await db.run("INSERT INTO groups (name, creator_id) VALUES (?, ?)", [name, req.user.id]);
    const groupId = result.lastID;
    await db.run("INSERT INTO group_members (player_id, group_id) VALUES (?, ?)", [req.user.id, groupId]);
    res.json({ id: groupId, name });
  });

  app.post("/api/admin/groups/:groupId/subgroups", authenticateToken, isAdmin, async (req: any, res) => {
    const { name } = req.body;
    const result = await db.run("INSERT INTO subgroups (name, parent_group_id) VALUES (?, ?)", [name, req.params.groupId]);
    const subId = result.lastID;
    await db.run("INSERT INTO subgroup_members (player_id, subgroup_id) VALUES (?, ?)", [req.user.id, subId]);
    res.json({ id: subId, name });
  });

  app.post("/api/admin/groups/:groupId/members", authenticateToken, isAdmin, async (req, res) => {
    const { player_id } = req.body;
    await db.run("INSERT OR IGNORE INTO group_members (player_id, group_id) VALUES (?, ?)", [player_id, req.params.groupId]);
    res.sendStatus(200);
  });

  app.post("/api/admin/subgroups/:subgroupId/members", authenticateToken, isAdmin, async (req, res) => {
    const { player_id } = req.body;
    await db.run("INSERT OR IGNORE INTO subgroup_members (player_id, subgroup_id) VALUES (?, ?)", [player_id, req.params.subgroupId]);
    res.sendStatus(200);
  });

  // Player Logic
  app.get("/api/chats", authenticateToken, async (req: any, res) => {
    const p2p = await db.all("SELECT id, login, full_name, role FROM players WHERE id != ?", [req.user.id]);
    const groups = await db.all(`
        SELECT g.* FROM groups g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.player_id = ?`, [req.user.id]);
    
    for (let g of groups) {
        g.subgroups = await db.all(`
            SELECT s.*, s.parent_group_id as groupId FROM subgroups s
            JOIN subgroup_members sm ON s.id = sm.subgroup_id
            WHERE s.parent_group_id = ? AND sm.player_id = ?`, [g.id, req.user.id]);
    }

    res.json({ p2p, groups });
  });

  app.get("/api/messages", authenticateToken, async (req: any, res) => {
    const { receiver_id, group_id, subgroup_id } = req.query;
    let query, params;
    
    if (subgroup_id) {
        query = "SELECT m.*, p.full_name, p.login FROM messages m JOIN players p ON m.sender_id = p.id WHERE subgroup_id = ? ORDER BY timestamp ASC";
        params = [subgroup_id];
    } else if (group_id) {
        query = "SELECT m.*, p.full_name, p.login FROM messages m JOIN players p ON m.sender_id = p.id WHERE group_id = ? ORDER BY timestamp ASC";
        params = [group_id];
    } else {
        query = "SELECT m.*, p.full_name, p.login FROM messages m JOIN players p ON m.sender_id = p.id WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY timestamp ASC";
        params = [req.user.id, receiver_id, receiver_id, req.user.id];
    }
    
    const messages = await db.all(query, params);
    res.json(messages);
  });

  // File Upload
  app.post("/api/upload", authenticateToken, upload.single("file"), (req: any, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");
    res.json({ url: `/uploads/${req.file.filename}`, originalName: req.file.originalname });
  });

  // Schedule Proxy
  app.get("/api/schedule", async (req, res) => {
    try {
      // Mocking IRGUPS API response since we can't scrape it effectively in one go
      // In real scenario, we'd use axios to get HTML and parse or call their JSON API
      res.json([
        { time: "08:30", subject: "Mathematics", room: "A-204", teacher: "Ivanov I.I." },
        { time: "10:15", subject: "Physics", room: "B-101", teacher: "Petrov P.P." }
      ]);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch schedule" });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  const server = app.listen(PORT, "0.0.0.0", () => console.log(`Aura Server: http://localhost:${PORT}`));

  // WebSocket
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const clientId = url.pathname.split("/").pop();
    if (clientId) activeConnections.set(clientId, ws);

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'chat') {
          const { senderId, receiverId, groupId, subgroupId, content, fileUrl } = msg;
          const res = await db.run(
            "INSERT INTO messages (sender_id, receiver_id, group_id, subgroup_id, content, file_url) VALUES (?, ?, ?, ?, ?, ?)",
            [senderId, receiverId || null, groupId || null, subgroupId || null, content, fileUrl]
          );
          const savedMsg = { ...msg, id: res.lastID, timestamp: new Date().toISOString() };
          
          if (subgroupId) {
              const members = await db.all("SELECT player_id FROM subgroup_members WHERE subgroup_id = ?", [subgroupId]);
              members.forEach(s => activeConnections.get(String(s.player_id))?.send(JSON.stringify(savedMsg)));
          } else if (groupId) {
              const members = await db.all("SELECT player_id FROM group_members WHERE group_id = ?", [groupId]);
              members.forEach(s => activeConnections.get(String(s.player_id))?.send(JSON.stringify(savedMsg)));
          } else if (receiverId) {
              activeConnections.get(String(receiverId))?.send(JSON.stringify(savedMsg));
              activeConnections.get(String(senderId))?.send(JSON.stringify(savedMsg));
          }
        } else if (msg.type === 'call_signal') {
          activeConnections.get(String(msg.targetId))?.send(JSON.stringify(msg));
        }
      } catch (err) {
        console.error("WS Message Error:", err);
      }
    });

    ws.on("close", () => {
      if (clientId) activeConnections.delete(clientId);
    });
  });
}
startServer();
