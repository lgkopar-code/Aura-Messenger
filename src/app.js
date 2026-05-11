import dayjs from "dayjs";
import Peer from "simple-peer";

// --- State ---
let state = {
  user: JSON.parse(localStorage.getItem('aura_user') || 'null'),
  token: localStorage.getItem('aura_token'),
  activeView: 'chat', 
  selectedTarget: null, // { type: 'p2p'|'group'|'subgroup', id: string, name: string }
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
    try {
      const res = await fetch(url, {
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
      console.error(`API Error (${url}):`, err);
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
  if (!state.token) {
    app.innerHTML = renderAuth();
    attachAuthEvents();
  } else {
    app.innerHTML = renderMain();
    attachMainEvents();
    lucide.createIcons();
  }
}

function renderAuth() {
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
                <button id="show-register" class="text-text-secondary text-sm hover:text-white transition-colors flex items-center justify-center gap-2 mx-auto"><i data-lucide="user-plus" size="16"></i> Request Clearance</button>
            </div>
        </div>
      </div>
    </div>
  `;
}

function renderRegister() {
    return `
        <div class="text-center mb-8">
          <h2 class="text-2xl font-bold text-white tracking-tight uppercase">Registration</h2>
          <p class="text-accent-emerald text-[10px] uppercase tracking-widest mt-1">Initialize New Neural Profile</p>
        </div>
        <form id="register-form" class="space-y-3">
          <input type="text" name="login" placeholder="Codename" class="w-full bg-black/40 border border-white/10 p-3.5 rounded-2xl text-white focus:border-accent-emerald outline-none text-sm" required />
          <input type="password" name="password" placeholder="Pass-key" class="w-full bg-black/40 border border-white/10 p-3.5 rounded-2xl text-white focus:border-accent-emerald outline-none text-sm" required />
          <input type="text" name="full_name" placeholder="Official Identity" class="w-full bg-black/40 border border-white/10 p-3.5 rounded-2xl text-white focus:border-accent-emerald outline-none text-sm" required />
          
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
            <button id="show-login" class="text-text-secondary text-xs hover:text-white transition-colors underline decoration-accent-emerald/30">Already Synchronized? Return to Login</button>
        </div>
    `;
}

function renderMain() {
  return `
    <div class="flex h-screen bg-[#060b0d]">
      <!-- 1. Left Sidebar (Icons) -->
      <nav class="w-[72px] glass-panel border-r border-white/5 flex flex-col items-center py-6 gap-4 z-30">
        <div class="w-10 h-10 bg-accent-emerald rounded-xl flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(0,255,136,0.3)]">
           <i data-lucide="shield" size="24" class="text-black"></i>
        </div>
        <div class="sidebar-icon ${state.activeView === 'chat' ? 'active' : ''}" data-view="chat">
           <i data-lucide="message-circle" size="24"></i>
           <span>Chats</span>
        </div>
        <div class="sidebar-icon ${state.activeView === 'teams' ? 'active' : ''}" data-view="teams">
           <i data-lucide="users" size="24"></i>
           <span>Teams</span>
        </div>
        <div class="sidebar-icon ${state.activeView === 'intelligence' ? 'active' : ''}" data-view="intelligence">
           <i data-lucide="radio" size="24"></i>
           <span>Intel</span>
        </div>
        <div class="mt-auto sidebar-icon group" id="logout-btn">
           <i data-lucide="log-out" size="24" class="group-hover:text-red-400"></i>
           <span class="group-hover:text-red-400">Exit</span>
        </div>
      </nav>

      <!-- 2. Sub-Sidebar (Lists) -->
      <aside class="w-[340px] glass-panel border-r border-white/5 flex flex-col z-20">
        ${renderSubSidebar()}
      </aside>

      <!-- 3. Main Content (Chat/Feature) -->
      <main class="flex-1 flex flex-col relative z-10">
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
      <div class="p-6 border-b border-white/5 space-y-4">
        <div class="flex justify-between items-center">
            <h2 class="text-xl font-black text-white uppercase italic tracking-wider">Messages</h2>
            <button class="w-8 h-8 rounded-lg bg-accent-emerald/10 text-accent-emerald flex items-center justify-center hover:bg-accent-emerald/20 transition-all" id="new-chat"><i data-lucide="plus" size="18"></i></button>
        </div>
        <div class="relative group">
            <i data-lucide="search" size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-accent-emerald transition-colors"></i>
            <input type="text" placeholder="Search operatives..." class="w-full bg-black/40 border border-white/5 p-2.5 pl-9 rounded-xl text-xs text-white focus:border-accent-emerald/30 outline-none transition-all" />
        </div>
      </div>
      <div class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
        ${state.chats.p2p.length ? state.chats.p2p.map(p => `
          <div class="p-3 rounded-2xl flex items-center gap-4 cursor-pointer transition-all hover:bg-white/5 ${state.selectedTarget?.type === 'p2p' && state.selectedTarget?.id === p.id ? 'bg-accent-emerald/10 border border-accent-emerald/20 shadow-[0_0_20px_rgba(0,255,136,0.05)]' : ''}" data-target-type="p2p" data-target-id="${p.id}">
            <div class="relative shrink-0">
                <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-panel-bg to-black border border-white/10 flex items-center justify-center font-black text-accent-emerald text-lg shadow-xl">
                  ${(p.name || 'U')[0].toUpperCase()}
                </div>
                ${p.online ? '<div class="absolute -bottom-0.5 -right-0.5 status-dot status-online"></div>' : '<div class="absolute -bottom-0.5 -right-0.5 status-dot bg-gray-600"></div>'}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-start mb-0.5">
                <p class="font-bold text-white truncate text-sm target-name">${p.name}</p>
                <span class="text-[9px] text-text-secondary font-medium">11:42</span>
              </div>
              <p class="text-[11px] text-text-secondary truncate leading-tight">${p.online ? '<span class="text-accent-emerald/80 font-bold uppercase text-[9px] tracking-tighter">Link Established</span>' : 'Awaiting sync...'}</p>
            </div>
            ${Math.random() > 0.7 ? '<div class="w-5 h-5 rounded-full bg-accent-emerald text-black text-[10px] font-black flex items-center justify-center shadow-[0_0_10px_#00ff88]">2</div>' : ''}
          </div>
        `).join('') : emptyState('Neural network isolated')}
      </div>
    `;
  }
  if (state.activeView === 'teams') {
    return `
      <div class="p-5 border-b border-white/5 flex justify-between items-center h-[72px] bg-black/20 backdrop-blur-md">
        <h2 class="text-sm font-black text-white tracking-widest uppercase italic">Factions & Units</h2>
        ${state.user?.role === 'Commander' ? `<button class="p-2 bg-accent-emerald/10 text-accent-emerald hover:bg-accent-emerald rounded-lg hover:text-black transition-all shadow-sm" id="btn-create-group"><i data-lucide="plus" size="16"></i></button>` : ''}
      </div>
      <div class="p-3 space-y-2 overflow-y-auto flex-1 custom-scrollbar">
        ${state.chats.groups.length ? state.chats.groups.map(g => `
            <div class="bg-white/5 rounded-2xl border border-white/5 overflow-hidden">
                <div class="p-3 cursor-pointer hover:bg-white/10 transition-all flex items-center gap-3 ${state.selectedTarget?.type === 'group' && state.selectedTarget?.id === g.id ? 'bg-accent-emerald/10 border-l-4 border-accent-emerald' : 'border-l-4 border-transparent'}" data-target-type="group" data-target-id="${g.id}">
                    <div class="w-8 h-8 rounded-lg bg-accent-emerald/20 flex items-center justify-center text-xs font-black text-accent-emerald shadow-inner">${(g.name || 'G')[0].toUpperCase()}</div>
                    <div class="flex-1 min-w-0 flex justify-between items-center text-gray-200">
                        <span class="font-bold text-xs uppercase tracking-wider truncate target-name">${g.name || 'Unnamed'}</span>
                        ${state.user?.role === 'Commander' ? `<button class="p-1 hover:text-accent-emerald opacity-50 hover:opacity-100 transition-opacity" onclick="event.stopPropagation(); createSubgroup('${g.id}')"><i data-lucide="plus-circle" size="14"></i></button>` : ''}
                    </div>
                </div>
                
                ${g.subgroups.length > 0 ? `
                <div class="pl-11 pr-3 pb-3 pt-1 space-y-1 bg-black/20">
                    ${g.subgroups.map(s => `
                        <div class="p-2 rounded-lg cursor-pointer hover:bg-white/10 transition-all flex items-center gap-2 text-xs ${state.selectedTarget?.type === 'subgroup' && state.selectedTarget?.id === s.id ? 'text-accent-emerald font-black bg-accent-emerald/5' : 'text-gray-400 font-medium'}" data-target-type="subgroup" data-target-id="${s.id}">
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
        <div class="flex-1 flex flex-col items-center justify-center relative overflow-hidden bg-gradient-to-b from-[#060b0d] to-black">
            <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,255,136,0.05),transparent_70%)]"></div>
            <div class="w-32 h-32 bg-white/5 rounded-[32px] flex items-center justify-center mb-8 rotate-12 glow-emerald border border-white/10">
                <i data-lucide="radio" size="64" class="text-accent-emerald -rotate-12"></i>
            </div>
            <h1 class="text-5xl font-black text-white uppercase italic tracking-[0.3em] mb-4">Nexus</h1>
            <p class="uppercase tracking-[0.6em] font-black text-accent-emerald text-[10px] bg-accent-emerald/10 px-4 py-1 rounded-full border border-accent-emerald/20">Awaiting tactical link...</p>
        </div>
    `;
  }

  return `
    <header class="p-6 border-b border-white/5 flex items-center justify-between glass-panel sticky top-0 z-20 h-[80px]">
        <div class="flex items-center gap-4">
            <div class="relative">
                <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-accent-emerald to-[#00ff88] flex items-center justify-center text-black font-black text-xl shadow-lg">
                    ${(state.selectedTarget.name || 'T')[0].toUpperCase()}
                </div>
                <div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-accent-emerald border-2 border-[#060b0d] shadow-[0_0_10px_#00ff88]"></div>
            </div>
            <div>
                <h3 class="font-black text-white text-base tracking-tight italic">${state.selectedTarget.name || 'Target'}</h3>
                <p class="text-[10px] text-accent-emerald font-black uppercase tracking-widest flex items-center gap-1.5 mt-0.5">
                    <span class="relative flex h-2 w-2">
                      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-emerald opacity-75"></span>
                      <span class="relative inline-flex rounded-full h-2 w-2 bg-accent-emerald shadow-[0_0_5px_#00ff88]"></span>
                    </span>
                    Secure Link
                </p>
            </div>
        </div>
        <div class="flex items-center gap-2">
            <button class="w-10 h-10 rounded-xl hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-accent-emerald transition-all" id="btn-audio-call"><i data-lucide="phone" size="20"></i></button>
            <button class="w-10 h-10 rounded-xl hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-accent-emerald transition-all" id="btn-video-call"><i data-lucide="video" size="20"></i></button>
            <div class="w-px h-6 bg-white/10 mx-2"></div>
            <button class="w-10 h-10 rounded-xl hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-accent-emerald transition-all"><i data-lucide="search" size="20"></i></button>
        </div>
    </header>

    <div class="flex-1 overflow-y-auto p-8 space-y-4 custom-scrollbar bg-[#0a0f16]" id="messages-container">
        ${state.messages.map((m, i) => {
            const isMe = m.sender_id === state.user.id;
            return `
                <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-slide-up">
                    ${!isMe ? `<span class="text-[11px] font-black text-white/40 mb-1 ml-1 uppercase tracking-tighter">${m.sender_name}</span>` : ''}
                    <div class="max-w-[75%] px-5 py-3 text-sm leading-relaxed shadow-md ${
                        isMe 
                        ? 'bg-accent-emerald text-black rounded-2xl rounded-tr-sm font-bold shadow-[0_4px_15px_rgba(0,255,136,0.1)]' 
                        : 'bg-[#1b2126] text-white rounded-2xl rounded-tl-sm border border-white/5'
                    }">
                        ${m.content}
                    </div>
                    <span class="text-[9px] text-white/20 font-mono mt-1 ${isMe ? 'mr-1' : 'ml-1'} uppercase">${dayjs(m.timestamp).format('HH:mm')}</span>
                </div>
            `;
        }).join('')}
    </div>

    <footer class="p-6 bg-gradient-to-t from-black to-transparent backdrop-blur-xl border-t border-white/5">
        <form id="msg-form" class="max-w-4xl mx-auto flex items-center gap-4">
            <label class="w-14 h-14 flex items-center justify-center bg-white/5 rounded-2xl hover:bg-white/10 text-white/40 cursor-pointer transition-all border border-white/10 shrink-0">
                <i data-lucide="paperclip" size="24"></i>
                <input type="file" id="file-input" class="hidden" />
            </label>
            <div class="flex-1 relative chat-input-area border-none bg-white/5 rounded-2xl">
                <textarea id="msg-input" placeholder="Transmit message..." rows="1" class="w-full bg-transparent border-none px-5 py-4 rounded-xl text-white placeholder-white/20 outline-none resize-none min-h-[56px] max-h-[150px] text-sm"></textarea>
            </div>
            <button type="submit" class="w-14 h-14 bg-accent-emerald text-black rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(0,255,136,0.3)] hover:brightness-110 active:scale-95 transition-all glow-emerald">
                <i data-lucide="send" size="24" class="translate-x-0.5"></i>
            </button>
        </form>
    </footer>
  `;
}

function renderTasksView() {
    return `
        <div class="flex-1 p-10 overflow-y-auto">
            <div class="max-w-4xl mx-auto space-y-10">
                <div class="flex justify-between items-end">
                    <div>
                        <h1 class="text-4xl font-bold text-accent-gold">Academic Tasks</h1>
                        <p class="text-text-secondary text-sm mt-2">Manage your curriculum and assignments</p>
                    </div>
                    <button class="bg-accent-gold text-bg-deep px-6 py-2 rounded-xl font-bold text-sm uppercase tracking-widest">New Assignment</button>
                </div>

                <div class="grid grid-cols-3 gap-6">
                    ${['To Do', 'In Progress', 'Done'].map(status => `
                        <div class="space-y-4">
                            <h3 class="text-xs font-bold uppercase tracking-[0.2em] text-text-secondary border-b border-panel-green pb-2">${status}</h3>
                            <div class="space-y-3">
                                ${status === 'To Do' ? `
                                    <div class="glass-panel p-4 rounded-xl space-y-2 border-l-4 border-l-red-500 hover:scale-[1.02] transition-transform cursor-pointer">
                                        <p class="text-xs font-bold">Physics Lab Report: Newton's Laws</p>
                                        <p class="text-[10px] text-text-secondary">Due: May 15, 2026</p>
                                        <div class="flex gap-1 mt-2">
                                            <span class="px-2 py-0.5 rounded bg-panel-green text-[8px] text-accent-gold uppercase font-bold">HIGH PRIORITY</span>
                                        </div>
                                    </div>
                                    <div class="glass-panel p-4 rounded-xl space-y-2 border-l-4 border-l-blue-500 hover:scale-[1.02] transition-transform cursor-pointer">
                                        <p class="text-xs font-bold">Math Quiz Prep</p>
                                        <p class="text-[10px] text-text-secondary">Due: May 18, 2026</p>
                                    </div>
                                ` : `<div class="p-10 border border-dashed border-panel-green rounded-xl text-center text-[10px] text-text-secondary">Empty</div>`}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderCalendarView() {
    return `
        <div class="flex-1 flex flex-col items-center justify-center">
            <div class="glass-panel p-10 rounded-2xl border-2 border-accent-gold/20 text-center space-y-6">
                <h2 class="text-3xl font-black text-accent-gold uppercase tracking-[0.3em]">Full Calendar View</h2>
                <p class="text-text-secondary max-w-md">The master academic calendar is currently being synchronized with the university data centers.</p>
                <div class="grid grid-cols-7 gap-1 w-full max-w-sm pt-4">
                    ${Array.from({length: 31}).map((_, i) => `<div class="aspect-square flex items-center justify-center border border-panel-green/30 text-[10px] ${i === 10 ? 'bg-accent-gold text-bg-deep font-bold' : ''}">${i+1}</div>`).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderFileMessage(m) {
    const ext = m.file_url.split('.').pop().toLowerCase();
    if (['jpg','jpeg','png','webp','gif'].includes(ext)) {
        return `<img src="${m.file_url}" class="rounded-lg max-w-full hover:scale-105 transition-transform cursor-pointer" />`;
    }
    return `
        <div class="flex items-center gap-3 bg-black/20 p-2 rounded-lg border border-white/5">
            <i data-lucide="file-text" class="text-accent-gold"></i>
            <div class="overflow-hidden">
                <p class="text-sm font-bold truncate">${m.content || 'File'}</p>
                <a href="${m.file_url}" download class="text-[10px] text-accent-gold hover:underline">Download File</a>
            </div>
        </div>
    `;
}

function renderRightPanel() {
    const roleLabel = state.user?.role === 'ADMIN' ? 'COMMANDER' : 'OPERATIVE';

    return `
        <div class="p-6 flex flex-col items-center">
            <div class="w-24 h-24 rounded-2xl bg-panel-green border border-accent-gold/30 flex items-center justify-center text-3xl font-bold text-accent-gold mb-4 relative">
                ${state.user?.username ? state.user.username[0].toUpperCase() : 'U'}
                <div class="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-bg-deep border border-panel-green flex items-center justify-center text-[10px]"><i data-lucide="camera" size="12"></i></div>
            </div>
            <h2 class="text-xl font-bold text-center">${state.user?.username || 'Unit'}</h2>
            <div class="mt-2 text-center">
                <p class="text-accent-gold font-mono text-[11px] tracking-widest uppercase font-bold">${state.user?.role || 'OPERATIVE'}</p>
                <p class="text-text-secondary font-mono text-[9px] uppercase tracking-tighter mt-1 border-t border-panel-green pt-1 flex justify-between"><span>UID:</span> <span>${state.user?.id.split('-')[0]}...</span></p>
                <p class="text-text-secondary font-bold text-[9px] uppercase tracking-tighter mt-0.5 flex justify-between"><span>SECTOR:</span> <span>${state.user?.sector || 'N/A'}</span></p>
            </div>
            
            <div class="w-full mt-10 space-y-6">
                <div class="space-y-2">
                    <p class="text-[10px] font-bold text-text-secondary uppercase">Quick Access</p>
                    <div class="grid grid-cols-2 gap-2">
                        <button class="utility-btn p-4 bg-panel-green/20 rounded-xl hover:bg-panel-green/40 transition-all border border-panel-green/20 text-center flex flex-col items-center gap-2" data-type="Courses">
                            <i data-lucide="book" class="text-accent-gold" size="20"></i>
                            <span class="text-[10px] font-medium">Courses</span>
                        </button>
                        <button class="utility-btn p-4 bg-panel-green/20 rounded-xl hover:bg-panel-green/40 transition-all border border-panel-green/20 text-center flex flex-col items-center gap-2" data-type="Grades">
                            <i data-lucide="award" class="text-accent-gold" size="20"></i>
                            <span class="text-[10px] font-medium">Grades</span>
                        </button>
                    </div>
                </div>

                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <p class="text-[10px] font-bold text-text-secondary uppercase">Global Intel Feed</p>
                        <span class="text-[8px] text-accent-gold cursor-pointer hover:underline">View All</span>
                    </div>
                    <div class="p-4 glass-panel rounded-xl space-y-2 border border-panel-green/30">
                        <p class="text-[11px] font-bold leading-tight">Quantum Mechanics 101 lecture uploaded</p>
                        <p class="text-[9px] text-text-secondary flex items-center gap-1"><i data-lucide="clock" size="10"></i> 2 hours ago</p>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderCallOverlay() {
    return `
        <div class="fixed inset-0 z-[100] bg-bg-deep/95 backdrop-blur-xl flex flex-col items-center justify-center animate-slide-up">
            <div class="w-32 h-32 rounded-full border-4 border-accent-gold flex items-center justify-center p-1 mb-8 animate-pulse">
                <div class="w-full h-full rounded-full bg-panel-green flex items-center justify-center text-4xl font-bold text-accent-gold">
                    ${state.call.remoteUser?.full_name ? state.call.remoteUser.full_name[0] : 'U'}
                </div>
            </div>
            <h2 class="text-3xl font-bold text-accent-gold mb-2">${state.call.type === 'video' ? 'Video' : 'Audio'} Call</h2>
            <p class="text-text-secondary animate-pulse uppercase tracking-[0.2em] text-xs">Calling ${state.call.remoteUser?.full_name}...</p>
            
            <div class="mt-20 flex gap-10">
                <button id="end-call" class="w-20 h-20 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all"><i data-lucide="phone-off" size="32"></i></button>
                <div class="w-20 h-20 rounded-full bg-panel-green text-white flex items-center justify-center shadow-lg"><i data-lucide="mic-off" size="32"></i></div>
            </div>
        </div>
    `;
}

// --- Logic ---
async function attachAuthEvents() {
    const attachLogin = () => {
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

      document.getElementById('show-register')?.addEventListener('click', () => {
          const container = document.getElementById('auth-forms');
          if (container) {
              container.innerHTML = renderRegister();
              attachRegister();
          }
      });
    };

    const attachRegister = () => {
        document.getElementById('role-select')?.addEventListener('change', (e) => {
            const input = document.getElementById('role-detail-input');
            if (input) {
                input.placeholder = e.target.value === 'ADMIN' ? 'Command (e.g. HQ)' : 'Sector (e.g. North)';
            }
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
                const data = await API.post('/api/auth/register', payload);
                if (data) {
                    alert('Profile Initialized. Please synchronize login.');
                    const container = document.getElementById('auth-forms');
                    if (container) {
                        container.innerHTML = `
                            <form id="login-form" class="space-y-4">
                              <input type="text" name="login" value="${body.login}" placeholder="Email / Login" class="w-full bg-bg-deep border border-panel-green p-4 rounded-xl text-text-primary focus:border-accent-gold outline-none" required />
                              <input type="password" name="password" placeholder="Password" class="w-full bg-bg-deep border border-panel-green p-4 rounded-xl text-text-primary focus:border-accent-gold outline-none" required />
                              <button type="submit" class="w-full bg-accent-gold text-bg-deep font-bold p-4 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-widest">Enter Platform</button>
                            </form>
                            <div class="mt-6 text-center">
                                <button id="show-register" class="text-text-secondary text-sm hover:text-accent-gold transition-colors">New student? Access credentials here</button>
                            </div>
                        `;
                        attachLogin();
                    }
                } else {
                    alert(data.error);
                }
            } catch (err) { alert('Registration failed'); }
        });

        document.getElementById('show-login')?.addEventListener('click', () => {
            const container = document.getElementById('auth-forms');
            if (container) {
                container.innerHTML = `
                    <form id="login-form" class="space-y-4">
                      <input type="text" name="login" placeholder="Email / Login" class="w-full bg-bg-deep border border-panel-green p-4 rounded-xl text-text-primary focus:border-accent-gold outline-none" required />
                      <input type="password" name="password" placeholder="Password" class="w-full bg-bg-deep border border-panel-green p-4 rounded-xl text-text-primary focus:border-accent-gold outline-none" required />
                      <button type="submit" class="w-full bg-accent-gold text-bg-deep font-bold p-4 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-widest">Enter Platform</button>
                    </form>
                    <div class="mt-6 text-center">
                        <button id="show-register" class="text-text-secondary text-sm hover:text-accent-gold transition-colors">New student? Access credentials here</button>
                    </div>
                `;
                attachLogin();
            }
        });
    };

    attachLogin();
}

function attachMainEvents() {
  // Sidebar navigation
  document.querySelectorAll('.sidebar-icon[data-view]').forEach(icon => {
    icon.onclick = () => {
      state.activeView = icon.dataset.view;
      state.selectedTarget = null;
      render();
    };
  });

  document.getElementById('logout-btn').onclick = () => {
    localStorage.removeItem('aura_token');
    state.token = null;
    state.user = null;
    render();
  };

  // Chat selection (p2p, groups, subgroups)
  document.querySelectorAll('[data-target-id]').forEach(el => {
    el.onclick = async () => {
        try {
            const type = el.dataset.targetType;
            const id = el.dataset.targetId;
            const nameEl = el.querySelector('.target-name') || el.querySelector('p, span');
            const name = nameEl ? nameEl.textContent : 'Unknown';
            
            state.selectedTarget = { type, id, name };
            state.messages = await API.get(`/api/chats/${type}/${id}/messages`);
            
            render();
            const container = document.getElementById('messages-container');
            if (container) container.scrollTop = container.scrollHeight;
        } catch (err) {
            console.error("Selection failed:", err);
        }
    };
  });

  // Admin Actions
  document.getElementById('btn-create-group')?.addEventListener('click', async () => {
    const name = prompt('Enter Faction/Group Name:');
    if (name) {
        await API.post('/api/groups', { name });
        state.chats = await API.get('/api/chats');
        render();
    }
  });

  document.getElementById('btn-add-member')?.addEventListener('click', async () => {
    const userId = prompt('Enter User ID to add:');
    if (userId && state.selectedTarget) {
        await API.post(`/api/groups/${state.selectedTarget.id}/members`, { user_id: userId });
        alert('Unit synchronized to tactical channel.');
    }
  });

  // Message Form
  document.getElementById('msg-form')?.addEventListener('submit', e => {
      e.preventDefault();
      sendMessage();
  });

  document.getElementById('msg-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
      }
  });

  // File Upload
  document.getElementById('file-input')?.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${state.token}` },
          body: formData
      });
      const data = await res.json();
      sendMessage(data.url, file.name);
  });

  // Call events
  document.getElementById('btn-audio-call')?.addEventListener('click', () => startCall('audio'));
  document.getElementById('btn-video-call')?.addEventListener('click', () => startCall('video'));
  document.getElementById('end-call')?.addEventListener('click', () => {
      state.call.active = false;
      render();
  });

  document.querySelectorAll('.utility-btn').forEach(btn => {
      btn.onclick = () => {
          const type = btn.dataset.type;
          alert(`Accessing ${type} database... Permission Denied: Higher clearance required.`);
      };
  });
}

window.createSubgroup = async (groupId) => {
    const name = prompt('Enter Subgroup Name:');
    if (name) {
        await API.post(`/api/groups/${groupId}/subgroups`, { name });
        state.chats = await API.get('/api/chats');
        render();
    }
};

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

function startCall(type) {
    state.call = { active: true, type, remoteUser: state.selectedTarget };
    render();
    state.ws.send(JSON.stringify({
        type: 'call_signal',
        targetId: state.selectedTarget.id,
        signalType: 'init',
        callType: type,
        senderId: state.user.id,
        senderName: state.user.full_name
    }));
}

async function loadSchedule() {
    try {
        const data = await API.get('/api/schedule');
        const container = document.getElementById('schedule-list');
        if (container) {
            container.innerHTML = data.map(s => `
                <div class="p-3 bg-bg-deep/40 rounded-lg border border-panel-green/20 flex flex-col gap-1">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold text-accent-gold">${s.time}</span>
                        <span class="text-[9px] px-1 bg-accent-gold/10 text-accent-gold rounded border border-accent-gold/20 font-bold uppercase">${s.room}</span>
                    </div>
                    <p class="text-xs font-semibold truncate">${s.subject}</p>
                    <p class="text-[9px] text-text-secondary truncate italic">${s.teacher}</p>
                </div>
            `).join('');
        }
    } catch (err) {
        const container = document.getElementById('schedule-list');
        if (container) container.innerHTML = '<p class="text-[10px] text-red-500">Sync Error</p>';
    }
}

async function initApp() {
    try {
        state.chats = await API.get('/api/chats');
        initWebSocket();
        render();
    } catch (err) {
        console.error("Initialization failed:", err);
        logout();
    }
}

function initWebSocket() {
    if (!state.token || !state.user) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.ws = new WebSocket(`${protocol}//${window.location.host}/ws/${state.user.id}`);
    
    state.ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        handleSocketMessage(data);
    };

    state.ws.onclose = () => {
        console.log("WS closed. Reconnecting...");
        setTimeout(initWebSocket, 3000);
    };
}

function handleSocketMessage(data) {
    if (data.type === 'message') {
        const isCurrent = 
            (state.selectedTarget?.type === 'p2p' && (data.senderId === state.selectedTarget.id || data.senderId === state.user.id)) ||
            (state.selectedTarget?.type === 'group' && data.targetId === state.selectedTarget.id) ||
            (state.selectedTarget?.type === 'subgroup' && data.targetId === state.selectedTarget.id);
        
        if (isCurrent) {
            state.messages.push({
                id: data.id,
                sender_id: data.senderId,
                sender_name: data.senderName,
                content: data.content,
                timestamp: data.timestamp
            });
            render();
            const container = document.getElementById('messages-container');
            if (container) container.scrollTop = container.scrollHeight;
        }
    } else if (['call_offer', 'call_answer', 'ice_candidate'].includes(data.type)) {
        handleCallSignal(data);
    }
}

async function startCall(type = 'audio') {
    if (!state.selectedTarget || state.selectedTarget.type !== 'p2p') return;
    state.call = { active: true, type, remoteUser: state.selectedTarget, initiator: true };
    render();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
    state.localStream = stream;
    
    state.peer = new Peer({ initiator: true, trickle: true, stream });
    state.peer.on('signal', signal => {
        state.ws.send(JSON.stringify({ type: 'call_offer', targetId: state.selectedTarget.id, signal, callType: type }));
    });
    state.peer.on('stream', stream => { state.remoteStream = stream; console.log("Remote stream received"); });
}

function handleCallSignal(data) {
    if (data.type === 'call_offer') {
        if (confirm(`Incoming call from ${data.senderName}. Accept?`)) {
            state.call = { active: true, type: data.callType, remoteUser: { id: data.senderId, name: data.senderName }, initiator: false };
            render();
            navigator.mediaDevices.getUserMedia({ audio: true, video: data.callType === 'video' }).then(stream => {
                state.localStream = stream;
                state.peer = new Peer({ initiator: false, trickle: true, stream });
                state.peer.on('signal', signal => {
                    state.ws.send(JSON.stringify({ type: 'call_answer', targetId: data.senderId, signal }));
                });
                state.peer.on('stream', stream => { state.remoteStream = stream; });
                state.peer.signal(data.signal);
            });
        }
    } else if (state.peer) {
        state.peer.signal(data.signal);
    }
}

// Start
document.addEventListener('DOMContentLoaded', () => {
    if (state.token) initApp();
    else render();
});
