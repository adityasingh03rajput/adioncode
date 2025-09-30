// Search Component - username and face search
class SearchManager {
  constructor() {
    this.initUI();
  }

  initUI() {
    const html = `
      <div id="search-section">
        <div class="card">
          <div class="form-group">
            <label>Search by username or bio</label>
            <div class="inline-group">
              <input id="search-query" type="text" class="form-control" placeholder="Type username..." />
              <button id="search-users-btn" class="btn btn-primary">Search</button>
            </div>
          </div>
          <div style="text-align: center; margin: 1rem 0; color: var(--text-muted);">OR</div>
          <div class="form-group">
            <label>Search by face (image)</label>
            <input id="face-file" type="file" class="form-control" accept="image/*" />
            <button id="search-face-btn" class="btn btn-outline" style="margin-top: 0.5rem;">Find Matches</button>
          </div>
        </div>
        <div id="search-results" class="results"></div>
      </div>`;

    const container = document.getElementById('searchHost');
    if (container) container.innerHTML = html;

    document.getElementById('search-users-btn')?.addEventListener('click', () => this.searchUsers());
    document.getElementById('search-face-btn')?.addEventListener('click', () => this.searchByFace());
  }

  async searchUsers() {
    const q = document.getElementById('search-query').value.trim();
    if (!q) return this.toast('Enter a query');
    const API_BASE = window.API_BASE || 'https://google-8j5x.onrender.com/api';
    const token = localStorage.getItem('authToken');
    try {
      const res = await fetch(`${API_BASE}/search/users?query=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) this.renderUsers(data.users);
      else this.toast(data.error || 'Search failed');
    } catch {
      this.toast('Network error');
    }
  }

  async searchByFace() {
    const f = document.getElementById('face-file').files[0];
    if (!f) return this.toast('Choose an image');
    const form = new FormData();
    form.append('image', f);
    const API_BASE = window.API_BASE || 'https://google-8j5x.onrender.com/api';
    const token = localStorage.getItem('authToken');
    try {
      const res = await fetch(`${API_BASE}/search/face`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (data.success) this.renderUsers(data.matches, true);
      else this.toast(data.error || 'Face search failed');
    } catch {
      this.toast('Network error');
    }
  }

  renderUsers(users = [], showConfidence = false) {
    const root = document.getElementById('search-results');
    root.innerHTML = '';
    if (!users.length) {
      root.innerHTML = '<div class="muted">No results</div>';
      return;
    }
    users.forEach(u => {
      const card = document.createElement('div');
      card.className = 'user-card';
      card.innerHTML = `
        <div class="user-left">
          <div class="avatar">${u.profilePicture ? `<img src="${u.profilePicture}">` : '<i class="fas fa-user"></i>'}</div>
          <div>
            <div class="username">${u.username}</div>
            <div class="bio">${u.bio || ''}</div>
          </div>
        </div>
        <div class="user-right">
          ${showConfidence && u.matchConfidence ? `<div class="confidence">${(u.matchConfidence*100).toFixed(0)}%</div>` : ''}
          <button class="btn btn-sm" onclick="searchManager.viewProfile('${u.id}')">View</button>
          <button class="btn btn-sm btn-primary" onclick="searchManager.requestFollow('${u.id}')">Follow</button>
        </div>`;
      root.appendChild(card);
    });
  }

  async requestFollow(userId) {
    const API_BASE = window.API_BASE || 'https://google-8j5x.onrender.com/api';
    const token = localStorage.getItem('authToken');
    try {
      const res = await fetch(`${API_BASE}/follow/${userId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      this.toast(data.success ? 'Follow request sent' : (data.error || 'Failed'));
    } catch {
      this.toast('Network error');
    }
  }

  async viewProfile(userId) {
    const API_BASE = window.API_BASE || 'https://google-8j5x.onrender.com/api';
    const token = localStorage.getItem('authToken');
    try {
      const res = await fetch(`${API_BASE}/profile/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) console.log('Profile', data.profile);
      this.toast('Opened profile in console for now');
    } catch {
      this.toast('Network error');
    }
  }

  toast(msg) {
    if (window.showNotification) return window.showNotification(msg);
    console.log('[Toast]', msg);
  }
}

let searchManager;
document.addEventListener('DOMContentLoaded', () => {
  searchManager = new SearchManager();
});
