import dayjs from "dayjs";
import Peer from "simple-peer";

// --- Configuration ---
// ВАЖНО: Замени этот IP на адрес твоего сервера, если он изменится
const API_CONFIG = {
    HOST: '91.239.207.231', 
    PORT: '15663' // Тот самый порт, который ты видишь в ho.ge
};

const BASE_URL = `http://${API_CONFIG.HOST}:${API_CONFIG.PORT}`;
const WS_BASE_URL = `ws://${API_CONFIG.HOST}:${API_CONFIG.PORT}`;

// --- State ---
let state = {
  user: JSON.parse(localStorage.getItem('aura_user') || 'null'),
  token: localStorage.getItem('aura_token'),
  authMode: 'login', 
  activeView: 'chat', 
  selectedTarget: null, 
  chats: { p2p: [], groups: [] },
  messages: [],
  ws: null,
  call: { active: false, type: null, remoteUser: null, initiator: false },
  peer: null,
  localStream: null,
  remoteStream: null
};

const API = {
  headers: () => {
    const h = { 'Content-Type': 'application/json' };
    if (state.token) h['Authorization'] = `Bearer ${state.token}`;
    return h;
  },
  request: async (url, options = {}) => {
    // FIX: Всегда добавляем базовый URL сервера
    const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
    
    try {
      const res = await fetch(fullUrl, {
        ...options,
        headers: { ...API.headers(), ...options.headers }
      });
      
      if (res.status === 401) {
        logout();
        throw new Error('Session expired');
      }
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || 'Request failed');
      return data;
    } catch (err) {
      console.error(`API Error (${fullUrl}):`, err);
      throw err;
    }
  },
  get: (url) => API.request(url),
  post: (url, data) => API.request(url, { method: 'POST', body: JSON.stringify(data) })
};

function logout() {
    localStorage.removeItem('aura_token');
    localStorage.removeItem('aura_user');
    state.token = null;
    state.user = null;
    if (state.ws) {
        state.ws.close();
        state.ws = null;
    }
    render();
}

// --- View Rendering ---
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  if (!state.token) {
    app.innerHTML = state.authMode === 'login' ? renderLogin() : renderRegister();
    attachAuthEvents();
  } else {
    app.innerHTML = renderMain();
    attachMainEvents();
  }
  
  if (window.lucide) {
      window.lucide.createIcons();
  }
}

function renderAuthBase(content) {
  return `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="glass-panel p-10 rounded-3xl w-full max-w-md border-white/10 shadow-2xl relative overflow-hidden" id="auth-container">
        <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent-emerald to-transparent opacity-50"></div>
        <div class="text-center mb-10">
          <div class="w-20 h-20 bg-accent-emerald/10 border border-accent-emerald/30 rounded-2xl flex items-center justify-center mx-auto mb-6 glow-emerald">
            <i data-lucide="shield" size="40" class="text-accent-emerald"></i>
          </div>
          <h1 class="text-4xl font-black text-white tracking-[0.2em] mb-2 uppercase italic">Nexus</h1>
          <p class="text-accent-emerald text-[10px] uppercase tracking-[0.4em] font-bold">Secure Tactical Protocol</p>
        </div>
        <div id="auth-forms">
            ${content}
        </div>
      </div>
    </div>
  `;
}

function renderLogin() {
    return renderAuthBase(`
        <form id="login-form" class="space-y-4">
          <div class="relative">
            <i data-lucide="user" size="18" class="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary"></i>
            <input type="text" name="login" placeholder="Access ID" class="w-full bg-black/40 border border-white/10 p-4 pl-12 rounded-2xl text-white focus:border-accent-emerald outline-none transition-all" required />
          </div>
          <div class="relative">
            <i data-lucide="lock" size="18" class="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary"></i>
            <input type="password" name="password" placeholder="Cipher Pattern" class="w-full bg-black/40 border border-white/10 p-4 pl-12 rounded-2xl text-white focus:border-accent-emerald outline-none transition-all" required />
          </div>
          <button type="submit" class="w-full bg-accent-emerald text-black font-black p-4 rounded-2xl hover:brightness-110 active:scale-[0.98] transition-all uppercase tracking-widest shadow-[0_0_20px_rgba(0,255,136,0.3)]">Establish Link</button>
        </form>
        <div class="mt-8 text-center border-t border-white/5 pt-6">
            <button id="show-register" type="button" class="text-text-secondary text-sm hover:text-white transition-colors flex items-center justify-center gap-2 mx-auto"><i data-lucide="user-plus" size="16"></i> Request Clearance</button>
        </div>
    `);
}

