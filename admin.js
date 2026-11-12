const API = 'http://localhost:3000/api';
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');

const rows = document.getElementById('rows');
const select = document.getElementById('category-select');
let items = [];

async function request(path, method = 'GET', body) {
  const response = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

function render() {
  rows.innerHTML = items.map(p => `
    <tr>
      <td>${p.id}</td>
      <td>${p.title}</td>
      <td>${p.category}</td>
      <td><input id="price-${p.id}" type="number" step="0.01" value="${p.price}"></td>
      <td><input id="stock-${p.id}" type="number" value="${p.stock}"></td>
      <td>
        <button class="save" data-save="${p.id}">Сохранить</button>
        <button class="danger" data-delete="${p.id}">Удалить</button>
      </td>
    </tr>
  `).join('');
}

async function load() {
  const [products, categories] = await Promise.all([request('/products'), request('/categories')]);
  items = products;
  select.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  render();
}

rows.addEventListener('click', async e => {
  try {
    const saveId = e.target.dataset.save;
    const deleteId = e.target.dataset.delete;
    if (saveId) {
      const p = items.find(x => x.id === Number(saveId));
      await request('/products/' + saveId, 'PUT', {
        title: p.title,
        category_id: p.category_id,
        price: document.getElementById('price-' + saveId).value,
        stock: document.getElementById('stock-' + saveId).value
      });
      alert('Сохранено');
      await load();
    }
    if (deleteId && confirm('Удалить товар?')) {
      await request('/products/' + deleteId, 'DELETE');
      await load();
    }
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await request('/products', 'POST', Object.fromEntries(f));
    e.target.reset();
    await load();
  } catch (err) {
    alert(err.message);
  }
});

if (user && user.role === 'admin') {
  document.getElementById('panel').hidden = false;
  load().catch(err => alert(err.message));
} else {
  document.getElementById('denied').hidden = false;
}