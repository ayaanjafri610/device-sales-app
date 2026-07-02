const API = '/api';
let token = localStorage.getItem('dst_token') || '';
let currentUser = null;
let currentFilters = { search: '', status: '' };
let attachedPhotoData = null; // Holds the compressed base64 image
let currentUpdateId = null;
let rawData = [];

// ── Auth & API ────────────────────────────────────────────────────
function logout() { localStorage.removeItem('dst_token'); window.location.href = 'index.html'; }
async function checkAuth() {
  if (!token) return logout();
  try {
    const res = await fetch(API + '/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) throw new Error();
    const data = await res.json();
    currentUser = data.user;
    initPage();
  } catch (err) { logout(); }
}
async function apiFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + url, { ...options, headers });
  if (res.status === 401) { logout(); return null; }
  return res;
}

function esc(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}
function showError(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg; el.style.display = 'block';
}

// ── Init ──────────────────────────────────────────────────────────
async function initPage() {
  document.getElementById('user-name-chip').innerHTML = 
    `${currentUser.name || currentUser.email}<span class="role-badge ${currentUser.role}">${currentUser.role}</span>`;
  
  // Setup filters
  document.getElementById('f-search').addEventListener('input', () => {
    currentFilters.search = document.getElementById('f-search').value.trim().toLowerCase();
    loadStock();
  });
  document.getElementById('f-status').addEventListener('change', () => {
    currentFilters.status = document.getElementById('f-status').value;
    loadStock();
  });

  // Setup photo upload handler
  setupPhotoUpload();

  loadStock();
}

