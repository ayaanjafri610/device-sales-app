const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const auth = require('../middleware/auth');

router.use(auth);

// ─── Status lists (kept here so frontend can fetch them too) ───
const STATUS_FLOW = {
  replacement: [
    { key: 'received_from_customer', label: 'Received From Customer' },
    { key: 'sent_for_replacement',   label: 'Sent For Replacement' },
    { key: 'replacement_received',   label: 'Replacement Received' },
    { key: 'delivered_to_customer',  label: 'Delivered To Customer' },
    { key: 'closed',                 label: 'Closed' },
  ],
  order: [
    { key: 'order_received',           label: 'Order Received' },
    { key: 'order_placed_with_supplier', label: 'Order Placed (Supplier)' },
    { key: 'product_reached_office',   label: 'Product Reached Office' },
    { key: 'delivered_to_customer',    label: 'Delivered To Customer' },
    { key: 'closed',                   label: 'Closed' },
  ]
};

// Statuses that trigger the "ready for pickup" WhatsApp message
const PICKUP_READY_STATUSES = ['replacement_received', 'product_reached_office'];

router.get('/status-options', (req, res) => {
  res.json(STATUS_FLOW);
});

// ─── Helper: generate next request number ───────────────────────
async function generateRequestNumber(type) {
  const seqName = type === 'replacement' ? 'req_replacement_seq' : 'req_order_seq';
  const prefix = type === 'replacement' ? 'REP' : 'ORD';
  const { data, error } = await supabase.rpc('nextval_seq', { seq_name: seqName });
  if (error) {
    // Fallback: count existing rows of this type +1 (rpc function may not exist yet)
    const { count } = await supabase
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .eq('request_type', type);
    const next = (count || 0) + 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }
  return `${prefix}${String(data).padStart(4, '0')}`;
}

// ─── Helper: find or create customer ────────────────────────────
async function findOrCreateCustomer({ name, mobile_number, alternate_number, address, remarks }) {
  const { data: existing } = await supabase
    .from('req_customers')
    .select('*')
    .eq('mobile_number', mobile_number.trim())
    .maybeSingle();

  if (existing) {
    // Update details in case they changed
    const { data: updated } = await supabase
      .from('req_customers')
      .update({ name: name.trim(), alternate_number, address, remarks })
      .eq('id', existing.id)
      .select()
      .single();
    return updated || existing;
  }

  const { data: created, error } = await supabase
    .from('req_customers')
    .insert({ name: name.trim(), mobile_number: mobile_number.trim(), alternate_number, address, remarks })
    .select()
    .single();
  if (error) throw error;
  return created;
}

