const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const auth = require('../middleware/auth');

// All routes require login
router.use(auth);

// Helper: build date range filter from month/year query params
function applyDateFilter(query, month, year) {
  if (year) {
    const y = parseInt(year);
    query = query.gte('sale_date', `${y}-01-01`).lte('sale_date', `${y}-12-31`);
  }
  if (month && year) {
    const y = parseInt(year);
    const m = parseInt(month);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = new Date(y, m, 0).toISOString().split('T')[0]; // last day of month
    query = query.gte('sale_date', start).lte('sale_date', end);
  }
  return query;
}

// ─── GET /api/sales ─────────────────────────────────────────────
// Filters: ?month=6&year=2025&customer_name=x&mobile=y&store=Store%20No%2067
router.get('/', async (req, res) => {
  try {
    const { month, year, customer_name, mobile, store } = req.query;

    let query = supabase
      .from('sales')
      .select(`
        id, customer_name, mobile_number, customer_address,
        device_type, model, processor, generation, ram, ram_type, hdd, ssd, ssd_interface, ssd_gen, monitor,
        accessories, store, price, discount, payment_mode,
        cash_amount, online_amount,
        sale_date, created_at,
        users:created_by (id, name)
      `)
      .order('sale_date', { ascending: false });

    query = applyDateFilter(query, month, year);
    if (customer_name) query = query.ilike('customer_name', `%${customer_name}%`);
    if (mobile)        query = query.ilike('mobile_number', `%${mobile}%`);
    if (store)         query = query.eq('store', store);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    res.json({ data, count: data.length });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── GET /api/sales/summary ─────────────────────────────────────
// ADMIN ONLY — totals and revenue breakdown for a period
router.get('/summary', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can view sales totals.' });
    }

    const { month, year, customer_name, mobile, store } = req.query;

    let query = supabase
      .from('sales')
      .select('price, discount, payment_mode, cash_amount, online_amount, store, sale_date');

    query = applyDateFilter(query, month, year);
    if (customer_name) query = query.ilike('customer_name', `%${customer_name}%`);
    if (mobile)        query = query.ilike('mobile_number', `%${mobile}%`);
    if (store)         query = query.eq('store', store);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const totalSales    = data.reduce((sum, s) => sum + parseFloat(s.price || 0), 0);
    const totalDiscount = data.reduce((sum, s) => sum + parseFloat(s.discount || 0), 0);
    const netSales       = totalSales - totalDiscount;
    const count          = data.length;

    // Online vs Cash breakdown — accounts for split payments
    let cashTotal = 0, onlineTotal = 0;
    data.forEach(s => {
      const net = parseFloat(s.price || 0) - parseFloat(s.discount || 0);
      if (s.payment_mode === 'cash') {
        cashTotal += net;
      } else if (s.payment_mode === 'online') {
        onlineTotal += net;
      } else if (s.payment_mode === 'credit') {
        // credit counted separately, not in cash/online split
      } else if (s.payment_mode === 'split') {
        cashTotal   += parseFloat(s.cash_amount || 0);
        onlineTotal += parseFloat(s.online_amount || 0);
      }
    });
    const creditTotal = data
      .filter(s => s.payment_mode === 'credit')
      .reduce((sum, s) => sum + (parseFloat(s.price || 0) - parseFloat(s.discount || 0)), 0);

    // Store-wise breakdown (for future per-shop revenue view)
    const storeBreakdown = {};
    data.forEach(s => {
      const key = s.store || 'Unknown';
      const net = parseFloat(s.price || 0) - parseFloat(s.discount || 0);
      storeBreakdown[key] = (storeBreakdown[key] || 0) + net;
    });

    res.json({
      totalSales, totalDiscount, netSales, count,
      paymentBreakdown: { cash: cashTotal, online: onlineTotal, credit: creditTotal },
      storeBreakdown
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── GET /api/sales/monthly-trend ───────────────────────────────
// ADMIN ONLY — revenue + count per month for a given year (for chart)
router.get('/monthly-trend', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can view sales trends.' });
    }

    const year = parseInt(req.query.year) || new Date().getFullYear();

    const { data, error } = await supabase
      .from('sales')
      .select('price, discount, sale_date')
      .gte('sale_date', `${year}-01-01`)
      .lte('sale_date', `${year}-12-31`);

    if (error) return res.status(500).json({ error: error.message });

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      revenue: 0,
      count: 0
    }));

    data.forEach(s => {
      const m = new Date(s.sale_date + 'T00:00:00').getMonth(); // 0-indexed
      const net = parseFloat(s.price || 0) - parseFloat(s.discount || 0);
      months[m].revenue += net;
      months[m].count += 1;
    });

    res.json({ year, months });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── GET /api/sales/:id ─────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sales')
      .select('*, users:created_by (id, name)')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Sale not found.' });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── POST /api/sales ────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      customer_name, mobile_number, customer_address,
      device_type, model, processor, generation, ram, ram_type, hdd, ssd, ssd_interface, ssd_gen, monitor,
      accessories, store, price, discount, payment_mode,
      cash_amount, online_amount, sale_date
    } = req.body;

    // Base mandatory fields (always required)
    if (!customer_name || !mobile_number || !device_type || !price || !payment_mode || !sale_date) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Model/Processor/RAM are mandatory UNLESS device type is "Other"
    const isOther = device_type.trim().toLowerCase() === 'other';
    if (!isOther) {
      if (!model)     return res.status(400).json({ error: 'Model is required.' });
      if (!processor) return res.status(400).json({ error: 'Processor is required.' });
      if (!ram)        return res.status(400).json({ error: 'RAM is required.' });
    }

    // Split payment validation
    if (payment_mode === 'split') {
      const c = parseFloat(cash_amount || 0);
      const o = parseFloat(online_amount || 0);
      if (c <= 0 && o <= 0) {
        return res.status(400).json({ error: 'For split payment, enter cash and/or online amount.' });
      }
    }

    const { data, error } = await supabase
      .from('sales')
      .insert({
        customer_name: customer_name.trim(),
        mobile_number: mobile_number.trim(),
        customer_address: customer_address || null,
        device_type: device_type.trim(),
        model: model ? model.trim() : null,
        processor: processor ? processor.trim() : null,
        generation: generation ? generation.trim() : null,
        ram: ram ? ram.trim() : null,
        ram_type: ram_type ? ram_type.trim() : null,
        hdd: hdd || 'none',
        ssd: ssd || 'none',
        ssd_interface: ssd_interface ? ssd_interface.trim() : null,
        ssd_gen: ssd_gen ? ssd_gen.trim() : null,
        monitor: monitor || null,
        accessories: accessories || [],
        store: store || 'Store No 122/123',
        price: parseFloat(price),
        discount: parseFloat(discount || 0),
        payment_mode,
        cash_amount: payment_mode === 'split' ? parseFloat(cash_amount || 0) : 0,
        online_amount: payment_mode === 'split' ? parseFloat(online_amount || 0) : 0,
        sale_date,
        created_by: req.user.id
      })
      .select(`*, users:created_by (id, name)`)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ data, message: 'Sale entry created successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── PUT /api/sales/:id ─────────────────────────────────────────
// ADMIN ONLY
router.put('/:id', async (req, res) => {
  try {
    // if (req.user.role !== 'admin') {
    //   return res.status(403).json({ error: 'Only admins can edit sale entries.' });
    // }

    const {
      customer_name, mobile_number, customer_address,
      device_type, model, processor, generation, ram, ram_type, hdd, ssd, ssd_interface, ssd_gen, monitor,
      accessories, store, price, discount, payment_mode,
      cash_amount, online_amount, sale_date
    } = req.body;

    const updateFields = {};
    if (customer_name)    updateFields.customer_name    = customer_name.trim();
    if (mobile_number)    updateFields.mobile_number    = mobile_number.trim();
    if (customer_address !== undefined) updateFields.customer_address = customer_address;
    if (device_type)      updateFields.device_type      = device_type.trim();
    if (model !== undefined)      updateFields.model      = model ? model.trim() : null;
    if (processor !== undefined)  updateFields.processor  = processor ? processor.trim() : null;
    if (generation !== undefined) updateFields.generation = generation ? generation.trim() : null;
    if (ram !== undefined)        updateFields.ram        = ram ? ram.trim() : null;
    if (ram_type !== undefined)   updateFields.ram_type    = ram_type ? ram_type.trim() : null;
    if (hdd !== undefined)    updateFields.hdd           = hdd || 'none';
    if (ssd !== undefined)    updateFields.ssd           = ssd || 'none';
    if (ssd_interface !== undefined) updateFields.ssd_interface = ssd_interface ? ssd_interface.trim() : null;
    if (ssd_gen !== undefined)       updateFields.ssd_gen       = ssd_gen ? ssd_gen.trim() : null;
    if (monitor !== undefined) updateFields.monitor      = monitor || null;
    if (accessories)      updateFields.accessories       = accessories;
    if (store)             updateFields.store             = store;
    if (price !== undefined)  updateFields.price         = parseFloat(price);
    if (discount !== undefined) updateFields.discount    = parseFloat(discount || 0);
    if (payment_mode)     updateFields.payment_mode      = payment_mode;
    if (sale_date)        updateFields.sale_date         = sale_date;

    if (payment_mode === 'split') {
      updateFields.cash_amount   = parseFloat(cash_amount || 0);
      updateFields.online_amount = parseFloat(online_amount || 0);
    } else if (payment_mode) {
      updateFields.cash_amount   = 0;
      updateFields.online_amount = 0;
    }

    const { data, error } = await supabase
      .from('sales')
      .update(updateFields)
      .eq('id', req.params.id)
      .select(`*, users:created_by (id, name)`)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Sale not found.' });
    res.json({ data, message: 'Sale updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── DELETE /api/sales/:id ──────────────────────────────────────
// ADMIN ONLY
router.delete('/:id', async (req, res) => {
  try {
    // if (req.user.role !== 'admin') {
    //   return res.status(403).json({ error: 'Only admins can delete sale entries.' });
    // }

    const { error } = await supabase
      .from('sales')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Sale deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

module.exports = router;
