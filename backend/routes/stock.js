const express = require('express');
const router = express.Router();
const supabase = require('../supabase');
const auth = require('../middleware/auth');

router.use(auth);

// ─── GET /api/stock ────────────────────────────────────────────────
// Fetches all stock needs. 
// Auto-Cleanup: Automatically deletes items that have been 'order_received' for > 30 days.
router.get('/', async (req, res) => {
  try {
    // Perform auto-cleanup of old received items (fire and forget)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const isoDate = thirtyDaysAgo.toISOString();
    
    // We don't await/block on the delete operation, just let it run in the background
    supabase
      .from('stock_needs')
      .delete()
      .eq('status', 'order_received')
      .lt('updated_at', isoDate)
      .then(({ error }) => {
        if (error) console.error('Auto-cleanup error:', error);
      });

    // Fetch the current stock list
    const { data, error } = await supabase
      .from('stock_needs')
      .select('*, users!stock_needs_created_by_fkey(name)')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── POST /api/stock ───────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { item_name, quantity, photo_data } = req.body;
    if (!item_name) return res.status(400).json({ error: 'Item name is required.' });

    const { data, error } = await supabase
      .from('stock_needs')
      .insert([{
        item_name,
        quantity: quantity || 1,
        photo_data: photo_data || null,
        status: 'out_of_stock',
        created_by: req.user.id
      }])
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Stock need added successfully.', data: data[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── PUT /api/stock/:id/status ─────────────────────────────────────
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['out_of_stock', 'order_placed', 'order_received', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const { data, error } = await supabase
      .from('stock_needs')
      .update({ status })
      .eq('id', req.params.id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Status updated.', data: data[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── DELETE /api/stock/:id ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('stock_needs').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Stock need deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

module.exports = router;