// ── Data Loading ──────────────────────────────────────────────────
async function loadStock() {
  const tbody = document.getElementById('stock-tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="no-data">Loading...</td></tr>';
  try {
    const res = await apiFetch('/stock');
    if (!res) return;
    const { data, error } = await res.json();
    if (error) { tbody.innerHTML = `<tr><td colspan="8" class="no-data error">Error: ${esc(error)}</td></tr>`; return; }
    
    rawData = data || [];
    // Apply client-side filters
    let filtered = rawData;
    if (currentFilters.status) {
      filtered = filtered.filter(r => r.status === currentFilters.status);
    }
    if (currentFilters.search) {
      filtered = filtered.filter(r => (r.item_name || '').toLowerCase().includes(currentFilters.search));
    }

    renderTable(filtered);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="no-data error">Network error</td></tr>`;
  }
}

function renderTable(rows) {
  const tbody = document.getElementById('stock-tbody');
  document.getElementById('table-count').textContent = `${rows.length} item${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="no-data">No stock needs found.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r, i) => {
    const date = new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const updatedDate = new Date(r.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const createdByName = (r.users && r.users.name) ? r.users.name : '—';
    
    // Format Status Badge
    let statusLabel = 'Out of Stock';
    if (r.status === 'order_placed') statusLabel = 'Order Placed';
    if (r.status === 'order_received') statusLabel = 'Order Received';
    if (r.status === 'cancelled') statusLabel = 'Cancelled';
    const statusCell = `<span class="badge ${r.status}">${statusLabel}</span>`;

    // Format Photo
    let photoCell = '—';
    if (r.photo_data) {
      photoCell = `<img class="photo-thumb" src="${r.photo_data}" onclick="zoomPhoto('${esc(r.photo_data)}')" title="Click to view" />`;
    }

    // Remove actions inline, instead row is clickable
    return `<tr onclick="openStockDetailModal('${r.id}')" style="cursor:pointer;">
      <td>${i + 1}</td>
      <td>${date}</td>
      <td>${updatedDate}</td>
      <td><strong>${esc(r.item_name)}</strong></td>
      <td>${esc(r.quantity)}</td>
      <td>${photoCell}</td>
      <td>${statusCell}</td>
      <td>${esc(createdByName)}</td>
    </tr>`;
  }).join('');
}

function resetFilters() {
  document.getElementById('f-search').value = '';
  document.getElementById('f-status').value = '';
  currentFilters = { search: '', status: '' };
  loadStock();
}

// ── Modals & Actions ──────────────────────────────────────────────
function openStockModal() {
  document.getElementById('form-error').style.display = 'none';
  document.getElementById('f-preset-item').value = '';
  document.getElementById('f-item-name').value = '';
  document.getElementById('f-quantity').value = 1;
  clearPhoto();
  document.getElementById('stock-modal-overlay').classList.add('open');
}
function closeStockModal() { document.getElementById('stock-modal-overlay').classList.remove('open'); }

async function saveStock() {
  const item_name = document.getElementById('f-item-name').value.trim();
  const quantity = parseInt(document.getElementById('f-quantity').value) || 1;
  
  if (!item_name) return showError('Item name is required.');

  const btn = document.getElementById('save-btn');
  btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;

  try {
    const body = { item_name, quantity, photo_data: attachedPhotoData };
    const res = await apiFetch('/stock', { method: 'POST', body: JSON.stringify(body) });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Save failed.'); return; }

    closeStockModal();
    showToast('Stock need added!', 'success');
    loadStock();
  } catch (err) {
    showError('Network error: ' + err.message);
  } finally {
    btn.innerHTML = 'Save'; btn.disabled = false;
  }
}

// ── Detail Modal ──────────────────────────────────────────────────
function openStockDetailModal(id) {
  const item = rawData.find(r => r.id === id);
  if (!item) return;
  
  currentUpdateId = id;
  const date = new Date(item.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const updatedDate = new Date(item.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const createdByName = (item.users && item.users.name) ? item.users.name : '—';
  
  let statusLabel = 'Out of Stock';
  if (item.status === 'order_placed') statusLabel = 'Order Placed';
  if (item.status === 'order_received') statusLabel = 'Order Received';
  if (item.status === 'cancelled') statusLabel = 'Cancelled';
  
  document.getElementById('d-item-name').textContent = item.item_name;
  document.getElementById('d-quantity').textContent = item.quantity;
  document.getElementById('d-added-by').textContent = createdByName;
  document.getElementById('d-dates').textContent = `Added: ${date}  •  Updated: ${updatedDate}`;
  document.getElementById('d-status').innerHTML = `<span class="badge ${item.status}">${statusLabel}</span>`;
  
  if (item.photo_data) {
    document.getElementById('d-photo').src = item.photo_data;
    document.getElementById('d-photo-container').style.display = 'block';
  } else {
    document.getElementById('d-photo').src = '';
    document.getElementById('d-photo-container').style.display = 'none';
  }
  
  document.getElementById('d-delete-btn').onclick = () => { closeStockDetailModal(); deleteStock(id); };
  document.getElementById('d-update-btn').onclick = () => { closeStockDetailModal(); openStatusModal(id, item.status); };
  
  document.getElementById('stock-detail-overlay').classList.add('open');
}

function closeStockDetailModal() {
  document.getElementById('stock-detail-overlay').classList.remove('open');
  currentUpdateId = null;
}

function openStatusModal(id, currentStatus) {
  currentUpdateId = id;
  document.getElementById('u-status').value = currentStatus;
  document.getElementById('status-modal-overlay').classList.add('open');
}
function closeStatusModal() { document.getElementById('status-modal-overlay').classList.remove('open'); currentUpdateId = null; }

async function submitStatusUpdate() {
  if (!currentUpdateId) return;
  const newStatus = document.getElementById('u-status').value;

  const btn = document.getElementById('update-status-btn');
  btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;

  try {
    const res = await apiFetch(`/stock/${currentUpdateId}/status`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
    if (!res) return;
    if (!res.ok) { showToast('Status update failed.', 'error'); return; }

    closeStatusModal();
    showToast('Status updated!', 'success');
    loadStock();
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btn.innerHTML = 'Update'; btn.disabled = false;
  }
}

async function deleteStock(id) {
  if (!confirm('Delete this stock record?')) return;
  const res = await apiFetch(`/stock/${id}`, { method: 'DELETE' });
  if (!res) return;
  if (res.ok) { showToast('Record deleted.', 'success'); loadStock(); }
  else { showToast('Delete failed.', 'error'); }
}

// ── Photo Compression ─────────────────────────────────────────────
function setupPhotoUpload() {
  const fileInput = document.getElementById('f-photo');
  fileInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      fileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = function(event) {
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 300; const MAX_HEIGHT = 300;
        let width = img.width; let height = img.height;
        if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
        else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Aggressive compression to keep it 10-20KB
        attachedPhotoData = canvas.toDataURL('image/jpeg', 0.3); 
        
        document.getElementById('photo-preview').src = attachedPhotoData;
        document.getElementById('photo-upload-container').style.display = 'none';
        document.getElementById('photo-preview-container').style.display = 'block';
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}
function clearPhoto() {
  attachedPhotoData = null;
  document.getElementById('f-photo').value = '';
  document.getElementById('photo-upload-container').style.display = 'flex';
  document.getElementById('photo-preview-container').style.display = 'none';
  document.getElementById('photo-preview').src = '';
}

// ── Zoom Image ────────────────────────────────────────────────────
function zoomPhoto(src) {
  const zoomOverlay = document.getElementById('zoom-overlay');
  document.getElementById('zoom-img').src = src;
  zoomOverlay.classList.add('open');
}
function closeZoom() {
  document.getElementById('zoom-overlay').classList.remove('open');
  document.getElementById('zoom-img').src = '';
}

// Ensure modals close when clicking outside
window.addEventListener('click', (e) => {
  if (e.target.id === 'stock-modal-overlay') closeStockModal();
  if (e.target.id === 'stock-detail-overlay') closeStockDetailModal();
  if (e.target.id === 'status-modal-overlay') closeStatusModal();
  
  const dropdown = document.getElementById('nav-dropdown');
  if (dropdown && dropdown.classList.contains('show') && !e.target.closest('.menu-container')) {
    dropdown.classList.remove('show');
  }
});

function toggleMenu(e) {
  if (e) e.stopPropagation();
  document.getElementById('nav-dropdown').classList.toggle('show');
}

// ── WhatsApp Reminder ─────────────────────────────────────────────
async function sendWhatsAppReminder() {
  const btn = document.querySelector('.filters-bar .btn-accent');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = 'Wait...';
  
  try {
    const res = await apiFetch('/stock');
    if (!res || !res.ok) throw new Error('Failed to fetch stock');
    const { data } = await res.json();
    
    // Filter only out of stock items
    const neededItems = data.filter(r => r.status === 'out_of_stock');
    if (!neededItems.length) {
      alert('Everything is currently in stock! No reminder needed.');
      return;
    }
    
    let msg = `*🛒 Delhi Purchase List (Monday Reminder)*\n\n`;
    neededItems.forEach((item, index) => {
      msg += `${index + 1}. *${item.item_name}* (Qty: ${item.quantity})\n`;
    });
    msg += `\n_Generated automatically from Benefit Computer System_`;
    
    // Use window.open for WhatsApp sharing
    window.location.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    
  } catch(err) {
    alert(err.message);
  } finally {
    btn.innerHTML = originalHtml;
  }
}

checkAuth();
