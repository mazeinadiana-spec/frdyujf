require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Проверка входа ----------
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется вход' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  next();
}

// ---------- Товары и категории ----------
app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.id, p.title, p.price, p.stock, p.category_id, c.name AS category
       FROM products p
       JOIN categories c ON c.id = p.category_id
       ORDER BY p.id`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, name FROM categories ORDER BY id');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------- Оформление заказа (транзакция) ----------
app.post('/api/orders', auth, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Некорректные данные заказа' });
  }

  // Объединяем повторяющиеся товары: { id -> количество }
  const wanted = new Map();
  for (const item of items) {
    const id = Number(item.id);
    const qty = Number(item.quantity);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Некорректные данные заказа' });
    }
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let total = 0;
    const lines = [];
    for (const [id, qty] of wanted) {
      const [found] = await conn.execute(
        'SELECT id, title, price, stock FROM products WHERE id = ? FOR UPDATE',
        [id]
      );
      if (found.length === 0) throw new HttpError(404, 'Товар не найден');
      const product = found[0];
      if (product.stock < qty) {
        throw new HttpError(409, 'Недостаточно товара: ' + product.title);
      }
      total += Number(product.price) * qty;
      lines.push({ id, qty, price: product.price });
    }
    total = Math.round(total * 100) / 100;

    const [order] = await conn.execute(
      'INSERT INTO orders (customer_name, total, user_id) VALUES (?, ?, ?)',
      [req.user.email, total, req.user.id]
    );
    for (const line of lines) {
      await conn.execute(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
        [order.insertId, line.id, line.qty, line.price]
      );
      await conn.execute(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [line.qty, line.id]
      );
    }

    await conn.commit();
    res.status(201).json({ orderId: order.insertId, total });
  } catch (err) {
    await conn.rollback();
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    conn.release();
  }
});

// ---------- Поиск (безопасный вариант) ----------
app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.title || '';
    const [rows] = await pool.execute(
      'SELECT id, title, price FROM products WHERE title LIKE ?',
      ['%' + q + '%']
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------- Регистрация и вход ----------
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Некорректный email' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.execute(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, hash]
    );
    res.status(201).json({ message: 'Регистрация выполнена' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    }
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];
    const ok = user && await bcrypt.compare(password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    res.json({ token, user: { email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------- Управление товарами (только администратор) ----------
function validateProduct(body) {
  const { title, price, stock, category_id } = body;
  if (!title || String(title).trim() === '' || String(title).length > 100) {
    return 'Название: от 1 до 100 символов';
  }
  if (!(Number(price) >= 0)) return 'Цена должна быть числом не меньше 0';
  if (!Number.isInteger(Number(stock)) || Number(stock) < 0) {
    return 'Остаток должен быть целым числом не меньше 0';
  }
  if (!Number.isInteger(Number(category_id))) return 'Укажите категорию';
  return null;
}

app.post('/api/products', auth, adminOnly, async (req, res) => {
  const problem = validateProduct(req.body);
  if (problem) return res.status(400).json({ error: problem });
  const { title, price, stock, category_id } = req.body;
  try {
    const [result] = await pool.execute(
      'INSERT INTO products (title, price, stock, category_id) VALUES (?, ?, ?, ?)',
      [title.trim(), price, stock, category_id]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (err.errno === 1452 || err.errno === 1216) {
      return res.status(400).json({ error: 'Такой категории нет' });
    }
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/products/:id', auth, adminOnly, async (req, res) => {
  const problem = validateProduct(req.body);
  if (problem) return res.status(400).json({ error: problem });
  const { title, price, stock, category_id } = req.body;
  try {
    const [result] = await pool.execute(
      'UPDATE products SET title = ?, price = ?, stock = ?, category_id = ? WHERE id = ?',
      [title.trim(), price, stock, category_id, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Товар не найден' });
    }
    res.json({ message: 'Товар обновлён' });
  } catch (err) {
    if (err.errno === 1452 || err.errno === 1216) {
      return res.status(400).json({ error: 'Такой категории нет' });
    }
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/products/:id', auth, adminOnly, async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM products WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Товар не найден' });
    }
    res.json({ message: 'Товар удалён' });
  } catch (err) {
    if (err.errno === 1451 || err.errno === 1217) {
      return res.status(409).json({ error: 'Товар есть в заказах, удалить нельзя' });
    }
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ---------- Каталог: поиск, фильтр, сортировка, страницы ----------
app.get('/api/catalog', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const category = parseInt(req.query.category, 10);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 8));
    const offset = (page - 1) * limit;

    // порядок сортировки выбираем из белого списка, а не берём из запроса
    const sorts = { price_asc: 'p.price ASC', price_desc: 'p.price DESC' };
    const orderBy = sorts[req.query.sort] || 'p.id ASC';

    const where = [];
    const params = [];
    if (search) {
      where.push('p.title LIKE ?');
      params.push('%' + search + '%');
    }
    if (Number.isInteger(category)) {
      where.push('p.category_id = ?');
      params.push(category);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [[{ total }]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM products p ' + whereSql,
      params
    );
    // limit и offset уже проверены как целые числа, поэтому подставляем их в текст запроса
    const [items] = await pool.execute(
      `SELECT p.id, p.title, p.price, p.stock, c.name AS category
       FROM products p
       JOIN categories c ON c.id = p.category_id
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.listen(process.env.PORT, () => {
  console.log('Сервер запущен: http://localhost:' + process.env.PORT);
});