function renderRegister() {
    return renderAuthBase(`
        <div class="text-center mb-8">
          <h2 class="text-2xl font-bold text-white tracking-tight uppercase">Registration</h2>
          <p class="text-accent-emerald text-[10px] uppercase tracking-widest mt-1">Initialize New Neural Profile</p>
        </div>
        <form id="register-form" class="space-y-3">
          <input type="text" name="login" placeholder="Codename" class="w-full bg-black/40 border border-white/10 p-3.5 rounded-2xl text-white focus:border-accent-emerald outline-none text-sm" required />
          <input type="password" name="password" placeholder="Pass-key" class="w-full bg-black/40 border border-white/10 p-3.5 rounded-2xl text-white focus:border-accent-emerald outline-none text-sm" required />
          <div class="flex gap-2">
            <select name="role" id="role-select" class="flex-1 bg-black/40 border border-white/10 p-3.5 rounded-2xl text-white focus:border-accent-emerald outline-none text-sm appearance-none">
                <option value="PLAYER">Operative</option>
                <option value="ADMIN">Commander</option>
            </select>
            <input type="text" name="group_dept" id="role-detail-input" placeholder="Sector" class="flex-[2] bg-black/40 border border-white/10 p-3.5 rounded-2xl text-white focus:border-accent-emerald outline-none text-sm" required />
          </div>
          <button type="submit" class="w-full bg-accent-emerald text-black font-black p-4 rounded-2xl hover:brightness-110 active:scale-[0.98] transition-all uppercase tracking-widest mt-4">Generate Token</button>
        </form>
        <div class="mt-6 text-center">
            <button id="show-login" type="button" class="text-text-secondary text-xs hover:text-white transition-colors underline decoration-accent-emerald/30">Already Synchronized? Return to Login</button>
        </div>
    `);
}

function renderMain() {
  return `
    <div class="flex h-screen bg-[#060b0d]">
      <!-- 1. Left Sidebar -->
      <nav class="w-[72px] glass-panel border-r border-white/5 flex flex-col items-center py-6 gap-4 z-30">
        <div class="w-10 h-10 bg-accent-emerald rounded-xl flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(0,255,136,0.3)]">
           <i data-lucide="shield" size="24" class="text-black"></i>
        </div>
        <div class="sidebar-icon ${state.activeView === 'chat' ? 'active' : ''}" data-view="chat">
           <i data-lucide="message-circle" size="24"></i>
           <span class="text-[9px] mt-1 opacity-70 uppercase font-bold">Chats</span>
        </div>
        <div class="sidebar-icon ${state.activeView === 'teams' ? 'active' : ''}" data-view="teams">
           <i data-lucide="users" size="24"></i>
           <span class="text-[9px] mt-1 opacity-70 uppercase font-bold">Teams</span>
        </div>
        <div class="mt-auto sidebar-icon group cursor-pointer" id="logout-btn">
           <i data-lucide="log-out" size="24" class="group-hover:text-red-400"></i>
           <span class="text-[9px] mt-1 group-hover:text-red-400 font-bold uppercase">Exit</span>
        </div>
      </nav>

      <!-- 2. Sub-Sidebar -->
      <aside class="w-[340px] glass-panel border-r border-white/5 flex flex-col z-20">
        ${renderSubSidebar()}
      </aside>

      <!-- 3. Main Content -->
      <main class="flex-1 flex flex-col relative z-10 bg-[#0a0f12]">
        ${renderContent()}
      </main>
    </div>
    
    ${state.call.active ? renderCallOverlay() : ''}
  `;
}

