const API = '/api';
let token = localStorage.getItem('dst_token') || null;
let currentUser = null;
let currentFilters = {};
let editingRequestId = null;
let STATUS_OPTIONS = { replacement: [], order: [] };
let currentType = 'replacement';
let attachedPhotoData = null;

const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';

// ── Auth / session (same pattern as sales app) ──────────────────
function isAdmin() { return currentUser && currentUser.role === 'admin'; }

function logout() {
  localStorage.removeItem('dst_token'); localStorage.removeItem('dst_user');
  window.location.href = 'index.html';
}

(function checkSession() {
  const savedUser = localStorage.getItem('dst_user');
  if (!token || !savedUser) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = JSON.parse(savedUser);
  initPage();
})();

async function apiFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + url, { ...options, headers });
  if (res.status === 401) { logout(); return null; }
  return res;
}

function fmt(n) { return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function esc(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Init ──────────────────────────────────────────────────────────
async function initPage() {
  document.getElementById('user-name-chip').innerHTML =
    `${currentUser.name || currentUser.email}<span class="role-badge ${currentUser.role}">${currentUser.role}</span>`;

  if (isAdmin()) {
    document.getElementById('summary-bar').style.display = 'grid';
    document.getElementById('th-actions').style.display = '';
  } else {
    document.getElementById('summary-bar').style.display = 'none';
  }

  populateYearFilter();
  await loadStatusOptions();
  populateStatusFilter();
  setTodayDate();
  resetItemsList();

  const now = new Date();
  document.getElementById('f-month').value = now.getMonth() + 1;
  document.getElementById('f-year').value = now.getFullYear();
  currentFilters = { month: now.getMonth() + 1, year: now.getFullYear() };
  loadRequests();
}

function populateYearFilter() {
  const sel = document.getElementById('f-year');
  const now = new Date().getFullYear();
  for (let y = now; y >= now - 5; y--) {
    const o = document.createElement('option');
    o.value = y; o.text = y;
    sel.appendChild(o);
  }
}

function setTodayDate() {
  document.getElementById('f-request_date').value = new Date().toISOString().split('T')[0];
}

async function loadStatusOptions() {
  const res = await apiFetch('/requests/status-options');
  if (!res) return;
  STATUS_OPTIONS = await res.json();
}

function populateStatusFilter() {
  const sel = document.getElementById('f-status');
  const all = [...STATUS_OPTIONS.replacement, ...STATUS_OPTIONS.order];
  const seen = new Set();
  all.forEach(s => {
    if (seen.has(s.key)) return;
    seen.add(s.key);
    const o = document.createElement('option');
    o.value = s.key; o.text = s.label;
    sel.appendChild(o);
  });
}

// ── Load & render requests table ─────────────────────────────────
async function loadRequests(filters = currentFilters) {
  const params = new URLSearchParams();
  if (filters.month) params.append('month', filters.month);
  if (filters.year) params.append('year', filters.year);
  if (filters.type) params.append('type', filters.type);
  if (filters.item_type) params.append('item_type', filters.item_type);
  if (filters.status) params.append('status', filters.status);
  if (filters.name) params.append('customer_name', filters.name);
  if (filters.mobile) params.append('mobile', filters.mobile);

  const calls = [apiFetch(`/requests?${params}`)];
  if (isAdmin()) calls.push(apiFetch(`/requests/summary?${params}`));
  const results = await Promise.all(calls);
  const reqRes = results[0];
  if (!reqRes) return;
  const data = await reqRes.json();
  renderTable(data.data || []);

  if (isAdmin() && results[1]) {
    const summary = await results[1].json();
    renderSummary(summary);
  }
}

function renderSummary(s) {
  document.getElementById('sum-pending-rep').textContent = s.pendingReplacements ?? 0;
  document.getElementById('sum-pending-ord').textContent = s.pendingOrders ?? 0;
  document.getElementById('sum-ready').textContent = s.readyForPickup ?? 0;
  document.getElementById('sum-outstanding').textContent = '₹' + fmt(s.totalOutstanding);
}

function statusPillClass(status) {
  if (status === 'closed') return 'status-closed';
  if (status === 'delivered_to_customer') return 'status-delivered';
  if (status === 'replacement_received' || status === 'product_reached_office') return 'status-ready';
  if (status === 'received_from_customer' || status === 'order_received') return 'status-received';
  return 'status-progress';
}

function statusLabel(status) {
  const all = [...STATUS_OPTIONS.replacement, ...STATUS_OPTIONS.order];
  const found = all.find(s => s.key === status);
  return found ? found.label : status;
}

function renderTable(rows) {
  const tbody = document.getElementById('req-tbody');
  document.getElementById('table-count').textContent = `${rows.length} record${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="no-data">No requests found. Create your first one!</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const reqDate = r.request_date ? new Date(r.request_date + 'T00:00:00').toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) : '—';
    const isReplacement = r.request_type === 'replacement';
    const purchDate = (isReplacement && r.purchase_date) ? new Date(r.purchase_date + 'T00:00:00').toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) : '—';
    const itemsLabel = itemsDisplayLabel(r.items);

    return `<tr onclick="openDetailModal('${r.id}')" style="cursor:pointer;">
      <td><strong>${esc(r.request_number)}</strong></td>
      <td>${reqDate}</td>
      <td>${purchDate}</td>
      <td><span class="badge badge-type-${r.request_type}">${r.request_type === 'order' ? 'Order' : 'Replacement'}</span></td>
      <td>${esc(r.customer?.name || '—')}</td>
      <td>${esc(r.customer?.mobile_number || '—')}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis" title="${esc(itemsLabel)}">${esc(itemsLabel)}</td>
      <td><span class="status-pill ${statusPillClass(r.current_status)}">${statusLabel(r.current_status)}</span></td>
    </tr>`;
  }).join('');
}

// Build a readable items label including model, e.g. "Battery (Dell BAT-44), Charger (65W)"
function itemsDisplayLabel(items) {
  if (!items || !items.length) return '—';
  return items.map(i => {
    const label = ITEM_TYPE_LABELS[i.item_type] || i.item_type;
    const model = i.part_model || i.device_model || '';
    return model ? `${label} (${model})` : label;
  }).join(', ');
}

// ── Filters ─────────────────────────────────────────────────────
function applyFilters() {
  currentFilters = {
    month: document.getElementById('f-month').value,
    year: document.getElementById('f-year').value,
    type: document.getElementById('f-type').value,
    item_type: document.getElementById('f-item-type').value,
    status: document.getElementById('f-status').value,
    name: document.getElementById('f-name').value.trim(),
    mobile: document.getElementById('f-mobile').value.trim(),
  };
  loadRequests(currentFilters);
}

function clearFilters() {
  ['f-month','f-year','f-type','f-item-type','f-status','f-name','f-mobile'].forEach(id => {
    document.getElementById(id).value = '';
  });
  currentFilters = {};
  loadRequests({});
}

// ── Item type sub-fields ──────────────────────────────────────────
const ITEM_TYPE_LABELS = {
  battery: 'Battery', charger: 'Charger', keyboard: 'Keyboard', ssd: 'SSD', ram: 'RAM',
  motherboard: 'Motherboard', body_part: 'Body Part', speaker: 'Speaker', smps: 'SMPS',
  cabinet: 'Cabinet', mouse: 'Mouse', other: 'Other'
};

function subFieldsHTML(itemType) {
  switch (itemType) {
    case 'battery':
      return `
        <div class="form-group"><label>Laptop Model *</label><input type="text" class="sf-device_model" placeholder="e.g. Dell Inspiron 15" /></div>
        <div class="form-group"><label>Battery Model</label><input type="text" class="sf-part_model" placeholder="Battery part number" /></div>`;
    case 'keyboard':
      return `
        <div class="form-group"><label>Keyboard Kind *</label>
          <select class="sf-keyboard_kind">
            <option value="">Select...</option>
            <option value="internal">Internal (Laptop)</option>
            <option value="external">External (USB)</option>
            <option value="combo">Combo (Keyboard + Mouse)</option>
          </select>
        </div>
        <div class="form-group"><label>Model</label><input type="text" class="sf-part_model" placeholder="Model / device" /></div>`;
    case 'ssd':
      return `
        <div class="form-group"><label>Interface *</label>
          <select class="sf-ssd_interface">
            <option value="">Select...</option>
            <option value="SATA">SATA</option>
            <option value="M.2">M.2</option>
            <option value="NVMe">NVMe</option>
          </select>
        </div>
        <div class="form-group"><label>Size *</label>
          <select class="sf-ssd_size">
            <option value="">Select...</option>
            <option value="128GB">128 GB</option>
            <option value="256GB">256 GB</option>
            <option value="512GB">512 GB</option>
            <option value="1TB">1 TB</option>
          </select>
        </div>
        <div class="form-group"><label>Model / Brand</label><input type="text" class="sf-part_model" placeholder="e.g. Samsung 970 EVO" /></div>`;
    case 'ram':
      return `
        <div class="form-group"><label>Size *</label>
          <select class="sf-ram_size">
            <option value="">Select...</option>
            <option value="4GB">4 GB</option><option value="8GB">8 GB</option>
            <option value="16GB">16 GB</option><option value="32GB">32 GB</option>
          </select>
        </div>
        <div class="form-group"><label>RAM Type</label>
          <select class="sf-ram_type">
            <option value="">Select...</option>
            <option value="DDR2">DDR2</option><option value="DDR3">DDR3</option>
            <option value="DDR4">DDR4</option><option value="DDR5">DDR5</option>
          </select>
        </div>
        <div class="form-group"><label>Model / Brand</label><input type="text" class="sf-part_model" placeholder="e.g. Crucial 8GB" /></div>`;
    case 'motherboard':
      return `
        <div class="form-group"><label>Device Kind *</label>
          <select class="sf-device_kind">
            <option value="">Select...</option>
            <option value="laptop">Laptop</option>
            <option value="desktop">Desktop</option>
          </select>
        </div>
        <div class="form-group"><label>Model</label><input type="text" class="sf-part_model" placeholder="Motherboard / device model" /></div>`;
    case 'body_part':
      return `
        <div class="form-group"><label>Part *</label>
          <select class="sf-body_part_name">
            <option value="">Select...</option>
            <option value="touchpad">Touchpad</option>
            <option value="base">Base</option>
            <option value="panel">Panel (ABH)</option>
            <option value="hinge">Hinge</option>
          </select>
        </div>
        <div class="form-group"><label>Laptop Model</label><input type="text" class="sf-device_model" placeholder="e.g. HP Pavilion 14" /></div>`;
    case 'speaker': case 'smps': case 'cabinet': case 'mouse': case 'charger': case 'other':
      return `<div class="form-group full"><label>Model</label><input type="text" class="sf-part_model" placeholder="Model / description" /></div>`;
    default:
      return '';
  }
}

function handleItemTypeChange(sel) {
  const card = sel.closest('.item-card');
  const mount = card.querySelector('.item-sub-fields');
  mount.innerHTML = subFieldsHTML(sel.value);
  card.querySelector('.item-card-title').textContent = ITEM_TYPE_LABELS[sel.value] || 'Item';
}

function addItemCard() {
  const tmpl = document.getElementById('item-card-template');
  const clone = tmpl.content.cloneNode(true);
  document.getElementById('items-list').appendChild(clone);
}

function removeItemCard(btn) {
  const list = document.getElementById('items-list');
  if (list.children.length <= 1) { showToast('At least one item is required.', 'error'); return; }
  btn.closest('.item-card').remove();
}

function resetItemsList() {
  document.getElementById('items-list').innerHTML = '';
  addItemCard();
}

function collectItems() {
  const cards = document.querySelectorAll('#items-list .item-card');
  const items = [];
  for (const card of cards) {
    const item_type = card.querySelector('.item-type-select').value;
    if (!item_type) continue;
    const get = (cls) => card.querySelector('.' + cls)?.value?.trim() || null;
    items.push({
      item_type,
      device_model: get('sf-device_model'),
      part_model: get('sf-part_model'),
      keyboard_kind: get('sf-keyboard_kind'),
      ssd_interface: get('sf-ssd_interface'),
      ssd_size: get('sf-ssd_size'),
      ram_size: get('sf-ram_size'),
      ram_type: get('sf-ram_type'),
      body_part_name: get('sf-body_part_name'),
      device_kind: get('sf-device_kind'),
      serial_number: get('item-serial'),
      remarks: card.querySelector('.item-remarks')?.value?.trim() || null
    });
  }
  return items;
}

// ── Request type toggle ───────────────────────────────────────────
function setRequestType(type) {
  currentType = type;
  document.getElementById('type-btn-replacement').classList.toggle('active', type === 'replacement');
  document.getElementById('type-btn-order').classList.toggle('active', type === 'order');
  document.getElementById('pricing-section-title').style.display = type === 'order' ? '' : 'none';
  document.getElementById('pricing-grid').style.display = type === 'order' ? '' : 'none';
  document.getElementById('source-label').textContent = type === 'order' ? 'Supplier Name' : 'Service Centre Name';
  document.getElementById('f-purchase-date-group').style.display = type === 'order' ? 'none' : '';
}

function calcRemaining() {
  const price = parseFloat(document.getElementById('f-item_price').value) || 0;
  const advance = parseFloat(document.getElementById('f-advance_amount').value) || 0;
  const remaining = price - advance;
  document.getElementById('f-remaining_display').textContent = '₹' + remaining.toFixed(2);
}

// ── New Request Modal ──────────────────────────────────────────────
function openRequestModal() {
  editingRequestId = null;
  document.getElementById('modal-title').textContent = 'New Request';
  document.getElementById('form-error').style.display = 'none';
  ['f-customer_name','f-mobile_number','f-alternate_number','f-customer_address','f-purchase_date','f-item_price','f-advance_amount','f-source','f-tracking','f-expected_date','f-internal_notes','f-customer_notes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  setTodayDate();
  resetItemsList();
  setRequestType('replacement');
  calcRemaining();
  removePhoto(); // Clear photo preview & data
  document.getElementById('modal-overlay').classList.add('open');
}

function closeRequestModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function showError(msg) {
  const el = document.getElementById('form-error');
  el.textContent = msg; el.style.display = 'block';
}

async function saveRequest() {
  const errEl = document.getElementById('form-error');
  errEl.style.display = 'none';

  const customer_name = document.getElementById('f-customer_name').value.trim();
  const mobile_number = document.getElementById('f-mobile_number').value.trim();
  const alternate_number = document.getElementById('f-alternate_number').value.trim();
  const customer_address = document.getElementById('f-customer_address').value.trim();
  const request_date = document.getElementById('f-request_date').value;
  const purchase_date = currentType === 'order' ? null : document.getElementById('f-purchase_date').value;
  const items = collectItems();
  const item_price = document.getElementById('f-item_price').value;
  const advance_amount = document.getElementById('f-advance_amount').value;
  const service_centre_or_supplier = document.getElementById('f-source').value.trim();
  const tracking_number = document.getElementById('f-tracking').value.trim();
  const expected_date = document.getElementById('f-expected_date').value;
  const internal_notes = document.getElementById('f-internal_notes').value.trim();
  const customer_notes = document.getElementById('f-customer_notes').value.trim();

  if (!customer_name) return showError('Customer name is required.');
  if (!mobile_number) return showError('Mobile number is required.');
  if (!request_date) return showError('Request date is required.');
  if (!items.length) return showError('At least one item with a selected type is required.');

  const body = {
    request_type: currentType,
    customer: { name: customer_name, mobile_number, alternate_number, address: customer_address },
    items,
    item_price, advance_amount,
    service_centre_or_supplier, tracking_number, request_date, purchase_date, expected_date,
    internal_notes, customer_notes,
    photo_data: attachedPhotoData // Include Base64 image
  };

  const btn = document.getElementById('save-btn');
  btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;

  try {
    const res = await apiFetch('/requests', { method: 'POST', body: JSON.stringify(body) });
    if (!res) return;
    
    let data;
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const txt = await res.text();
      data = { error: txt.substring(0, 100) || `HTTP Error ${res.status}` };
    }
    
    if (!res.ok) { showError(data.error || 'Save failed.'); return; }

    closeRequestModal();
    showToast(data.message || 'Request saved!', 'success');
    loadRequests(currentFilters);

    // Offer the "request created" WhatsApp message
    offerCreationWhatsApp(data.data, customer_name, mobile_number);
  } catch (err) {
    showError('Network error: ' + err.message);
  } finally {
    btn.innerHTML = 'Save Request'; btn.disabled = false;
  }
}

// ── WhatsApp messaging (manual send via wa.me, same pattern as Quotation) ──
function buildWaUrl(mobile, message) {
  const phone = (mobile || '').replace(/\D/g, '');
  const full = phone.startsWith('91') ? phone : '91' + phone;
  return `https://wa.me/${full}?text=${encodeURIComponent(message)}`;
}

function offerCreationWhatsApp(request, customerName, mobile) {
  const typeLabel = request.request_type === 'order' ? 'Advance Order' : 'Replacement';
  const itemNames = (request.items || []).map(i => {
    let label = i.item_type;
    label = label.charAt(0).toUpperCase() + label.slice(1).replace('_', ' ');
    return `${label} (${i.model_number || 'Standard'})`;
  }).join(', ') || 'Device/Parts';
  
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  
  const msg = `🌟 *BENEFIT COMPUTER* 🌟
---------------------------------
Greetings *${customerName}*,

We have received your *${typeLabel}* request successfully!

Details:
📝 *Request No*: #${request.request_number}
📅 *Date*: ${dateStr}
🔧 *Item*: ${itemNames}

We will notify you as soon as it is ready for collection.

Thank you for choosing Benefit Computer! 🙏`;
  const url = buildWaUrl(mobile, msg);
  showToast('Request saved! Click to send WhatsApp confirmation.', 'info');
  setTimeout(() => {
    if (confirm(`Send WhatsApp confirmation to ${customerName}?`)) {
      window.location.href = url;
    }
  }, 400);
}

// ── Detail / Timeline Modal ────────────────────────────────────────
let currentDetailRequest = null;

async function openDetailModal(id) {
  const res = await apiFetch(`/requests/${id}`);
  if (!res) return;
  const { data } = await res.json();
  currentDetailRequest = data;

  document.getElementById('detail-title').textContent = `${data.request_number} — ${data.customer?.name || ''}`;

  // Populate read-only details
  const isOrder = data.request_type === 'order';
  const reqDate = data.request_date ? new Date(data.request_date + 'T00:00:00').toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) : '—';
  const purchDate = data.purchase_date ? new Date(data.purchase_date + 'T00:00:00').toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) : '—';
  const expectedDate = data.expected_date ? new Date(data.expected_date + 'T00:00:00').toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) : '—';
  
  // Format items
  let itemsHTML = '';
  if (data.items && data.items.length) {
    itemsHTML = data.items.map((it, idx) => {
      const typeLbl = ITEM_TYPE_LABELS[it.item_type] || it.item_type;
      let specs = [];
      if (it.keyboard_kind) specs.push(`Kind: ${it.keyboard_kind}`);
      if (it.ssd_interface) specs.push(`Interface: ${it.ssd_interface}`);
      if (it.ssd_size) specs.push(`Size: ${it.ssd_size}`);
      if (it.ram_size) specs.push(`Size: ${it.ram_size}`);
      if (it.ram_type) specs.push(`Type: ${it.ram_type}`);
      if (it.body_part_name) specs.push(`Part: ${it.body_part_name}`);
      if (it.device_kind) specs.push(`Device: ${it.device_kind}`);
      if (it.device_model) specs.push(`Device Model: ${it.device_model}`);
      if (it.part_model) specs.push(`Part Model: ${it.part_model}`);
      if (it.serial_number) specs.push(`S/N: ${it.serial_number}`);
      if (it.remarks) specs.push(`Remarks: ${it.remarks}`);
      
      return `
        <div class="item-card" style="margin-bottom: 8px;">
          <div class="item-card-title">Item #${idx + 1} — ${esc(typeLbl)}</div>
          <div style="font-size: 13px; color: var(--muted); margin-top: 4px; line-height: 1.4;">
            ${specs.map(s => esc(s)).join(' · ')}
          </div>
        </div>`;
    }).join('');
  } else {
    itemsHTML = '<div style="color: var(--muted); font-size: 13px;">No items.</div>';
  }

  // Pricing block HTML
  let pricingHTML = '';
  if (isOrder) {
    pricingHTML = `
      <div class="detail-item">
        <span class="detail-label">Item Price</span>
        <span class="detail-value">₹${fmt(data.item_price)}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Advance Paid</span>
        <span class="detail-value">₹${fmt(data.advance_amount)}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Remaining Balance</span>
        <span class="detail-value" style="color: var(--accent);">₹${fmt(data.remaining_amount)}</span>
      </div>
      ${data.settled_at ? `
      <div class="detail-item">
        <span class="detail-label">Amount Collected at Settlement</span>
        <span class="detail-value" style="color: var(--green);">₹${fmt(data.collected_amount)}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Settlement Discount</span>
        <span class="detail-value">₹${fmt(data.settlement_discount)}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Settled At</span>
        <span class="detail-value">${new Date(data.settled_at).toLocaleString('en-IN', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
      </div>
      ` : ''}
    `;
  }

  // Photo HTML
  let photoHTML = '';
  if (data.photo_data) {
    photoHTML = `
      <div class="detail-item full detail-photo-container">
        <span class="detail-label">Attached Photo</span>
        <div style="margin-top: 5px;">
          <img class="detail-photo-thumbnail" src="${data.photo_data}" alt="Device / Part photo" onclick="zoomPhoto('${esc(data.photo_data)}')" />
        </div>
      </div>`;
  }

  const infoGrid = document.getElementById('detail-info-grid');
  infoGrid.innerHTML = `
    <div class="detail-item">
      <span class="detail-label">Customer Name</span>
      <span class="detail-value">${esc(data.customer?.name || '—')}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Mobile Number</span>
      <span class="detail-value">${esc(data.customer?.mobile_number || '—')}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Alternate Number</span>
      <span class="detail-value">${esc(data.customer?.alternate_number || '—')}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Address</span>
      <span class="detail-value">${esc(data.customer?.address || '—')}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Request Type</span>
      <span class="detail-value" style="text-transform: capitalize;">${data.request_type === 'order' ? 'Advance Order' : 'Replacement'}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Request Date</span>
      <span class="detail-value">${reqDate}</span>
    </div>
    ${!isOrder ? `
    <div class="detail-item">
      <span class="detail-label">Purchase Date</span>
      <span class="detail-value">${purchDate}</span>
    </div>` : ''}
    <div class="detail-item">
      <span class="detail-label">Expected Date</span>
      <span class="detail-value">${expectedDate}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">${isOrder ? 'Supplier Name' : 'Service Centre Name'}</span>
      <span class="detail-value">${esc(data.service_centre_or_supplier || '—')}</span>
    </div>
    <div class="detail-item">
      <span class="detail-label">Tracking Number</span>
      <span class="detail-value">${esc(data.tracking_number || '—')}</span>
    </div>
    
    <div class="detail-item full">
      <span class="detail-label">Internal Notes</span>
      <span class="detail-value" style="font-weight: normal; font-style: italic;">${esc(data.internal_notes || 'No internal notes.')}</span>
    </div>
    <div class="detail-item full">
      <span class="detail-label">Customer Notes</span>
      <span class="detail-value" style="font-weight: normal;">${esc(data.customer_notes || 'No customer notes.')}</span>
    </div>

    <div class="detail-items-container">
      <span class="detail-label">Request Items</span>
      ${itemsHTML}
    </div>

    ${pricingHTML}
    ${photoHTML}
  `;

  // Status dropdown
  const statusSel = document.getElementById('d-status-select');
  statusSel.innerHTML = '';
  const options = STATUS_OPTIONS[data.request_type] || [];
  options.forEach(s => {
    const o = document.createElement('option');
    o.value = s.key; o.text = s.label;
    if (s.key === data.current_status) o.selected = true;
    statusSel.appendChild(o);
  });

  // WhatsApp banner area (cleared each open)
  document.getElementById('wa-banner-mount').innerHTML = '';

  // Final settlement section — Order only, only when pickup-ready and balance > 0
  const settleSection = document.getElementById('settlement-section');
  const remaining = parseFloat(data.remaining_amount || 0);
  const alreadySettled = !!data.settled_at;
  if (data.request_type === 'order' && data.current_status === 'product_reached_office' && remaining > 0 && !alreadySettled) {
    settleSection.style.display = 'block';
    document.getElementById('d-remaining-display').textContent = '₹' + fmt(remaining);
    document.getElementById('d-collected_amount').value = '';
    document.getElementById('settlement-hint').textContent = 'Enter the exact amount the customer pays. Any shortfall from the remaining balance will be recorded as a discount.';
  } else {
    settleSection.style.display = 'none';
  }

  // Timeline
  const tl = data.timeline || [];
  const mount = document.getElementById('timeline-mount');
  if (!tl.length) {
    mount.innerHTML = `<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">No timeline events yet.</div>`;
  } else {
    mount.innerHTML = tl.map(ev => {
      const when = new Date(ev.created_at).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
      return `<div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-status">${esc(statusLabel(ev.status))}</div>
          <div class="timeline-meta">${when} · ${esc(ev.updated_user?.name || 'System')}</div>
          ${ev.notes ? `<div class="timeline-notes">${esc(ev.notes)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  document.getElementById('detail-overlay').classList.add('open');
}

function closeDetailModal() {
  document.getElementById('detail-overlay').classList.remove('open');
  currentDetailRequest = null;
}

const PICKUP_READY_STATUSES = ['replacement_received', 'product_reached_office'];

async function updateStatus() {
  if (!currentDetailRequest) return;
  const newStatus = document.getElementById('d-status-select').value;

  const res = await apiFetch(`/requests/${currentDetailRequest.id}/status`, {
    method: 'PUT', body: JSON.stringify({ status: newStatus })
  });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Status update failed.', 'error'); return; }

  showToast('Status updated.', 'success');

  // Build the WhatsApp "ready for pickup" banner HTML (if applicable) BEFORE refreshing,
  // since openDetailModal() clears wa-banner-mount as part of its normal reset.
  let pickupBannerHTML = '';
  if (PICKUP_READY_STATUSES.includes(newStatus)) {
    const r = currentDetailRequest;
    const custName = r.customer?.name || 'Customer';
    const mobile = r.customer?.mobile_number || '';
    const typeLabel = r.request_type === 'order' ? 'Advance Order' : 'Replacement';
    
    let msg = `🌟 *BENEFIT COMPUTER* 🌟
---------------------------------
Greetings *${custName}*,

Your *${typeLabel}* is ready for pickup!

Details:
📝 *Request No*: #${r.request_number}
📦 *Status*: READY FOR COLLECTION`;

    if (r.request_type === 'order') {
      msg += `\n💰 *Remaining Balance*: ₹${fmt(r.remaining_amount)}`;
    }
    
    msg += `\n\n📍 Please visit our store to collect your device.\n\nThank you for choosing Benefit Computer! 🙏`;
    const url = buildWaUrl(mobile, msg);
    pickupBannerHTML = `
      <div class="wa-banner">
        <span class="wa-banner-text">Item is ready — notify ${esc(custName)}?</span>
        <a class="btn-whatsapp" href="${url}" target="_blank">📤 Send WhatsApp</a>
      </div>`;
  }

  // Refresh timeline + table, THEN apply the banner so it isn't wiped by the refresh
  if (newStatus === 'delivered_to_customer' || newStatus === 'closed') {
    closeDetailModal();
  } else {
    await openDetailModal(currentDetailRequest.id);
    document.getElementById('wa-banner-mount').innerHTML = pickupBannerHTML;
  }
  loadRequests(currentFilters);
}

// ── Final Settlement (Order only) ───────────────────────────────
function previewSettlement() {
  if (!currentDetailRequest) return;
  const remaining = parseFloat(currentDetailRequest.remaining_amount || 0);
  const collected = parseFloat(document.getElementById('d-collected_amount').value || 0);
  const hint = document.getElementById('settlement-hint');
  if (!document.getElementById('d-collected_amount').value) {
    hint.textContent = 'Enter the exact amount the customer pays. Any shortfall from the remaining balance will be recorded as a discount.';
    return;
  }
  const discount = Math.max(0, remaining - collected);
  if (discount > 0) {
    hint.innerHTML = `₹${fmt(discount)} will be recorded as a discount (remaining ₹${fmt(remaining)} − collected ₹${fmt(collected)}).`;
  } else {
    hint.textContent = 'Full remaining balance collected. No discount will be applied.';
  }
}

async function settlePayment() {
  if (!currentDetailRequest) return;
  const collectedVal = document.getElementById('d-collected_amount').value;
  if (collectedVal === '' || collectedVal === null) {
    showToast('Enter the amount collected before confirming.', 'error');
    return;
  }
  const collected = parseFloat(collectedVal);
  if (isNaN(collected) || collected < 0) {
    showToast('Enter a valid amount.', 'error');
    return;
  }

  const btn = document.querySelector('#settlement-section .btn-accent');
  if (!btn) return;
  
  const originalHTML = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;

  try {
    const res = await apiFetch(`/requests/${currentDetailRequest.id}/settle`, {
      method: 'PUT',
      body: JSON.stringify({ collected_amount: collected })
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Settlement failed.', 'error'); return; }

    showToast(data.message || 'Payment settled.', 'success');
    closeDetailModal();
    loadRequests(currentFilters);
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }
}

// ── Delete ───────────────────────────────────────────────────────
async function deleteRequest(id) {
  if (!confirm('Delete this request? This cannot be undone.')) return;
  const res = await apiFetch(`/requests/${id}`, { method: 'DELETE' });
  if (!res) return;
  if (res.ok) { showToast('Request deleted.', 'success'); loadRequests(currentFilters); }
  else { const d = await res.json(); showToast(d.error || 'Delete failed.', 'error'); }
}

// ── Toast ────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), type === 'info' ? 5000 : 3000);
}

document.getElementById('modal-overlay').addEventListener('click', function(e) { if (e.target === this) closeRequestModal(); });
document.getElementById('detail-overlay').addEventListener('click', function(e) { if (e.target === this) closeDetailModal(); });

function toggleMenu(e) {
  if (e) e.stopPropagation();
  document.getElementById('nav-dropdown').classList.toggle('show');
}
window.addEventListener('click', function(e) {
  const dropdown = document.getElementById('nav-dropdown');
  if (dropdown && dropdown.classList.contains('show') && !e.target.closest('.menu-container')) {
    dropdown.classList.remove('show');
  }
});

// ── Photo Upload and Capture Handlers ──
function handlePhotoUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Client-side Resize (max dimension 400px to keep files in KB)
      const maxDim = 400;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      // Compress as JPEG (0.4 quality for 10KB-20KB files)
      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.4);
      
      // Update preview UI
      document.getElementById('photo-preview').src = compressedBase64;
      document.getElementById('photo-preview-container').style.display = 'block';
      
      // Store Base64 in global variable
      attachedPhotoData = compressedBase64;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removePhoto() {
  document.getElementById('f-photo').value = '';
  document.getElementById('photo-preview-container').style.display = 'none';
  document.getElementById('photo-preview').src = '';
  attachedPhotoData = null;
}

// ── Photo Zoom Overlay Handlers ──
function zoomPhoto(src) {
  const zoomOverlay = document.getElementById('zoom-overlay');
  const zoomImg = document.getElementById('zoom-img');
  zoomImg.src = src;
  zoomOverlay.classList.add('open');
}

function closeZoomModal() {
  const zoomOverlay = document.getElementById('zoom-overlay');
  zoomOverlay.classList.remove('open');
  document.getElementById('zoom-img').src = '';
}
