const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../supabase');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// POST /api/auth/seed — run once to create users, then disable
router.post('/seed', async (req, res) => {
  const users = [
    { name: 'Admin User',  email: 'admin@store.com',  password: 'Admin@123',  role: 'admin' },
    { name: 'Sales User1', email: 'sales1@store.com', password: 'Sales@123',  role: 'user'  },
    { name: 'Sales User2', email: 'sales2@store.com', password: 'Sales2@123', role: 'user'  },
  ];
  const created = [];
  for (const u of users) {
    const password_hash = await bcrypt.hash(u.password, 10);
    const { data, error } = await supabase
      .from('users')
      .insert({ name: u.name, email: u.email, password_hash, role: u.role })
      .select('id, name, email, role')
      .single();
    if (error) {
      created.push({ email: u.email, status: 'failed', reason: error.message });
    } else {
      created.push({ email: u.email, status: 'created', defaultPassword: u.password });
    }
  }
  res.json({ message: 'Seed complete. Disable this endpoint after use!', results: created });
});

// GET /api/auth/me
const authMiddleware = require('../middleware/auth');
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