function renderSubSidebar() {
  const emptyState = (msg) => `<div class="flex-1 flex flex-col items-center justify-center p-8 text-center text-[10px] text-text-secondary uppercase tracking-[0.3em] opacity-40 gap-4">
    <div class="w-12 h-12 border border-white/5 rounded-full flex items-center justify-center"><i data-lucide="search-slash" size="20"></i></div>
    ${msg}
  </div>`;

  if (state.activeView === 'chat') {
    return `
      <div class="p-6 border-b border-white/5">
        <h2 class="text-xl font-black text-white uppercase italic tracking-wider">Messages</h2>
      </div>
      <div class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
        ${state.chats.p2p.length ? state.chats.p2p.map(p => `
          <div class="p-3 rounded-2xl flex items-center gap-4 cursor-pointer transition-all hover:bg-white/5 ${state.selectedTarget?.type === 'p2p' && state.selectedTarget?.id === p.id ? 'bg-accent-emerald/10 border border-accent-emerald/20' : ''}" data-target-type="p2p" data-target-id="${p.id}">
            <div class="relative shrink-0">
                <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-panel-green to-black border border-white/10 flex items-center justify-center font-black text-accent-emerald text-lg shadow-xl">
                  ${(p.name || 'U')[0].toUpperCase()}
                </div>
                ${p.online ? '<div class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-[#060b0d] shadow-[0_0_8px_rgba(34,197,94,0.8)]"></div>' : ''}
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-bold text-white truncate text-sm target-name">${p.name}</p>
              <p class="text-[10px] text-text-secondary truncate mt-0.5 uppercase tracking-tighter font-medium italic">${p.online ? 'Tactical Link Live' : 'Offline'}</p>
            </div>
          </div>
        `).join('') : emptyState('Neural network isolated')}
      </div>
    `;
  }
  
  if (state.activeView === 'teams') {
    return `
      <div class="p-5 border-b border-white/5 flex justify-between items-center h-[72px]">
        <h2 class="text-sm font-black text-white tracking-widest uppercase italic">Factions</h2>
        ${state.user?.role === 'Commander' ? `<button class="p-2 bg-accent-emerald/10 text-accent-emerald hover:bg-accent-emerald rounded-lg hover:text-black transition-all" id="btn-create-group"><i data-lucide="plus" size="16"></i></button>` : ''}
      </div>
      <div class="p-3 space-y-2 overflow-y-auto flex-1 custom-scrollbar">
        ${state.chats.groups.length ? state.chats.groups.map(g => `
            <div class="bg-white/5 rounded-2xl border border-white/5 overflow-hidden">
                <div class="p-3 cursor-pointer hover:bg-white/10 transition-all flex items-center gap-3 ${state.selectedTarget?.type === 'group' && state.selectedTarget?.id === g.id ? 'bg-accent-emerald/10' : ''}" data-target-type="group" data-target-id="${g.id}">
                    <div class="w-8 h-8 rounded-lg bg-accent-emerald/20 flex items-center justify-center text-xs font-black text-accent-emerald shadow-inner">${(g.name || 'G')[0].toUpperCase()}</div>
                    <div class="flex-1 min-w-0 flex justify-between items-center text-gray-200">
                        <span class="font-bold text-xs uppercase tracking-wider truncate target-name">${g.name || 'Unnamed'}</span>
                        ${state.user?.role === 'Commander' ? `<button class="p-1 hover:text-accent-emerald opacity-50 transition-opacity" onclick="event.stopPropagation(); window.createSubgroup('${g.id}')"><i data-lucide="plus-circle" size="14"></i></button>` : ''}
                    </div>
                </div>
                ${g.subgroups?.length ? `
                <div class="pl-11 pr-3 pb-3 pt-1 space-y-1 bg-black/20">
                    ${g.subgroups.map(s => `
                        <div class="p-2 rounded-lg cursor-pointer hover:bg-white/10 transition-all flex items-center gap-2 text-[11px] ${state.selectedTarget?.type === 'subgroup' && state.selectedTarget?.id === s.id ? 'text-accent-emerald font-black' : 'text-gray-400'}" data-target-type="subgroup" data-target-id="${s.id}">
                            <div class="w-1.5 h-1.5 rounded-full ${state.selectedTarget?.id === s.id ? 'bg-accent-emerald glow-emerald' : 'bg-gray-600'}"></div>
                            <span class="truncate target-name uppercase tracking-tighter">${s.name}</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </div>
        `).join('') : emptyState('No units deployed')}
      </div>
    `;
  }
  return '';
}

function renderContent() {
  if (!state.selectedTarget) {
    return `
        <div class="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
            <div class="w-32 h-32 bg-white/5 rounded-[32px] flex items-center justify-center mb-8 rotate-12 border border-white/10 shadow-[0_0_30px_rgba(0,255,136,0.1)]">
                <i data-lucide="radio" size="64" class="text-accent-emerald -rotate-12"></i>
            </div>
            <h1 class="text-5xl font-black text-white uppercase italic tracking-[0.3em] mb-4">Nexus</h1>
            <p class="uppercase tracking-[0.6em] font-black text-accent-emerald text-[10px] bg-accent-emerald/10 px-4 py-1 rounded-full border border-accent-emerald/20">Awaiting tactical link...</p>
        </div>
    `;
  }

  return `
    <header class="p-6 border-b border-white/5 flex items-center justify-between glass-panel h-[80px]">
        <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-accent-emerald to-[#00ff88] flex items-center justify-center text-black font-black text-xl shadow-lg">
                ${(state.selectedTarget.name || 'T')[0].toUpperCase()}
            </div>
            <div>
                <h3 class="font-black text-white text-base tracking-tight italic uppercase">${state.selectedTarget.name}</h3>
                <p class="text-[10px] text-accent-emerald font-black uppercase tracking-widest flex items-center gap-1.5 mt-0.5">
                    <span class="relative flex h-2 w-2">
                      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-emerald opacity-75"></span>
                      <span class="relative inline-flex rounded-full h-2 w-2 bg-accent-emerald"></span>
                    </span>
                    Secure Link Active
                </p>
            </div>
        </div>
        <div class="flex items-center gap-2">
            ${state.user?.role === 'Commander' && state.selectedTarget.type !== 'p2p' ? `
                <button class="w-10 h-10 rounded-xl hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-accent-emerald transition-all" id="btn-add-member"><i data-lucide="user-plus" size="20"></i></button>
            ` : ''}
            <button class="w-10 h-10 rounded-xl hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-accent-emerald transition-all" id="btn-audio-call"><i data-lucide="phone" size="20"></i></button>
            <button class="w-10 h-10 rounded-xl hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-accent-emerald transition-all" id="btn-video-call"><i data-lucide="video" size="20"></i></button>
        </div>
    </header>

    <div class="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar" id="messages-container">
        ${state.messages.map((m) => {
            const isMe = m.sender_id === state.user.id;
            return `
                <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-slide-up">
                    ${!isMe ? `<span class="text-[10px] font-black text-accent-emerald mb-1 ml-1 uppercase italic tracking-tighter">${m.sender_name}</span>` : ''}
                    <div class="max-w-[80%] px-5 py-3 text-sm leading-relaxed ${
                        isMe 
                        ? 'bg-accent-emerald text-black rounded-2xl rounded-tr-none font-bold shadow-[0_4px_15px_rgba(0,255,136,0.15)]' 
                        : 'bg-white/5 text-white rounded-2xl rounded-tl-none border border-white/5'
                    }">
                        ${m.content}
                    </div>
                    <span class="text-[9px] text-white/20 font-mono mt-1.5 ${isMe ? 'mr-1' : 'ml-1'} uppercase font-bold">${dayjs(m.timestamp).format('HH:mm')}</span>
                </div>
            `;
        }).join('')}
    </div>

    <footer class="p-6 border-t border-white/5">
        <form id="msg-form" class="max-w-4xl mx-auto flex items-center gap-4">
            <div class="flex-1 relative bg-white/5 rounded-2xl border border-white/10">
                <input id="msg-input" autocomplete="off" placeholder="Transmit tactical data..." class="w-full bg-transparent px-5 py-4 text-white placeholder-white/20 outline-none text-sm" />
            </div>
            <button type="submit" class="w-14 h-14 bg-accent-emerald text-black rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(0,255,136,0.3)] hover:scale-105 active:scale-95 transition-all">
                <i data-lucide="send" size="24"></i>
            </button>
        </form>
    </footer>
  `;
}