// ─── GET /api/requests ──────────────────────────────────────────
// Filters: ?month=6&year=2025&type=replacement&item_type=battery&status=x&customer_name=x&mobile=x
router.get('/', async (req, res) => {
  try {
    const { month, year, type, item_type, status, customer_name, mobile } = req.query;

    let query = supabase
      .from('requests')
      .select(`
        id, request_number, request_type, current_status,
        item_price, advance_amount, remaining_amount,
        service_centre_or_supplier, tracking_number,
        request_date, expected_date, delivered_date, closed_date,
        internal_notes, customer_notes, created_at,
        purchase_date, photo_data,
        customer:customer_id (id, name, mobile_number, address),
        created_user:created_by (id, name),
        items:request_items (id, item_type, device_model, part_model, keyboard_kind, ssd_interface, ssd_size, ram_size, ram_type, body_part_name, device_kind, serial_number, remarks)
      `)
      .order('created_at', { ascending: false });

    if (year) {
      const y = parseInt(year);
      query = query.gte('request_date', `${y}-01-01`).lte('request_date', `${y}-12-31`);
    }
    if (month && year) {
      const y = parseInt(year), m = parseInt(month);
      const start = `${y}-${String(m).padStart(2,'0')}-01`;
      const end = new Date(y, m, 0).toISOString().split('T')[0];
      query = query.gte('request_date', start).lte('request_date', end);
    }
    if (type)   query = query.eq('request_type', type);
    if (status) query = query.eq('current_status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Post-filter on customer name/mobile/item_type since they're on joined tables
    let filtered = data;
    if (customer_name) {
      filtered = filtered.filter(r => r.customer?.name?.toLowerCase().includes(customer_name.toLowerCase()));
    }
    if (mobile) {
      filtered = filtered.filter(r => r.customer?.mobile_number?.includes(mobile));
    }
    if (item_type) {
      filtered = filtered.filter(r => r.items?.some(i => i.item_type === item_type));
    }

    res.json({ data: filtered, count: filtered.length });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── GET /api/requests/summary ──────────────────────────────────
// ADMIN ONLY
router.get('/summary', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can view summary.' });
    }
    const { month, year, type } = req.query;
    let query = supabase.from('requests').select('request_type, current_status, item_price, advance_amount, remaining_amount, request_date');

    if (year) {
      const y = parseInt(year);
      query = query.gte('request_date', `${y}-01-01`).lte('request_date', `${y}-12-31`);
    }
    if (month && year) {
      const y = parseInt(year), m = parseInt(month);
      const start = `${y}-${String(m).padStart(2,'0')}-01`;
      const end = new Date(y, m, 0).toISOString().split('T')[0];
      query = query.gte('request_date', start).lte('request_date', end);
    }
    if (type) query = query.eq('request_type', type);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const totalReplacements = data.filter(r => r.request_type === 'replacement').length;
    const totalOrders = data.filter(r => r.request_type === 'order').length;
    const pendingReplacements = data.filter(r => r.request_type === 'replacement' && r.current_status !== 'closed' && r.current_status !== 'delivered_to_customer').length;
    const pendingOrders = data.filter(r => r.request_type === 'order' && r.current_status !== 'closed' && r.current_status !== 'delivered_to_customer').length;
    const readyForPickup = data.filter(r => PICKUP_READY_STATUSES.includes(r.current_status)).length;
    const totalAdvanceCollected = data.reduce((s,r) => s + parseFloat(r.advance_amount || 0), 0);
    const totalOutstanding = data.reduce((s,r) => s + parseFloat(r.remaining_amount || 0), 0);

    res.json({ totalReplacements, totalOrders, pendingReplacements, pendingOrders, readyForPickup, totalAdvanceCollected, totalOutstanding, count: data.length });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── GET /api/requests/:id ───────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('requests')
      .select(`
        *,
        customer:customer_id (*),
        created_user:created_by (id, name),
        items:request_items (*),
        timeline:request_status_timeline (id, status, notes, created_at, updated_user:updated_by (id, name))
      `)
      .eq('id', req.params.id)
      .order('created_at', { foreignTable: 'request_status_timeline', ascending: true })
      .single();

    if (error || !data) return res.status(404).json({ error: 'Request not found.' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── POST /api/requests ──────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      request_type, customer, items,
      item_price, advance_amount,
      service_centre_or_supplier, tracking_number,
      request_date, purchase_date, expected_date,
      internal_notes, customer_notes, photo_data
    } = req.body;

    if (!request_type || !['replacement','order'].includes(request_type)) {
      return res.status(400).json({ error: 'request_type must be "replacement" or "order".' });
    }
    if (!customer || !customer.name || !customer.mobile_number) {
      return res.status(400).json({ error: 'Customer name and mobile number are required.' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required.' });
    }

    // 1. Find or create customer
    const cust = await findOrCreateCustomer(customer);

    // 2. Generate request number
    const requestNumber = await generateRequestNumber(request_type);

    // 3. Pricing (order only)
    let priceFields = {};
    if (request_type === 'order') {
      const ip = parseFloat(item_price || 0);
      const adv = parseFloat(advance_amount || 0);
      priceFields = { item_price: ip, advance_amount: adv, remaining_amount: ip - adv };
    }

    // 4. Initial status
    const initialStatus = request_type === 'replacement' ? 'received_from_customer' : 'order_received';

    // 5. Insert request
    const { data: newRequest, error: reqErr } = await supabase
      .from('requests')
      .insert({
        request_number: requestNumber,
        request_type,
        customer_id: cust.id,
        current_status: initialStatus,
        ...priceFields,
        service_centre_or_supplier: service_centre_or_supplier || null,
        tracking_number: tracking_number || null,
        request_date: request_date || new Date().toISOString().split('T')[0],
        purchase_date: purchase_date || null,
        expected_date: expected_date || null,
        created_by: req.user.id,
        internal_notes: internal_notes || null,
        customer_notes: customer_notes || null,
        photo_data: photo_data || null
      })
      .select()
      .single();

    if (reqErr) return res.status(500).json({ error: reqErr.message });

    // 6. Insert items
    const itemRows = items.map(it => ({ ...it, request_id: newRequest.id }));
    const { error: itemsErr } = await supabase.from('request_items').insert(itemRows);
    if (itemsErr) return res.status(500).json({ error: itemsErr.message });

    // 7. Log initial timeline event
    await supabase.from('request_status_timeline').insert({
      request_id: newRequest.id,
      status: initialStatus,
      updated_by: req.user.id,
      notes: 'Request created'
    });

    res.status(201).json({ data: { ...newRequest, customer: cust }, message: `Request ${requestNumber} created successfully.` });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── PUT /api/requests/:id/status ────────────────────────────────
// Update status — logs to timeline automatically
router.put('/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required.' });

    // Retrieve the existing request first to validate status transitions
    const { data: request, error: fetchErr } = await supabase
      .from('requests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !request) {
      return res.status(404).json({ error: 'Request not found.' });
    }

    // Safety check: Cannot mark order as delivered or closed if there is a remaining balance and it is not settled
    if (
      request.request_type === 'order' &&
      (status === 'delivered_to_customer' || status === 'closed') &&
      parseFloat(request.remaining_amount || 0) > 0 &&
      !request.settled_at
    ) {
      return res.status(400).json({
        error: 'Please settle the remaining payment before marking this order as delivered or closed.'
      });
    }

    // Update status and set delivered_date/closed_date if transitioning to those states
    const updatePayload = { current_status: status };
    if (status === 'delivered_to_customer') {
      updatePayload.delivered_date = new Date().toISOString().split('T')[0];
    } else if (status === 'closed') {
      updatePayload.closed_date = new Date().toISOString().split('T')[0];
    }

    const { data: updated, error } = await supabase
      .from('requests')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select(`*, customer:customer_id(*)`)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!updated) return res.status(404).json({ error: 'Request not found.' });

    await supabase.from('request_status_timeline').insert({
      request_id: req.params.id,
      status,
      updated_by: req.user.id,
      notes: notes || null
    });

    const isPickupReady = PICKUP_READY_STATUSES.includes(status);
    res.json({ data: updated, isPickupReady, message: 'Status updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── PUT /api/requests/:id ────────────────────────────────────────
// Edit request details (admin only, mirrors sales pattern)
router.put('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can edit requests.' });
    }
    const {
      item_price, advance_amount, service_centre_or_supplier, tracking_number,
      expected_date, delivered_date, internal_notes, customer_notes,
      purchase_date, photo_data
    } = req.body;

    const updateFields = {};
    if (item_price !== undefined || advance_amount !== undefined) {
      const { data: existing } = await supabase.from('requests').select('item_price, advance_amount, settled_at').eq('id', req.params.id).single();
      const ip = item_price !== undefined ? parseFloat(item_price) : parseFloat(existing.item_price || 0);
      const adv = advance_amount !== undefined ? parseFloat(advance_amount) : parseFloat(existing.advance_amount || 0);
      updateFields.item_price = ip;
      updateFields.advance_amount = adv;
      updateFields.remaining_amount = existing.settled_at ? 0 : (ip - adv);
    }
    if (service_centre_or_supplier !== undefined) updateFields.service_centre_or_supplier = service_centre_or_supplier;
    if (tracking_number !== undefined) updateFields.tracking_number = tracking_number;
    if (expected_date !== undefined) updateFields.expected_date = expected_date;
    if (delivered_date !== undefined) updateFields.delivered_date = delivered_date;
    if (internal_notes !== undefined) updateFields.internal_notes = internal_notes;
    if (customer_notes !== undefined) updateFields.customer_notes = customer_notes;
    if (purchase_date !== undefined) updateFields.purchase_date = purchase_date;
    if (photo_data !== undefined) updateFields.photo_data = photo_data;

    const { data, error } = await supabase
      .from('requests')
      .update(updateFields)
      .eq('id', req.params.id)
      .select(`*, customer:customer_id(*)`)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data, message: 'Request updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── PUT /api/requests/:id/settle ────────────────────────────────
// Settle remaining payment on an order and mark as delivered
router.put('/:id/settle', async (req, res) => {
  try {
    const { collected_amount } = req.body;
    if (collected_amount === undefined || collected_amount === null) {
      return res.status(400).json({ error: 'collected_amount is required.' });
    }

    const amt = parseFloat(collected_amount);
    if (isNaN(amt) || amt < 0) {
      return res.status(400).json({ error: 'Valid collected_amount is required.' });
    }

    // Fetch existing request
    const { data: request, error: fetchErr } = await supabase
      .from('requests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !request) {
      return res.status(404).json({ error: 'Request not found.' });
    }

    if (request.request_type !== 'order') {
      return res.status(400).json({ error: 'Only orders can be settled.' });
    }

    if (request.settled_at) {
      return res.status(400).json({ error: 'Request is already settled.' });
    }

    const remaining = parseFloat(request.remaining_amount || 0);
    const discount = Math.max(0, remaining - amt);

    const new_advance = parseFloat(request.advance_amount || 0) + amt;
    const todayStr = new Date().toISOString().split('T')[0];

    const { data: updated, error: updateErr } = await supabase
      .from('requests')
      .update({
        collected_amount: amt,
        settlement_discount: discount,
        advance_amount: new_advance,
        remaining_amount: 0,
        settled_at: new Date().toISOString(),
        current_status: 'delivered_to_customer',
        delivered_date: todayStr,
        closed_date: todayStr
      })
      .eq('id', req.params.id)
      .select(`*, customer:customer_id(*)`)
      .single();

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    // Log status timeline event
    await supabase.from('request_status_timeline').insert({
      request_id: req.params.id,
      status: 'delivered_to_customer',
      updated_by: req.user.id,
      notes: `Payment settled. Collected ₹${amt.toFixed(2)} (Discount: ₹${discount.toFixed(2)})`
    });

    res.json({ data: updated, message: `Payment settled. Collected ₹${amt.toFixed(2)}. Request marked as Delivered.` });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── DELETE /api/requests/:id ─────────────────────────────────────
// Admin only
router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete requests.' });
    }
    const { error } = await supabase.from('requests').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Request deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

module.exports = router;
