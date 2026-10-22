// 1. Исходный массив товаров + 2 дополнительных товара (Пункт 3 из Задания)
const products = [
    { id: 1, title: 'Ноутбук 15"', category: 'Компьютеры', price: 85000 },
    { id: 2, title: 'Монитор 27"', category: 'Компьютеры', price: 28000 },
    { id: 3, title: 'Клавиатура', category: 'Аксессуары', price: 6500 },
    { id: 4, title: 'Мышь беспроводная', category: 'Аксессуары', price: 2500 },
    // Добавленные товары:
    { id: 5, title: 'Смартфон', category: 'Электроника', price: 45000 },
    { id: 6, title: 'Наушники', category: 'Аксессуары', price: 12000 }
];

// Массив, где будут храниться добавленные в корзину товары
let cart = [];

// Получаем элементы из DOM дерева
const catalog = document.getElementById('catalog');
const cartCount = document.getElementById('cart-count');
const cartSum = document.getElementById('cart-sum');
const clearCartBtn = document.getElementById('clear-cart');

// Функция отрисовки карточек товаров в каталоге
function renderProducts() {
    catalog.innerHTML = products.map(p => `
        <div class="card">
            <div class="category" style="color: #888; font-size: 12px;">${p.category}</div>
            <h3 style="margin: 10px 0;">${p.title}</h3>
            <div class="price" style="font-weight: bold;">${Number(p.price).toLocaleString('ru-RU')} ₽</div>
            <button data-id="${p.id}">В корзину</button>
        </div>
    `).join('');
}

// Функция пересчета и обновления корзины в шапке
function renderCart() {
    // Количество элементов в корзине
    cartCount.textContent = cart.length;
    
    // Подсчет суммы цен всех товаров в корзине
    const total = cart.reduce((sum, p) => sum + p.price, 0);
    cartSum.textContent = total.toLocaleString('ru-RU');
}

// Слушатель кликов по кнопкам "В корзину" (Делегирование событий)
catalog.addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    
    // Находим ID товара из атрибута data-id нажатой кнопки
    const productId = Number(e.target.dataset.id);
    // Ищем сам товар в массиве products
    const product = products.find(p => p.id === productId);
    
    if (product) {
        cart.push(product); // Добавляем в корзину
        renderCart();       // Перерисовываем шапку
    }
});

// Слушатель для кнопки "Очистить корзину" (Пункты 1 и 2 из Задания)
clearCartBtn.addEventListener('click', () => {
    cart = [];    // Полностью очищаем массив корзины
    renderCart(); // Обнуляем счетчики в шапке (покажут 0 шт. и 0 ₽)
});

// Инициализация: отрисовываем товары при загрузке страницы
renderProducts();