function renderCallOverlay() {
    const isVideo = state.call.type === 'video';
    return `
        <div class="fixed inset-0 z-[100] bg-[#060b0d]/95 backdrop-blur-xl flex flex-col items-center justify-center animate-slide-up">
            ${isVideo ? `
                <div class="absolute inset-0">
                    <video id="remote-video" autoplay playsinline class="w-full h-full object-cover opacity-60"></video>
                </div>
                <div class="absolute bottom-10 right-10 w-48 h-64 bg-black rounded-2xl overflow-hidden border-2 border-accent-emerald shadow-2xl z-10">
                    <video id="local-video" autoplay playsinline muted class="w-full h-full object-cover"></video>
                </div>
            ` : ''}
            <div class="relative z-10 text-center">
                <div class="w-32 h-32 rounded-full border-4 border-accent-emerald flex items-center justify-center p-1 mb-8 animate-pulse mx-auto">
                    <div class="w-full h-full rounded-full bg-accent-emerald/20 flex items-center justify-center text-4xl font-black text-accent-emerald uppercase italic">
                        ${state.call.remoteUser?.name ? state.call.remoteUser.name[0] : 'U'}
                    </div>
                </div>
                <h2 class="text-3xl font-black text-white mb-2 uppercase italic tracking-wider">${isVideo ? 'Video' : 'Audio'} Call</h2>
                <p class="text-accent-emerald animate-pulse uppercase tracking-[0.2em] text-[10px] font-bold">
                    ${state.remoteStream ? 'Channel Established' : `Connecting to ${state.call.remoteUser?.name}...`}
                </p>
            </div>
            <audio id="remote-audio" autoplay class="hidden"></audio>
            <div class="mt-20 flex gap-10 relative z-10">
                <button id="end-call" class="w-20 h-20 rounded-full bg-red-600 text-white flex items-center justify-center shadow-[0_0_30px_rgba(220,38,38,0.4)] hover:scale-110 transition-all">
                    <i data-lucide="phone-off" size="32"></i>
                </button>
            </div>
        </div>
    `;
}

