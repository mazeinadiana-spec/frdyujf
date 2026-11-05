require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(require('path').join(__dirname, '../shop')));

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

// ---------- Товары и категории ----------
app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.id, p.title, p.price, p.stock, c.name AS category
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
app.post('/api/orders', async (req, res) => {
  const { customerName, items } = req.body;
  if (!customerName || !Array.isArray(items) || items.length === 0) {
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
      'INSERT INTO orders (customer_name, total) VALUES (?, ?)',
      [customerName, total]
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



// БЕЗОПАСНЫЙ вариант: значение передаётся параметром
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

app.listen(process.env.PORT, () => {
  console.log('Сервер запущен: http://localhost:' + process.env.PORT);
});