// --- Logic ---
function attachAuthEvents() {
    document.getElementById('show-register')?.addEventListener('click', () => {
        state.authMode = 'register';
        render();
    });

    document.getElementById('show-login')?.addEventListener('click', () => {
        state.authMode = 'login';
        render();
    });

    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = e.target.login.value;
        const password = e.target.password.value;
        try {
            const data = await API.post('/api/auth/login', { username, password });
            state.token = data.access_token;
            state.user = data.user;
            localStorage.setItem('aura_token', data.access_token);
            localStorage.setItem('aura_user', JSON.stringify(data.user));
            initApp();
        } catch (err) { alert(err.message); }
    });

    document.getElementById('register-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const body = Object.fromEntries(formData.entries());
        try {
            const payload = {
                username: body.login,
                password: body.password,
                role: body.role === 'ADMIN' ? 'Commander' : 'Operative',
                sector: body.group_dept
            };
            await API.post('/api/auth/register', payload);
            alert('Profile Initialized. Link established.');
            state.authMode = 'login';
            render();
        } catch (err) { alert('Registration failed: ' + err.message); }
    });
}

function attachMainEvents() {
  document.querySelectorAll('.sidebar-icon[data-view]').forEach(icon => {
    icon.onclick = () => {
      state.activeView = icon.dataset.view;
      state.selectedTarget = null;
      render();
    };
  });

  document.getElementById('logout-btn').onclick = logout;

  document.querySelectorAll('[data-target-id]').forEach(el => {
    el.onclick = async () => {
        try {
            const type = el.dataset.targetType;
            const id = el.dataset.targetId;
            const nameEl = el.querySelector('.target-name');
            const name = nameEl ? nameEl.textContent : 'Unknown';
            
            state.selectedTarget = { type, id, name };
            // FIX: Добавляем кэширование или лоадер, чтобы не моргало
            state.messages = await API.get(`/api/chats/${type}/${id}/messages`);
            render();
            scrollToBottom();
        } catch (err) { console.error("Selection failed:", err); }
    };
  });

  document.getElementById('btn-create-group')?.addEventListener('click', async () => {
    const name = prompt('Unit Designation:');
    if (name) {
        await API.post('/api/groups', { name });
        state.chats = await API.get('/api/chats');
        render();
    }
  });

  document.getElementById('msg-form')?.addEventListener('submit', e => {
      e.preventDefault();
      sendMessage();
  });

  document.getElementById('btn-audio-call')?.addEventListener('click', () => startCall('audio'));
  document.getElementById('btn-video-call')?.addEventListener('click', () => startCall('video'));
  document.getElementById('end-call')?.addEventListener('click', endCall);
}

window.createSubgroup = async (groupId) => {
    const name = prompt('Sub-Unit Designation:');
    if (name) {
        await API.post(`/api/groups/${groupId}/subgroups`, { name });
        state.chats = await API.get('/api/chats');
        render();
    }
};

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    if (container) container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('msg-input');
    const content = input?.value.trim();
    if (!content || !state.selectedTarget) return;

    const payload = {
        type: 'message',
        targetType: state.selectedTarget.type,
        targetId: state.selectedTarget.id,
        content: content
    };

    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(payload));
        input.value = '';
    }
}

async function initApp() {
    try {
        // Очищаем старые данные перед загрузкой
        state.chats = await API.get('/api/chats');
        initWebSocket();
        render();
    } catch (err) {
        console.error("Init failed:", err);
        logout();
    }
}

function initWebSocket() {
    if (!state.token || !state.user || state.ws) return;
    
    // ВАЖНО: используем ws вместо wss, так как сервер на http
    state.ws = new WebSocket(`${WS_BASE_URL}/ws/${state.user.id}`);
    
    state.ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        handleSocketMessage(data);
    };

    state.ws.onclose = () => {
        state.ws = null;
        console.log("Link lost. Reconnecting...");
        setTimeout(initWebSocket, 3000);
    };
}

function handleSocketMessage(data) {
    if (data.type === 'message') {
        let isCurrent = false;
        if (state.selectedTarget?.type === 'p2p') {
            isCurrent = data.senderId === state.selectedTarget.id || data.senderId === state.user.id;
        } else {
            isCurrent = data.targetId === state.selectedTarget?.id;
        }
        
        if (isCurrent) {
            state.messages.push({
                id: data.id,
                sender_id: data.senderId,
                sender_name: data.senderName,
                content: data.content,
                timestamp: data.timestamp
            });
            render();
            scrollToBottom();
        }
    } else if (['call_offer', 'call_answer', 'ice_candidate'].includes(data.type)) {
        handleCallSignal(data);
    }
}

// --- WebRTC Logic ---
function attachMediaStream(elementId, stream) {
    setTimeout(() => {
        const el = document.getElementById(elementId);
        if (el) el.srcObject = stream;
    }, 200);
}

async function startCall(type = 'audio') {
    if (!state.selectedTarget || state.selectedTarget.type !== 'p2p') return;
    state.call = { active: true, type, remoteUser: state.selectedTarget, initiator: true };
    render();

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
        state.localStream = stream;
        attachMediaStream('local-video', stream);
        
        state.peer = new Peer({ initiator: true, trickle: true, stream });
        state.peer.on('signal', signal => {
            state.ws.send(JSON.stringify({ type: 'call_offer', targetId: state.selectedTarget.id, signal, callType: type }));
        });
        state.peer.on('stream', remoteStream => { 
            state.remoteStream = remoteStream; 
            render();
            attachMediaStream(type === 'video' ? 'remote-video' : 'remote-audio', remoteStream);
        });
    } catch (err) {
        alert("Tactical AV error: Requires HTTPS or explicit browser allowance.");
        endCall();
    }
}

function handleCallSignal(data) {
    if (data.type === 'call_offer') {
        if (confirm(`Incoming Link Request from ${data.senderName}. Accept?`)) {
            state.call = { active: true, type: data.callType, remoteUser: { id: data.senderId, name: data.senderName }, initiator: false };
            render();
            navigator.mediaDevices.getUserMedia({ audio: true, video: data.callType === 'video' }).then(stream => {
                state.localStream = stream;
                attachMediaStream('local-video', stream);
                state.peer = new Peer({ initiator: false, trickle: true, stream });
                state.peer.on('signal', signal => {
                    state.ws.send(JSON.stringify({ type: 'call_answer', targetId: data.senderId, signal }));
                });
                state.peer.on('stream', remoteStream => { 
                    state.remoteStream = remoteStream;
                    render();
                    attachMediaStream(data.callType === 'video' ? 'remote-video' : 'remote-audio', remoteStream);
                });
                state.peer.signal(data.signal);
            }).catch(endCall);
        }
    } else if (state.peer) {
        state.peer.signal(data.signal);
    }
}

function endCall() {
    if (state.localStream) state.localStream.getTracks().forEach(t => t.stop());
    if (state.peer) state.peer.destroy();
    state.call = { active: false, type: null, remoteUser: null, initiator: false };
    state.localStream = null;
    state.remoteStream = null;
    state.peer = null;
    render();
}

// Start Application
document.addEventListener('DOMContentLoaded', () => {
    if (state.token) initApp();
    else render();
});
